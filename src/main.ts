import type { Moment, WeekSpec } from "moment";
import { Plugin, addIcon, debounce, TFile, Platform } from "obsidian";
import type { App, ViewState, WorkspaceLeaf } from "obsidian";
import type { Writable } from "svelte/store";

import { getDateUID } from "obsidian-daily-notes-interface";
import { PeriodicNotesCache } from "./periodic/cache";

import { getCommands, getOpenPresentLabel } from "./periodic/commands";
import {
  calendarDayIcon,
  calendarMonthIcon,
  calendarWeekIcon,
  calendarQuarterIcon,
  calendarYearIcon,
} from "./periodic/icons";
import { showFileMenu } from "./periodic/modal";
import type { SystemMediaMonitor } from "./smtc/SystemMediaMonitor";

import { ConfirmationModal } from "./ui/modal";
import type { Granularity, PeriodicNotesConfig } from "./periodic/types";
import {
  isMetaPressed,
  getTemplateContents,
  applyTemplateTransformations,
  getNoteCreationPath
} from "./periodic/utils";
import type { PeriodicNoteCachedMetadata } from "./periodic/cache";

import {
  ASSISTANT_VIEW_DISPLAY_TEXT,
  ASSISTANT_VIEW_DISPLAY_TEXT_ALIASES,
  LEGACY_VIEW_TYPE_CALENDAR,
  VIEW_TYPE_ASSISTANT,
} from "./constants";
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
import { TaskSyncManager } from "./services/caldav/TaskSyncManager";

declare global {
  interface Window {
    app: App;
    _bundledLocaleWeekSpec: WeekSpec;
  }
}

import { CacheManager } from "./services/CacheManager";

/**
 * Recursively deep merges source into target. Arrays are replaced, not concatenated.
 * Handles up to any nesting depth - no longer limited to 3 levels.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== null &&
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      targetValue !== null
    ) {
      // Both are plain objects - recurse
      result[key] = deepMerge(
        targetValue as Record<string, any>,
        sourceValue as Record<string, any>
      );
    } else if (sourceValue !== undefined) {
      // Replace with source value (covers arrays, primitives, null, etc.)
      result[key] = sourceValue;
    }
  }

  return result;
}

export default class CalendarPlugin extends Plugin {
  public options: ISettings;
  public settings: Writable<ISettings>;
  private view: CalendarView | null = null;
  public wordCountStats: WordCountStats | null = null;
  public weatherService: QWeatherService;
  public taskSyncManager: TaskSyncManager | null = null;
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
  private systemMediaStartTimer: number | null = null;
  private systemMediaStartScheduled = false;
  private systemMediaStartGeneration = 0;
  private settingsTab: CalendarSettingsTab;

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
      this.configurePomodoro();
      this.configureSystemMedia();
      this.configureWordCount();
      await this.configureTaskSync();
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
    this.getAssistantLeaves().forEach((leaf) => leaf.detach());

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

    if (this.taskSyncManager) {
      this.removeChild(this.taskSyncManager);
      this.taskSyncManager = null;
    }

    this.unloadSystemMedia();
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
    this.taskSyncManager = new TaskSyncManager(this);
    this.addChild(this.taskSyncManager);
    await this.configureTaskSync();

    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-quarter", calendarQuarterIcon);
    addIcon("calendar-year", calendarYearIcon);

    this.ribbonEl = null;

    this.configurePeriodicNotes();

    this.registerView(
      VIEW_TYPE_ASSISTANT,
      (leaf: WorkspaceLeaf) => {
        this.view = new CalendarView(leaf, this);
        return this.view;
      }
    );

    this.configureAssistant();

    this.settingsTab = new CalendarSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.registerInterval(
      window.setInterval(async () => {
        if (this.pomoStatusBarEl) {
          const text = await this.timer.setStatusBarText();
          this.pomoStatusBarEl.setText(text);
        }
      }, 1000)
    );

    this.isInitialized = true;
  }

  initLeaf(): void {
    void this.ensureAssistantLeaf();
  }

  private async ensureAssistantLeaf(): Promise<void> {
    const existingLeaves = this.getAssistantLeaves();
    if (existingLeaves.length > 0) {
      await this.activateAssistantLeaf(existingLeaves);
      return;
    }

    this.app.workspace.onLayoutReady(() => {
      void this.createAssistantLeafIfMissing();
    });
  }

  private async createAssistantLeafIfMissing(): Promise<void> {
    const existingLeaves = this.getAssistantLeaves();
    if (existingLeaves.length > 0) {
      await this.activateAssistantLeaf(existingLeaves);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState(this.getAssistantViewState());
    await this.revealAssistantLeaf(leaf);
  }

  private async activateAssistantLeaf(leaves: WorkspaceLeaf[]): Promise<void> {
    const [primaryLeaf, ...duplicateLeaves] = leaves;
    if (!primaryLeaf) return;

    await primaryLeaf.setViewState(this.getAssistantViewState());
    await this.revealAssistantLeaf(primaryLeaf);

    if (primaryLeaf.view instanceof CalendarView) {
      this.view = primaryLeaf.view;
    }
    this.view?.refresh();

    duplicateLeaves.forEach((leaf) => {
      if (leaf !== primaryLeaf) {
        leaf.detach();
      }
    });
  }

  private async revealAssistantLeaf(leaf: WorkspaceLeaf): Promise<void> {
    try {
      await this.app.workspace.revealLeaf(leaf);
    } catch (err) {
      console.warn(`[Work Assistant] Failed to reveal ${ASSISTANT_VIEW_DISPLAY_TEXT} view`, err);
    }
  }

  private getAssistantViewState(): ViewState {
    return {
      type: VIEW_TYPE_ASSISTANT,
      active: true,
      state: {
        plugin: this.manifest.id,
        view: ASSISTANT_VIEW_DISPLAY_TEXT,
      },
    };
  }

  private getAssistantLeaves(): WorkspaceLeaf[] {
    const leaves: WorkspaceLeaf[] = [];
    const seen = new Set<WorkspaceLeaf>();
    const addLeaf = (leaf: WorkspaceLeaf | null | undefined) => {
      if (leaf && !seen.has(leaf)) {
        seen.add(leaf);
        leaves.push(leaf);
      }
    };

    this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSISTANT).forEach(addLeaf);
    this.app.workspace.getLeavesOfType(LEGACY_VIEW_TYPE_CALENDAR).forEach((leaf) => {
      if (this.isAssistantLeaf(leaf)) {
        addLeaf(leaf);
      }
    });
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (this.isAssistantLeaf(leaf)) {
        addLeaf(leaf);
      }
    });

    return leaves;
  }

  private isAssistantLeaf(leaf: WorkspaceLeaf): boolean {
    const aliases = ASSISTANT_VIEW_DISPLAY_TEXT_ALIASES.map((alias) => alias.toLowerCase());
    const titles = this.getLeafDisplayTexts(leaf).map((title) => title.toLowerCase());
    const hasAssistantTitle = titles.some((title) => aliases.includes(title));

    try {
      const viewState = leaf.getViewState();
      if (viewState.type === VIEW_TYPE_ASSISTANT) {
        return true;
      }
      if (this.isAssistantViewState(viewState)) {
        return true;
      }
      if (viewState.type === LEGACY_VIEW_TYPE_CALENDAR && hasAssistantTitle) {
        return true;
      }
    } catch (err) {
      console.debug("[Work Assistant] Failed to inspect a workspace leaf state", err);
    }

    if (leaf.view?.getViewType?.() === VIEW_TYPE_ASSISTANT) {
      return true;
    }
    if (leaf.view?.getViewType?.() === LEGACY_VIEW_TYPE_CALENDAR && hasAssistantTitle) {
      return true;
    }

    return hasAssistantTitle;
  }

  private isAssistantViewState(viewState: ViewState): boolean {
    return viewState.state?.plugin === this.manifest.id
      && viewState.state?.view === ASSISTANT_VIEW_DISPLAY_TEXT;
  }

  private getLeafDisplayTexts(leaf: WorkspaceLeaf): string[] {
    const titles = new Set<string>();
    const addTitle = (title: string | null | undefined) => {
      const trimmedTitle = title?.trim();
      if (trimmedTitle) {
        titles.add(trimmedTitle);
      }
    };

    const viewDisplayText = leaf.view?.getDisplayText?.();
    if (typeof viewDisplayText === "string") {
      addTitle(viewDisplayText);
    }

    const leafAny = leaf as WorkspaceLeaf & {
      tabHeaderEl?: HTMLElement;
      tabHeaderInnerTitleEl?: HTMLElement;
    };
    const titleEl = leafAny.tabHeaderInnerTitleEl
      ?? leafAny.tabHeaderEl?.querySelector(".workspace-tab-header-inner-title");
    addTitle(titleEl?.textContent);
    addTitle(leafAny.tabHeaderEl?.textContent);
    return Array.from(titles);
  }

  async loadOptions(): Promise<void> {
    const loadedData = await this.loadData();

    // Check if migration/reset is needed (if missing top-level keys like 'assistant')
    // Reset if structure is outdated to enforce new schema
    let finalSettings = { ...defaultSettings };

    if (loadedData && loadedData.assistant) {
      // Proper deep merge: merge defaults with loaded data at every level
      finalSettings = deepMerge(defaultSettings, loadedData) as ISettings;

      // Migration: statsFile -> statsMdPath rename
      if (typeof loadedData.wordCount?.statsFile === "string" && !loadedData.wordCount?.statsMdPath) {
        finalSettings.wordCount.statsMdPath = loadedData.wordCount.statsFile;
      }
      if (typeof finalSettings.wordCount.statsMdPath !== "string" || !finalSettings.wordCount.statsMdPath.trim()) {
        finalSettings.wordCount.statsMdPath = defaultSettings.wordCount.statsMdPath;
      }
      if (!Number.isInteger(finalSettings.wordCount.shockThreshold) || (finalSettings.wordCount.shockThreshold < -1 || finalSettings.wordCount.shockThreshold === 0)) {
        finalSettings.wordCount.shockThreshold = defaultSettings.wordCount.shockThreshold;
      }

      // Migration: If old pomodoro has systemMedia, migrate it?
      if (loadedData.pomodoro && typeof loadedData.pomodoro.systemMedia === 'boolean' && !loadedData.media) {
        finalSettings.media.enabled = loadedData.pomodoro.systemMedia;
      }

      // Migration: Locale Override (Moved from assistant.calendar -> assistant -> root)
      const oldLocale = (loadedData.assistant?.calendar?.localeOverride) || (loadedData.assistant?.localeOverride);
      if (oldLocale && oldLocale !== "system-default" && finalSettings.localeOverride === "system-default") {
        finalSettings.localeOverride = oldLocale;
      }

      // Migration: weekStart and shouldConfirmBeforeCreate (Moved to assistant.calendar)
      const oldWeekStart = (loadedData as Record<string, any>).weekStart;
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
    const RIBBON_ICON_CLASS = 'obsidian-work-assistant-ribbon-icon';

    // Robust cleanup: Remove by class in case reference was lost or duplicate created
    this.app.workspace.containerEl.querySelectorAll(`.${RIBBON_ICON_CLASS}`).forEach(el => el.detach());

    if (this.ribbonEl) {
      this.ribbonEl.detach();
      this.ribbonEl = null;
    }

    const granularities: Granularity[] = ["day", "week", "month", "quarter", "year"];
    // Access nested periodicNotes
    const enabledGranularities = granularities.filter(g => (this.options.periodicNotes as PeriodicNotesConfig)[g]?.enabled);

    if (enabledGranularities.length) {
      const granularity = enabledGranularities[0];
      this.ribbonEl = this.addRibbonIcon(
        `calendar-${granularity}`,
        getOpenPresentLabel(granularity, this.getObsidianLanguage()),
        (e: MouseEvent) => {
          if (e.type !== "auxclick") {
            this.openPeriodicNote(granularity, window.moment(), {
              inNewSplit: isMetaPressed(e),
            });
          }
        }
      );
      this.ribbonEl.addClass(RIBBON_ICON_CLASS);
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

    const templateContents = await getTemplateContents(this.app, config.templatePath, {
      granularity,
      pluginDir: this.manifest.dir,
      pluginId: this.manifest.id,
    });
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
    if (!Platform.isWin || this.systemMediaMonitor || this.systemMediaStartScheduled) return;

    this.systemMediaStartScheduled = true;
    const startGeneration = ++this.systemMediaStartGeneration;
    this.app.workspace.onLayoutReady(() => {
      if (startGeneration !== this.systemMediaStartGeneration || !this.options.media.enabled || this.systemMediaMonitor) {
        this.systemMediaStartScheduled = false;
        return;
      }

      this.systemMediaStartTimer = window.setTimeout(() => {
        this.systemMediaStartTimer = null;

        if (startGeneration !== this.systemMediaStartGeneration || !this.options.media.enabled || this.systemMediaMonitor) {
          this.systemMediaStartScheduled = false;
          return;
        }

        import('./smtc/SystemMediaMonitor').then(({ SystemMediaMonitor }) => {
          if (startGeneration !== this.systemMediaStartGeneration || !this.options.media.enabled || this.systemMediaMonitor) return;

          this.systemMediaMonitor = new SystemMediaMonitor(this, this.cacheManager);
          this.addChild(this.systemMediaMonitor);

          if (!this.statusBarPlayerEl) {
            const el = this.addStatusBarItem();
            this.statusBarPlayerEl = el;
            this.statusBarPlayer = new StatusBarPlayer(el, this.systemMediaMonitor);
          }
        }).catch((e: Error) => {
          console.error("[Work Assistant] Error importing/initializing SystemMediaMonitor:", e);
        }).then(() => {
          this.systemMediaStartScheduled = false;
        });
      }, 1500);
    });
  }

  private cancelSystemMediaStart(): void {
    if (this.systemMediaStartTimer !== null) {
      window.clearTimeout(this.systemMediaStartTimer);
      this.systemMediaStartTimer = null;
    }
    this.systemMediaStartScheduled = false;
    this.systemMediaStartGeneration++;
  }

  private unloadSystemMedia(): void {
    this.cancelSystemMediaStart();

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
        void this.wordCountStats.handleSettingsChanged();
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

  private async configureTaskSync(): Promise<void> {
    if (!this.taskSyncManager) return;
    await this.taskSyncManager.configure();
    this.configureTaskSyncCommands();
  }

  private configureTaskSyncCommands(): void {
    const commandIds = [
      "sync-tasks-now",
      "sync-tasks-dry-run",
      "view-task-sync-status",
      "refresh-tasks",
    ];
    commandIds.forEach((id) => this.app.commands.removeCommand(`${this.manifest.id}:${id}`));

    if (!this.options.assistant.tasks.enabled || !this.taskSyncManager) return;

    const lang = this.getObsidianLanguage();
    this.addCommand({
      id: "sync-tasks-now",
      name: t("command-tasks-sync-now", lang),
      callback: () => void this.taskSyncManager?.syncNow(),
    });
    this.addCommand({
      id: "sync-tasks-dry-run",
      name: t("command-tasks-sync-preview", lang),
      callback: () => void this.taskSyncManager?.previewSync(),
    });
    this.addCommand({
      id: "view-task-sync-status",
      name: t("command-tasks-sync-status", lang),
      callback: () => void this.taskSyncManager?.showStatus(),
    });
    this.addCommand({
      id: "refresh-tasks",
      name: t("command-tasks-refresh", lang),
      callback: () => void this.taskSyncManager?.refreshLocalTasks(),
    });
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
    const hasActiveWidgets = assistant.calendar.enabled || assistant.flipClock.enabled || assistant.weather.enabled || assistant.tasks.enabled;

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
          return true;
        }
        this.initLeaf();
      },
      hotkeys: []
    });

    this.addCommand({
      id: "reveal-active-note",
      name: t('command-reveal-active-note', lang),
      callback: () => this.view?.revealActiveNote(),
    });

    this.initLeaf();
  }

  private unloadAssistant(): void {
    // Stop background polling
    if (this.weatherService) {
      this.weatherService.stopWarningPolling();
    }
  }
}
