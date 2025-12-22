import type { Moment, WeekSpec } from "moment";
import { App, Plugin, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CALENDAR } from "./constants";
import { settings } from "./ui/stores";
import {
  appHasPeriodicNotesPluginLoaded,
  CalendarSettingsTab,
  ISettings,
} from "./settings";
import CalendarView from "./view";
import WordCountStats from "./wordCountStats";
import { t, Language } from "./i18n";

declare global {
  interface Window {
    app: App;
    moment: () => Moment;
    _bundledLocaleWeekSpec: WeekSpec;
  }
}

export default class CalendarPlugin extends Plugin {
  public options: ISettings;
  private view: CalendarView;
  private wordCountStats: WordCountStats;
  private statusBarEl: HTMLElement;

  private getObsidianLanguage(): Language {
    // simplified language detection using moment.locale() which is the standard way in Obsidian
    const momentLang = window.moment.locale();
    if (momentLang.startsWith('zh')) {
      return 'zh-cn';
    }
    return 'en';
  }

  onunload(): void {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CALENDAR)
      .forEach((leaf) => leaf.detach());
  }

  async onload(): Promise<void> {
    // Initialize word count stats
    this.wordCountStats = new WordCountStats(this);

    // Initialize status bar
    this.statusBarEl = this.addStatusBarItem();

    this.register(
      settings.subscribe((value) => {
        this.options = value;
      })
    );

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf: WorkspaceLeaf) => (this.view = new CalendarView(leaf, this.wordCountStats))
    );

    // Get the current language from Obsidian
    const lang: Language = this.getObsidianLanguage();

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
    });

    this.addCommand({
      id: "open-weekly-note",
      name: t('command-open-weekly-note', lang),
      checkCallback: (checking) => {
        if (checking) {
          return !appHasPeriodicNotesPluginLoaded();
        }
        this.view.openOrCreateWeeklyNote(window.moment(), false);
      },
    });

    this.addCommand({
      id: "reveal-active-note",
      name: t('command-reveal-active-note', lang),
      callback: () => this.view.revealActiveNote(),
    });

    await this.loadOptions();

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
      return {
        ...old,
        ...(options || {}),
      };

      // Fix JSON serialization where Infinity becomes null
      if (old.wordCountColorRanges) {
        old.wordCountColorRanges.forEach(range => {
          if (range.max === null) {
            range.max = Infinity;
          }
        });
      }

      return old;
    });

    await this.saveData(this.options);
  }

  async writeOptions(
    changeOpts: (settings: ISettings) => Partial<ISettings>
  ): Promise<void> {
    settings.update((old) => ({ ...old, ...changeOpts(old) }));
    await this.saveData(this.options);

    // Refresh the calendar view if it exists to apply new settings
    if (this.view) {
      // Trigger a refresh to apply new settings
      this.view.refresh();
    }
  }
}
