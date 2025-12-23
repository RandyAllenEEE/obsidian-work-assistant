import type { Moment, WeekSpec } from "moment";
import { Plugin, addIcon, debounce } from "obsidian";
import type { App, WorkspaceLeaf, TFile } from "obsidian";
import type { Writable } from "svelte/store";

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
import { settings } from "./ui/stores";
import {
  CalendarSettingsTab,
} from "./settings";
import type { ISettings } from "./settings";
import CalendarView from "./view";
import WordCountStats from "./wordCountStats";
import { t } from "./i18n";
import type { Language } from "./i18n";

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
  private ribbonEl: HTMLElement | null;

  public cache: PeriodicNotesCache;


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
      await this.saveData(this.options);
      this.configureCommands();
      this.configureRibbonIcons();
      this.app.workspace.trigger("periodic-notes:settings-updated");

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
  }

  async onload(): Promise<void> {
    await this.loadOptions();

    // Initialize word count stats
    this.wordCountStats = new WordCountStats(this);

    // Initialize status bar
    this.statusBarEl = this.addStatusBarItem();

    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-quarter", calendarQuarterIcon);
    addIcon("calendar-year", calendarYearIcon);

    this.settings = settings; // Expose the store
    this.ribbonEl = null;
    this.cache = new PeriodicNotesCache(this.app, this);

    this.register(
      settings.subscribe((value) => {
        this.options = value;
        this.onSettingsUpdate();
      })
    );

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf: WorkspaceLeaf) => (this.view = new CalendarView(leaf, this))
    );

    // Get the current language from Obsidian
    const lang: Language = this.getObsidianLanguage();

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
        this.statusBarEl.setText(t('status-bar-words-today', lang).replace('{count}', currentWordCount.toString()));
      }, 200)
    );

    // Removed locale change listener due to unsupported event type

    this.initLeaf();
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
      // Simple migration: if calendarSets exists, try to take the active one
      // Otherwise, merge options directly
      let migratedOptions = {};
      if (options?.calendarSets && options?.activeCalendarSet) {
        // Migration logic
        const activeSet = options.calendarSets.find((s: any) => s.id === options.activeCalendarSet);
        if (activeSet) {
          migratedOptions = {
            day: activeSet.day,
            week: activeSet.week,
            month: activeSet.month,
            quarter: activeSet.quarter,
            year: activeSet.year,
            // Preserve other settings if they exist at root
            ...options
          };
          // Clean up legacy keys
          delete (migratedOptions as any).calendarSets;
          delete (migratedOptions as any).activeCalendarSet;
        } else {
          migratedOptions = { ...(options || {}) };
        }
      } else {
        migratedOptions = { ...(options || {}) };
      }

      const newSettings = {
        ...old,
        ...migratedOptions,
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
    settings.update((old) => ({ ...old, ...changeOpts(old) }));
    await this.saveData(this.options);

    this.configureCommands();
    this.configureRibbonIcons();
    this.app.workspace.trigger("periodic-notes:settings-updated");

    // Refresh the calendar view if it exists to apply new settings
    if (this.view) {
      // Trigger a refresh to apply new settings
      this.view.refresh();
    }
  }

  private configureRibbonIcons() {
    this.ribbonEl?.detach();

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
}
