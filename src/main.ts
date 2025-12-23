import type { Moment, WeekSpec } from "moment";
import { Plugin, addIcon, debounce, TFile } from "obsidian";
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

import { ConfirmationModal } from "./ui/modal";
import type { Granularity } from "./periodic/types";
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
} from "./settings";
import type { ISettings } from "./settings";
import CalendarView from "./view";
import WordCountStats from "./wordCountStats";
import { t } from "./i18n";
import type { Language } from "./i18n";
import { Timer, Mode } from "./pomo/timer";

declare global {
  interface Window {
    app: App;
    _bundledLocaleWeekSpec: WeekSpec;
  }
}

export default class CalendarPlugin extends Plugin {
  public options: ISettings;
  public settings: Writable<ISettings>;
  private view: CalendarView;
  public wordCountStats: WordCountStats;
  private statusBarEl: HTMLElement;
  private pomoStatusBarEl: HTMLElement;
  public timer: Timer;
  private ribbonEl: HTMLElement | null;
  public cache: PeriodicNotesCache;
  private isInitialized = false;
  private debouncedSync: () => void;


  private getObsidianLanguage(): Language {
    // simplified language detection using moment.locale() which is the standard way in Obsidian
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
      // Cache reset is now handled in writeOptions conditionally
      // this.app.workspace.trigger("periodic-notes:settings-updated");

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
      this.timer.quitTimer();
    }
  }

  async onload(): Promise<void> {
    this.settings = settings;
    this.register(
      settings.subscribe((value) => {
        this.options = value;
        this.onSettingsUpdate();
      })
    );

    await this.loadOptions();
    const lang: Language = this.getObsidianLanguage();

    this.cache = new PeriodicNotesCache(this.app, this);

    // Initialize word count stats
    this.wordCountStats = new WordCountStats(this);

    this.debouncedSync = debounce(() => this.syncCacheToStores(), 200);

    this.registerEvent(
      this.app.workspace.on("periodic-notes:resolve", () => {
        this.debouncedSync();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      // The cache initialization will trigger sync via periodic-notes:resolve
    });

    // Initialize status bar
    this.statusBarEl = this.addStatusBarItem();

    // Initialize Pomo Timer
    this.timer = new Timer(this);
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

    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-quarter", calendarQuarterIcon);
    addIcon("calendar-year", calendarYearIcon);

    this.ribbonEl = null;

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf: WorkspaceLeaf) => (this.view = new CalendarView(leaf, this))
    );

    this.configureRibbonIcons();
    this.configureCommands();



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

    // Old commands replaced by configureCommands()
    // this.addCommand({ id: "open-weekly-note", ... });

    this.addCommand({
      id: "reveal-active-note",
      name: t('command-reveal-active-note', lang),
      callback: () => this.view.revealActiveNote(),
    });


    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    // Register interval to update status bar
    this.registerInterval(
      window.setInterval(() => {
        // Get the current language from Obsidian
        const lang: Language = this.getObsidianLanguage();
        const currentWordCount = this.wordCountStats ? this.wordCountStats.currentWordCount : 0;

        let text = t('status-bar-words-today', lang).replace('{count}', currentWordCount.toString());

        // Improve status bar: "x / y" where x is current file change, y is total today change
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md' && this.wordCountStats) {
          const fileChange = this.wordCountStats.getFileCountChange(activeFile.path);
          const detailText = t('status-bar-words-today-detail', lang)
            .replace('{file}', fileChange.toString())
            .replace('{total}', currentWordCount.toString());

          // Only use detailed text if the key exists (fallback safe)
          if (detailText !== 'status-bar-words-today-detail') {
            text = detailText;
          }
        }

        this.statusBarEl.setText(text);
      }, 200)
    );

    // Register interval to update pomo status bar
    this.registerInterval(
      window.setInterval(async () => {
        const text = await this.timer.setStatusBarText();
        this.pomoStatusBarEl.setText(text);
      }, 100)
    );

    this.addPomoCommands(lang);

    // Removed locale change listener due to unsupported event type

    this.initLeaf();
    this.isInitialized = true;
  }

  initLeaf(): void {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length) {
      return;
    }

    // Wait for layout to be ready before trying to add the leaf
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
    const options = await this.loadData();
    settings.update((old) => {
      const newSettings = {
        ...old,
        ...(options || {}),
      };

      // Fix JSON serialization where Infinity becomes null
      if (newSettings.wordCountColorRanges) {
        newSettings.wordCountColorRanges.forEach(range => {
          if (range.max === null) {
            range.max = Infinity;
          }
        });
      }

      return newSettings;
    });

    await this.saveData(this.options);
  }

  async writeOptions(
    changeOpts: (settings: ISettings) => Partial<ISettings>
  ): Promise<void> {
    let newSettings: Partial<ISettings> = {};
    settings.update((old) => {
      newSettings = changeOpts(old);
      return { ...old, ...newSettings };
    });
    await this.saveData(this.options);

    // Determine if cache reset is needed
    // Cache depends on: granularity configs (folder, format, enabled) and weekStart
    const cacheAffectingKeys = ['weekStart', 'day', 'week', 'month', 'quarter', 'year'];
    const shouldResetCache = Object.keys(newSettings).some(key => cacheAffectingKeys.includes(key));

    this.configureCommands();
    this.configureRibbonIcons();

    if (shouldResetCache) {
      console.log("[Work Assistant] Settings changed requiring cache reset");
      this.app.workspace.trigger("periodic-notes:settings-updated");
    }

    // Refresh the calendar view if it exists to apply new settings
    if (this.view) {
      // Trigger a refresh to apply new settings
      this.view.refresh();
    }
  }

  private configureRibbonIcons(): void {
    if (this.ribbonEl) {
      if (typeof (this.ribbonEl as any).detach === 'function') {
        (this.ribbonEl as any).detach();
      } else if (typeof (this.ribbonEl as any).remove === 'function') {
        (this.ribbonEl as any).remove();
      }
      this.ribbonEl = null;
    }



    // Calendar Ribbon Icon
    const granularities: Granularity[] = ["day", "week", "month", "quarter", "year"];
    const enabledGranularities = granularities.filter(g => this.options[g]?.enabled);

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


  private configureCommands() {
    const granularities: Granularity[] = ["day", "week", "month", "quarter", "year"];

    // Remove disabled commands (by removing all, simpler than tracking what was added)
    // Actually standard practice is to overwrite. Obsidian handles ID collisions by overwriting.
    // But we might want to unregister commands that are now disabled. 
    // Obsidian API doesn't make unregistering easy/public. 
    // Usually plugins just register what's enabled.
    // However, if we disable a setting, the command remains until reload if we don't unregister.
    // We can iterate all known IDs and remove them first.
    granularities.forEach(g => {
      getCommands(this.app, this, g).forEach(cmd => {
        this.app.commands.removeCommand(`work-assistant:${cmd.id}`);
      });
    });

    // register enabled commands
    granularities.filter(g => this.options[g]?.enabled).forEach(granularity => {
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
      // We need createPeriodicNote method
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
    const config = this.options[granularity];
    const format = config.format;
    const filename = date.format(format);

    if (this.options.shouldConfirmBeforeCreate) {
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
    return this.cache.getPeriodicNote(
      granularity,
      date
    );
  }

  public getPeriodicNotes(
    granularity: Granularity,
    date: Moment,
    includeFinerGranularities = false
  ): PeriodicNoteCachedMetadata[] {
    return this.cache.getPeriodicNotes(
      granularity,
      date,
      includeFinerGranularities
    );
  }

  public isPeriodic(filePath: string, granularity?: Granularity): boolean {
    return this.cache.isPeriodic(filePath, granularity);
  }

  public findInCache(filePath: string): PeriodicNoteCachedMetadata | null {
    return this.cache.find(filePath);
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards"
  ): PeriodicNoteCachedMetadata | null {
    return this.cache.findAdjacent(filePath, direction);
  }

  public syncCacheToStores() {
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

    console.log(`[Work Assistant] Syncing to stores: ${Object.keys(dailyData).length} daily, ${Object.keys(weeklyData).length} weekly`);
    dailyNotes.reindex(dailyData);
    weeklyNotes.reindex(weeklyData);
  }
  private addPomoCommands(lang: Language) {
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
}
