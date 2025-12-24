import type { Moment, WeekSpec } from "moment";
import { Plugin, addIcon, debounce, TFile, Platform } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { Writable } from "svelte/store";

import { getDateUID } from "obsidian-daily-notes-interface";
import { PeriodicNotesCache } from "./periodic/cache";

import { getCommands, displayConfigs } from "./periodic/commands";
import {
  calendarDayIcon,
  calendarMonthIcon,
  calendarWeekIcon,
  calendarQuarterIcon,
  calendarYearIcon,
} from "./periodic/icons";
import { showFileMenu } from "./periodic/modal";
import { SystemMediaMonitor } from "./smtc/SystemMediaMonitor";
import { BrowserSMTC } from "./smtc/BrowserSMTC";

import { ConfirmationModal } from "./ui/modal";
import type { Granularity, PeriodicNotesConfig } from "./periodic/types";
import {
  isMetaPressed,
  getTemplateContents,
  applyTemplateTransformations,
  getNoteCreationPath
} from "./periodic/utils";
import type { PeriodicNoteCachedMetadata } from "./periodic/cache";

import { VIEW_TYPE_CALENDAR } from "./constants";
import { settings, dailyNotes, weeklyNotes } from "./ui/stores";
import {
  CalendarSettingsTab,
  defaultSettings,
} from "./settings";
import type { ISettings } from "./settings";
import CalendarView from "./view";
import WordCountStats from "./wordCountStats";
import { t } from "./i18n";
import type { Language } from "./i18n";
import { Timer, Mode } from "./pomo/timer";
import { StatusBarPlayer } from "./ui/StatusBarPlayer";
import { QWeatherService } from "./weather/QWeatherService";

declare global {
  interface Window {
    app: App;
    _bundledLocaleWeekSpec: WeekSpec;
  }
}

import { CacheManager } from "./services/CacheManager";

export default class CalendarPlugin extends Plugin {
  public options: ISettings;
  public settings: Writable<ISettings>;
  private view: CalendarView;
  public wordCountStats: WordCountStats | null = null;
  public weatherService: QWeatherService;
  public cacheManager: CacheManager;
  private statusBarEl: HTMLElement;
  private pomoStatusBarEl: HTMLElement | null = null;
  public timer: Timer;
  private ribbonEl: HTMLElement | null;
  public cache: PeriodicNotesCache | null = null;
  private isInitialized = false;
  private debouncedSync: () => void;
  public systemMediaMonitor: SystemMediaMonitor | null = null;
  private statusBarPlayer: StatusBarPlayer | null = null;
  private statusBarPlayerEl: HTMLElement | null = null;
  private browserSMTC: BrowserSMTC | null = null;

  private getObsidianLanguage(): Language {
    const momentLang = window.moment.locale();
    if (momentLang.startsWith('zh')) {
      return 'zh-cn';
    }
    return 'en';
  }

  private onSettingsUpdate = debounce(
    async () => {
      if (!this.isInitialized) return;

      await this.saveData(this.options);
      this.configureCommands();
      this.configureRibbonIcons();
      this.configurePomodoro();
      this.configureSystemMedia();
      this.configureWordCount();
      this.configurePeriodicNotes();
      this.configureAssistant();

      if (this.view) {
        this.view.refresh();
      }
    },
    1000,
    true
  );

  onunload(): void {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CALENDAR)
      .forEach((leaf) => leaf.detach());

    if (this.timer) {
      if (this.timer.mode !== Mode.NoTimer) {
        this.timer.pauseTimer();
      } else {
        this.timer.quitTimer();
      }
    }

    if (this.weatherService) {
      this.weatherService.unload();
    }
  }

  async onload(): Promise<void> {
    this.cacheManager = new CacheManager(this);
    await this.cacheManager.load();

    this.settings = settings;
    // We must load options BEFORE subscribing to avoid overwriting default store state with empty options if accessed early?
    // Actually, store init value is probably used.

    await this.loadOptions();

    this.register(
      settings.subscribe((value) => {
        this.options = value;
        this.onSettingsUpdate();
      })
    );

    this.configureWordCount();
    this.weatherService = new QWeatherService(this);

    this.debouncedSync = debounce(() => this.syncCacheToStores(), 200);

    this.registerEvent(
      this.app.workspace.on("periodic-notes:resolve", () => {
        this.debouncedSync();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      // The cache initialization will trigger sync via periodic-notes:resolve
    });

    this.timer = new Timer(this);
    this.configurePomodoro();
    this.configureSystemMedia();

    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-quarter", calendarQuarterIcon);
    addIcon("calendar-year", calendarYearIcon);

    this.ribbonEl = null;

    this.configurePeriodicNotes();

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf: WorkspaceLeaf) => (this.view = new CalendarView(leaf, this))
    );

    this.configureAssistant();

    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    this.registerInterval(
      window.setInterval(async () => {
        if (this.pomoStatusBarEl) {
          const text = await this.timer.setStatusBarText();
          this.pomoStatusBarEl.setText(text);
        }
      }, 1000)
    );

    this.initLeaf();
    this.isInitialized = true;
  }

  initLeaf(): void {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length) {
      return;
    }

    if (this.app.workspace.layoutReady) {
      this.app.workspace.getRightLeaf(false).setViewState({
        type: VIEW_TYPE_CALENDAR,
      });
    } else {
      this.app.workspace.onLayoutReady(() => {
        if (this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0) {
          this.app.workspace.getRightLeaf(false).setViewState({
            type: VIEW_TYPE_CALENDAR,
          });
        }
      });
    }
  }

  async loadOptions(): Promise<void> {
    const loadedData = await this.loadData();

    // Check if migration/reset is needed (if missing top-level keys like 'assistant')
    // Reset if structure is outdated to enforce new schema
    let finalSettings = { ...defaultSettings };

    if (loadedData && loadedData.assistant) {
      // Simple merge (deep merge ideally, but for now spread)
      // If we strictly want to support partials, we might need a utility.
      // Assuming loadedData is compatible.
      finalSettings = {
        ...defaultSettings,
        ...loadedData,
        assistant: { ...defaultSettings.assistant, ...loadedData.assistant },
        periodicNotes: { ...defaultSettings.periodicNotes, ...loadedData.periodicNotes },
        wordCount: { ...defaultSettings.wordCount, ...loadedData.wordCount },
        pomodoro: { ...defaultSettings.pomodoro, ...loadedData.pomodoro },
      };
      // Restore deep fields that might be lost by shallow spread of subsections
      if (loadedData.assistant?.calendar) finalSettings.assistant.calendar = { ...defaultSettings.assistant.calendar, ...loadedData.assistant.calendar };
      if (loadedData.assistant?.flipClock) finalSettings.assistant.flipClock = { ...defaultSettings.assistant.flipClock, ...loadedData.assistant.flipClock };
      if (loadedData.assistant?.weather) finalSettings.assistant.weather = { ...defaultSettings.assistant.weather, ...loadedData.assistant.weather };

      if (loadedData.wordCount?.heatmap) finalSettings.wordCount.heatmap = { ...defaultSettings.wordCount.heatmap, ...loadedData.wordCount.heatmap };
      if (loadedData.pomodoro?.notification) finalSettings.pomodoro.notification = { ...defaultSettings.pomodoro.notification, ...loadedData.pomodoro.notification };

      // Deep merge periodic notes granularities
      const granularities: Granularity[] = ["day", "week", "month", "quarter", "year"];
      granularities.forEach(g => {
        // Priority: nested > root (legacy)
        const legacyConfig = (loadedData as Record<string, any>)[g];
        const newConfig = (loadedData.periodicNotes as PeriodicNotesConfig)?.[g];

        if (newConfig) {
          (finalSettings.periodicNotes as PeriodicNotesConfig)[g] = { ...(defaultSettings.periodicNotes as PeriodicNotesConfig)[g], ...newConfig };
        } else if (legacyConfig) {
          // Migrate legacy settings
          (finalSettings.periodicNotes as PeriodicNotesConfig)[g] = { ...(defaultSettings.periodicNotes as PeriodicNotesConfig)[g], ...legacyConfig };
        }
      });

      if (loadedData.media) finalSettings.media = { ...defaultSettings.media, ...loadedData.media };
      // Migration: If old pomodoro has systemMedia, migrate it?
      if (loadedData.pomodoro && typeof loadedData.pomodoro.systemMedia === 'boolean' && !loadedData.media) {
        finalSettings.media.enabled = loadedData.pomodoro.systemMedia; // Only if media wasn't present
      }
      if (loadedData.pomodoro && typeof loadedData.pomodoro.whiteNoise === 'boolean' && !loadedData.media) {
        finalSettings.media.whiteNoise = loadedData.pomodoro.whiteNoise;
      }
      if (loadedData.pomodoro && typeof loadedData.pomodoro.backgroundNoiseFile === 'string' && !loadedData.media) {
        finalSettings.media.backgroundNoiseFile = loadedData.pomodoro.backgroundNoiseFile;
      }

      // Migration: Locale Override (Moved from assistant.calendar -> assistant -> root)
      const oldLocale = (loadedData.assistant?.calendar?.localeOverride) || (loadedData.assistant?.localeOverride);
      if (oldLocale && oldLocale !== "system-default" && finalSettings.localeOverride === "system-default") {
        finalSettings.localeOverride = oldLocale;
      }

      // Migration: weekStart and shouldConfirmBeforeCreate (Moved to assistant.calendar)
      const oldWeekStart = (loadedData as any).weekStart;
      if (oldWeekStart && finalSettings.assistant.calendar.weekStart === "locale") {
        finalSettings.assistant.calendar.weekStart = oldWeekStart;
      }

      const oldConfirm = (loadedData as Record<string, any>).shouldConfirmBeforeCreate;
      if (oldConfirm !== undefined && oldConfirm !== null) {
        finalSettings.assistant.calendar.shouldConfirmBeforeCreate = oldConfirm;
      } else {
        // Double check older legacy key if it existed
        const oldConfirm2 = (loadedData as Record<string, any>).confirmCreate;
        if (oldConfirm2 !== undefined && oldConfirm2 !== null) {
          finalSettings.assistant.calendar.shouldConfirmBeforeCreate = oldConfirm2;
        }
      }
    }

    settings.set(finalSettings);
    this.options = finalSettings;

    // Fix JSON serialization for Infinity in heatmap
    if (this.options.wordCount.heatmap.colorRanges) {
      this.options.wordCount.heatmap.colorRanges.forEach(range => {
        if (range.max === null) range.max = Infinity;
      });
    }
  }

  async writeOptions(
    changeOpts: (settings: ISettings) => Partial<ISettings>
  ): Promise<void> {
    settings.update((old) => {
      const updates = changeOpts(old);
      // Since our state is nested, updates might be partial. 
      // But changeOpts usually returns full structure updates in my new settings.ts.
      // E.g. { assistant: { ...old.assistant, ... } }
      // So shallow merge at top level is fine if the updater respects structure.
      return { ...old, ...updates };
    });
    // Write full object
    await this.saveData(this.options);

    // Cache reset check
    // Check key fields
    // Logic changed to checking specific values because we can't easily compare partials here without keeping 'old'.
    // We'll trust the trigger logic: if we edited granularity or weekStart.
    // Actually, simpler to just always trigger resolve if Periodic Notes enabled?
    // Or check if 'periodicNotes' or 'assistant.calendar.weekStart' changed?
    // Optimization: Just trigger it. It's debounced.
    this.app.workspace.trigger("periodic-notes:settings-updated");

    this.configureCommands();
    this.configureRibbonIcons();
    this.view?.refresh();
  }

  private configureRibbonIcons(): void {
    if (this.ribbonEl) {
      this.ribbonEl.detach();
      this.ribbonEl = null;
    }

    const granularities: Granularity[] = ["day", "week", "month", "quarter", "year"];
    // Access nested periodicNotes
    const enabledGranularities = granularities.filter(g => (this.options.periodicNotes as PeriodicNotesConfig)[g]?.enabled);

    if (enabledGranularities.length) {
      const granularity = enabledGranularities[0];
      const config = displayConfigs[granularity];
      this.ribbonEl = this.addRibbonIcon(
        `calendar-${granularity}`,
        config.labelOpenPresent,
        (e: MouseEvent) => {
          if (e.type !== "auxclick") {
            this.openPeriodicNote(granularity, window.moment(), {
              inNewSplit: isMetaPressed(e),
            });
          }
        }
      );
      this.ribbonEl.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        showFileMenu(this.app, this, {
          x: e.pageX,
          y: e.pageY,
        });
      });
    }
  }

  private configureCommands(): void {
    const granularities: Granularity[] = ["day", "week", "month", "quarter", "year"];

    granularities.forEach(g => {
      getCommands(this.app, this, g).forEach(cmd => {
        this.app.commands.removeCommand(`work-assistant:${cmd.id}`);
      });
    });

    if (!this.options.periodicNotes.enabled) return;

    granularities.filter(g => (this.options.periodicNotes as PeriodicNotesConfig)[g]?.enabled).forEach(granularity => {
      getCommands(this.app, this, granularity).forEach(this.addCommand.bind(this));
    });
  }

  public async openPeriodicNote(
    granularity: Granularity,
    date: Moment,
    opts?: { inNewSplit?: boolean }
  ): Promise<void> {
    const { inNewSplit = false } = opts ?? {};
    const { workspace } = this.app;
    let file = this.cache.getPeriodicNote(
      granularity,
      date
    );

    if (!file) {
      file = await this.createPeriodicNote(granularity, date);
    }

    if (!file) return;

    const leaf = inNewSplit ? workspace.splitActiveLeaf() : workspace.getUnpinnedLeaf();
    await leaf.openFile(file, { active: true });
  }

  public async createPeriodicNote(
    granularity: Granularity,
    date: Moment
  ): Promise<TFile | null> {
    const config = (this.options.periodicNotes as PeriodicNotesConfig)[granularity];
    const format = config.format;
    const filename = date.format(format);

    if (this.options.assistant.calendar.shouldConfirmBeforeCreate) {
      const confirmed = await new Promise<boolean>((resolve) => {
        let accepted = false;
        const modal = new ConfirmationModal(this.app, {
          title: t("modal-create-note-title"),
          text: t("modal-create-note-text", undefined).replace("{filename}", filename),
          cta: t("modal-create-note-cta"),
          onAccept: async () => {
            accepted = true;
            resolve(true);
          },
        });
        const originalOnClose = modal.onClose;
        modal.onClose = () => {
          originalOnClose.call(modal);
          if (!accepted) resolve(false);
        };
        modal.open();
      });

      if (!confirmed) return null;
    }

    const templateContents = await getTemplateContents(this.app, config.templatePath);
    const renderedContents = applyTemplateTransformations(
      filename,
      granularity,
      date,
      format,
      templateContents
    );
    const destPath = await getNoteCreationPath(this.app, filename, config);
    return this.app.vault.create(destPath, renderedContents);
  }

  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
    return this.cache?.getPeriodicNote(
      granularity,
      date
    ) ?? null;
  }

  public getPeriodicNotes(
    granularity: Granularity,
    date: Moment,
    includeFinerGranularities = false
  ): PeriodicNoteCachedMetadata[] {
    return this.cache?.getPeriodicNotes(
      granularity,
      date,
      includeFinerGranularities
    ) ?? [];
  }

  public isPeriodic(filePath: string, granularity?: Granularity): boolean {
    return this.cache?.isPeriodic(filePath, granularity) ?? false;
  }

  public findInCache(filePath: string): PeriodicNoteCachedMetadata | null {
    return this.cache?.find(filePath) ?? null;
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards"
  ): PeriodicNoteCachedMetadata | null {
    return this.cache?.findAdjacent(filePath, direction) ?? null;
  }

  public syncCacheToStores(): void {
    if (!this.cache) return;
    const allCachedFiles = Array.from(this.cache.cachedFiles.values());

    const dailyData: Record<string, TFile> = {};
    const weeklyData: Record<string, TFile> = {};

    allCachedFiles.forEach((meta) => {
      const file = this.app.vault.getAbstractFileByPath(meta.filePath);
      if (!(file instanceof TFile)) return;

      if (meta.granularity === "day") {
        const uid = getDateUID(meta.date, "day");
        dailyData[uid] = file;
      } else if (meta.granularity === "week") {
        const uid = getDateUID(meta.date, "week");
        weeklyData[uid] = file;
      }
    });

    dailyNotes.reindex(dailyData);
    weeklyNotes.reindex(weeklyData);
  }

  private addPomoCommands(lang: Language): void {
    this.addCommand({
      id: 'start-pomo',
      name: t("command-pomo-start", lang),
      icon: 'play',
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.timer.startTimer(Mode.Pomo);
        }
        return true;
      }
    });

    this.addCommand({
      id: 'pause-pomo',
      name: t("command-pomo-pause", lang),
      icon: 'pause',
      checkCallback: (checking: boolean) => {
        if (this.timer.mode !== Mode.NoTimer) {
          if (!checking) {
            this.timer.togglePause();
          }
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'quit-pomo',
      name: t("command-pomo-quit", lang),
      icon: 'quit',
      checkCallback: (checking: boolean) => {
        if (this.timer.mode !== Mode.NoTimer) {
          if (!checking) {
            this.timer.quitTimer();
          }
          return true;
        }
        return false;
      }
    });
  }


  private configurePomodoro(): void {
    if (this.options.pomodoro.enabled) {
      this.initPomodoro();
    } else {
      this.unloadPomodoro();
    }
  }

  private initPomodoro(): void {
    if (this.pomoStatusBarEl) return;

    const lang: Language = this.getObsidianLanguage();

    this.pomoStatusBarEl = this.addStatusBarItem();
    this.pomoStatusBarEl.addClass("statusbar-pomo");
    this.pomoStatusBarEl.setAttribute("aria-label", t("pomo-status-bar-aria", lang));
    this.pomoStatusBarEl.addEventListener("click", () => {
      if (this.timer.mode === Mode.NoTimer) {
        this.timer.startTimer(Mode.Pomo);
      } else {
        this.timer.togglePause();
      }
    });

    this.pomoStatusBarEl.setText("🍅");
    this.addPomoCommands(lang);
  }

  private unloadPomodoro(): void {
    const pomoStatusBarEl = this.pomoStatusBarEl;
    if (pomoStatusBarEl) {
      pomoStatusBarEl.remove();
      this.pomoStatusBarEl = null;
    }

    if (this.timer) {
      this.timer.quitTimer();
    }

    const commands = ['start-pomo', 'pause-pomo', 'quit-pomo'];
    commands.forEach(id => {
      this.app.commands.removeCommand(`${this.manifest.id}:${id}`);
    });
  }

  private configureSystemMedia(): void {
    if (this.options.media.enabled) {
      this.initSystemMedia();
    } else {
      this.unloadSystemMedia();
    }
  }

  private initSystemMedia(): void {
    if (!this.browserSMTC) {
      import('./smtc/BrowserSMTC').then(({ BrowserSMTC }) => {
        if (!this.options.media.enabled) return;

        this.browserSMTC = new BrowserSMTC(this.timer.whiteNoiseService);
        this.addChild(this.browserSMTC);
        this.timer.whiteNoiseService.setSMTC(this.browserSMTC);
      });
    }

    if (Platform.isWin && !this.systemMediaMonitor) {
      import('./smtc/SystemMediaMonitor').then(({ SystemMediaMonitor }) => {
        if (!this.options.media.enabled) return;

        const basePath = (this.app.vault.adapter as any).getBasePath();
        const pluginPath = `${basePath}/${this.manifest.dir || '.obsidian/plugins/obsidian-work-assistant'}`;

        this.systemMediaMonitor = new SystemMediaMonitor(pluginPath, this.cacheManager);
        this.addChild(this.systemMediaMonitor);

        if (!this.statusBarPlayerEl) {
          const el = this.addStatusBarItem();
          this.statusBarPlayerEl = el;
          this.statusBarPlayer = new StatusBarPlayer(el, this.systemMediaMonitor);
        }

      }).catch((e: Error) => {
        console.error("[Work Assistant] Error importing/initializing SystemMediaMonitor:", e);
      });
    }
  }

  private unloadSystemMedia(): void {
    if (this.browserSMTC) {
      this.removeChild(this.browserSMTC);
      this.browserSMTC = null;
    }
    if (this.timer?.whiteNoiseService) {
      this.timer.whiteNoiseService.setSMTC(null);
    }

    if (this.systemMediaMonitor) {
      this.removeChild(this.systemMediaMonitor);
      this.systemMediaMonitor = null;
    }

    if (this.statusBarPlayer) {
      this.statusBarPlayer.destroy();
      this.statusBarPlayer = null;
    }

    if (this.statusBarPlayerEl) {
      this.statusBarPlayerEl.remove();
      this.statusBarPlayerEl = null;
    }
  }

  private configureWordCount(): void {
    const { wordCount } = this.options;
    if (wordCount.enabled) {
      this.initWordCount();
      if (this.wordCountStats) {
        this.wordCountStats.updateStatusBar(wordCount.statusBar);
      }
    } else {
      this.unloadWordCount();
    }
  }

  private initWordCount(): void {
    if (!this.wordCountStats) {
      this.wordCountStats = new WordCountStats(this, this.app);
      this.addChild(this.wordCountStats);
    }
  }

  private unloadWordCount(): void {
    if (this.wordCountStats) {
      this.removeChild(this.wordCountStats);
      this.wordCountStats = null;
    }
  }

  private configurePeriodicNotes(): void {
    this.configureCache();

    if (this.options.periodicNotes.enabled) {
      this.initPeriodicNotes();
    } else {
      this.unloadPeriodicNotes();
    }
  }

  private configureCache(): void {
    const needsCache = this.options.periodicNotes.enabled;

    if (needsCache) {
      if (!this.cache) {
        this.cache = new PeriodicNotesCache(this.app, this);
        this.cache.load();
        this.addChild(this.cache);
      }
    } else {
      if (this.cache) {
        this.removeChild(this.cache);
        this.cache = null;
      }
    }
  }

  private initPeriodicNotes(): void {
    this.configureCommands();
    this.configureRibbonIcons();
  }

  private unloadPeriodicNotes(): void {

    this.configureCommands();
    this.configureRibbonIcons();
  }

  private configureAssistant(): void {
    this.configureCache();

    const { assistant } = this.options;
    const hasActiveWidgets = assistant.calendar.enabled || assistant.flipClock.enabled || assistant.weather.enabled;

    if (assistant.enabled && hasActiveWidgets) {
      this.initAssistant();
    } else {
      this.unloadAssistant();
    }
  }

  private initAssistant(): void {
    // Start background warning polling (independent of view visibility)
    if (this.weatherService) {
      this.weatherService.startWarningPolling();
    }

    const lang = this.getObsidianLanguage();

    this.addCommand({
      id: "show-calendar-view",
      name: t('command-open-view', lang),
      checkCallback: (checking: boolean) => {
        if (checking) {
          return (
            this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
          );
        }
        this.initLeaf();
      },
      hotkeys: []
    });

    this.addCommand({
      id: "reveal-active-note",
      name: t('command-reveal-active-note', lang),
      callback: () => this.view.revealActiveNote(),
    });

    this.initLeaf();
  }

  private unloadAssistant(): void {
    // Stop background polling
    if (this.weatherService) {
      this.weatherService.stopWarningPolling();
    }

    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CALENDAR)
      .forEach((leaf) => leaf.detach());

    this.app.commands.removeCommand(`${this.manifest.id}: show - calendar - view`);
    this.app.commands.removeCommand(`${this.manifest.id}: reveal - active - note`);
  }
}
