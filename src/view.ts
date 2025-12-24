import type { Moment } from "moment";
import { ItemView, FileView } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";


import { TRIGGER_ON_OPEN, VIEW_TYPE_CALENDAR, DEFAULT_REFRESH_INTERVAL } from "src/constants";
import type { ISettings } from "src/settings";

import Calendar from "./ui/Calendar.svelte";
import { mount, unmount } from "svelte";
import { showFileMenu } from "./ui/fileMenu";
import { activeFile, settings } from "./ui/stores";
import {
  customTagsSource,
  streakSource,
  wordCountSource,
  tasksSource,
  createWordCountBackgroundSource,
  createDailyStatsSource,
} from "./ui/sources";
import WordCountStats from "./wordCountStats";
import type CalendarPlugin from "./main";
import { isMetaPressed } from "./periodic/utils";
import type { Granularity } from "./periodic/types";

export default class CalendarView extends ItemView {
  private calendar: Calendar;
  private plugin: CalendarPlugin;
  private settings: ISettings;
  private wordCountStats: WordCountStats;
  private refreshInterval: number | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);

    this.plugin = plugin;
    this.wordCountStats = plugin.wordCountStats;

    this.openOrCreateDailyNote = this.openOrCreateDailyNote.bind(this);
    this.openOrCreateWeeklyNote = this.openOrCreateWeeklyNote.bind(this);

    this.onNoteSettingsUpdate = this.onNoteSettingsUpdate.bind(this);
    this.onFileCreated = this.onFileCreated.bind(this);
    this.onFileDeleted = this.onFileDeleted.bind(this);
    this.onFileModified = this.onFileModified.bind(this);
    this.onFileOpen = this.onFileOpen.bind(this);

    this.onHoverDay = this.onHoverDay.bind(this);
    this.onHoverWeek = this.onHoverWeek.bind(this);

    this.onClickMonth = this.onClickMonth.bind(this);
    this.onClickYear = this.onClickYear.bind(this);

    this.onContextMenuDay = this.onContextMenuDay.bind(this);
    this.onContextMenuWeek = this.onContextMenuWeek.bind(this);

    this.registerEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (<any>this.app.workspace).on(
        "periodic-notes:settings-updated",
        this.onNoteSettingsUpdate
      )
    );
    this.registerEvent(this.app.vault.on("create", this.onFileCreated));
    this.registerEvent(this.app.vault.on("delete", this.onFileDeleted));
    this.registerEvent(this.app.vault.on("modify", this.onFileModified));
    this.registerEvent(this.app.workspace.on("file-open", this.onFileOpen));

    this.settings = null;
    settings.subscribe((val) => {
      this.settings = val;
      this.resetRefreshInterval();
      this.updateHeatmapStyles();
      if (this.calendar) {
        // In Svelte 5 with mount(), we need to recreate the component
        // to update props, or better yet, just refresh the calendar
        this.calendar.tick();
      }
    });
  }

  private resetRefreshInterval() {
    this.stopRefreshInterval();
    this.startRefreshInterval();
  }

  private startRefreshInterval() {
    const intervalTime = this.settings?.heatmapRefreshInterval || DEFAULT_REFRESH_INTERVAL;
    if (this.refreshInterval) {
      window.clearInterval(this.refreshInterval);
    }
    this.refreshInterval = window.setInterval(() => {
      if (this.calendar) {
        this.calendar.tick();
      }
    }, intervalTime);
  }

  private stopRefreshInterval() {
    if (this.refreshInterval) {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return "Calendar";
  }

  getIcon(): string {
    return "calendar-with-checkmark";
  }

  onClose(): Promise<void> {
    this.stopRefreshInterval();
    if (this.calendar) {
      unmount(this.calendar);
    }
    return Promise.resolve();
  }

  async onOpen(): Promise<void> {
    const sources = this.createSources();
    this.app.workspace.trigger(TRIGGER_ON_OPEN, sources);

    this.calendar = mount(Calendar, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target: (this as any).contentEl,
      props: {
        onClickDay: this.openOrCreateDailyNote,
        onClickWeek: this.openOrCreateWeeklyNote,
        onClickMonth: this.onClickMonth,
        onClickYear: this.onClickYear,
        onHoverDay: this.onHoverDay,
        onHoverWeek: this.onHoverWeek,
        onContextMenuDay: this.onContextMenuDay,
        onContextMenuWeek: this.onContextMenuWeek,
        sources,
        today: window.moment(),
        localeData: window.moment().localeData(),
        displayedMonth: window.moment(),
        weatherService: this.plugin.weatherService,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  }

  private updateHeatmapStyles() {
    if (!this.settings || !this.settings.wordCountColorRanges) return;
    this.settings.wordCountColorRanges.forEach((range, index) => {
      this.containerEl.style.setProperty(`--heatmap-opacity-${index}`, range.opacity.toString());
    });
  }

  private createSources() {
    const sources = [
      customTagsSource,
      streakSource,
      wordCountSource,
      tasksSource,
    ];

    if (this.settings?.enableHeatmap && this.wordCountStats) {
      sources.push(createWordCountBackgroundSource(this.wordCountStats));
    }

    if (this.wordCountStats) {
      sources.push(createDailyStatsSource(this.wordCountStats));
    }

    return sources;
  }

  onHoverDay(
    date: Moment,
    targetEl: EventTarget,
    isMetaPressed: boolean
  ): void {
    if (!isMetaPressed) {
      return;
    }
    const { format } = this.plugin.options["day"];
    const note = this.plugin.cache.getPeriodicNote("day", date);
    this.app.workspace.trigger(
      "link-hover",
      this,
      targetEl,
      date.format(format),
      note?.path
    );
  }

  onHoverWeek(
    date: Moment,
    targetEl: EventTarget,
    isMetaPressed: boolean
  ): void {
    if (!isMetaPressed) {
      return;
    }
    const note = this.plugin.cache.getPeriodicNote("week", date);
    const { format } = this.plugin.options["week"];
    this.app.workspace.trigger(
      "link-hover",
      this,
      targetEl,
      date.format(format),
      note?.path
    );
  }

  private onClickMonth(e: MouseEvent | KeyboardEvent, date: Moment) {
    if (date) {
      this.tryOpenPeriodicNote("month", date, isMetaPressed(e));
    }
  }

  private onClickYear(e: MouseEvent | KeyboardEvent, date: Moment) {
    if (date) {
      this.tryOpenPeriodicNote("year", date, isMetaPressed(e));
    }
  }

  private onContextMenuDay(date: Moment, event: MouseEvent): void {
    const note = this.plugin.cache.getPeriodicNote("day", date);
    if (!note) {
      return;
    }
    showFileMenu(this.app, note, {
      x: event.pageX,
      y: event.pageY,
    });
  }

  private onContextMenuWeek(date: Moment, event: MouseEvent): void {
    const note = this.plugin.cache.getPeriodicNote("week", date);
    if (!note) {
      return;
    }
    showFileMenu(this.app, note, {
      x: event.pageX,
      y: event.pageY,
    });
  }

  private onNoteSettingsUpdate(): void {
    this.updateActiveFile();
  }

  private async onFileDeleted(file: TFile): Promise<void> {
    const meta = this.plugin.cache.find(file.path);
    if (meta) {
      this.updateActiveFile();
    }
  }

  private async onFileModified(file: TFile): Promise<void> {
    const meta = this.plugin.cache.find(file.path);
    if (meta && this.calendar) {
      this.calendar.tick();
    }
  }

  private onFileCreated(file: TFile): void {
    if (this.app.workspace.layoutReady && this.calendar) {
      const meta = this.plugin.cache.find(file.path);
      if (meta) {
        this.calendar.tick();
      }
    }
  }

  public onFileOpen(_file: TFile): void {
    if (this.app.workspace.layoutReady) {
      this.updateActiveFile();
    }
  }

  private updateActiveFile(): void {
    const { view } = this.app.workspace.activeLeaf;

    let file = null;
    if (view instanceof FileView) {
      file = view.file;
    }
    activeFile.setFile(file);

    if (this.calendar) {
      this.calendar.tick();
    }
  }

  public revealActiveNote(): void {
    const { activeLeaf } = this.app.workspace;

    if (activeLeaf.view instanceof FileView) {
      const file = activeLeaf.view.file;
      const meta = this.plugin.cache.find(file.path);
      if (meta) {
        // In Svelte 5, we can't use $set, so we'll need to use bind:displayedMonth
        // For now, we'll just refresh the Calendar component to show the current month
        // The displayedMonth prop should be managed internally by the Calendar component
      }
    }
  }

  async openOrCreateWeeklyNote(
    date: Moment,
    inNewSplit: boolean
  ): Promise<void> {
    await this.tryOpenPeriodicNote("week", date, inNewSplit);
  }

  async openOrCreateDailyNote(
    date: Moment,
    inNewSplit: boolean
  ): Promise<void> {
    await this.tryOpenPeriodicNote("day", date, inNewSplit);
  }

  private async tryOpenPeriodicNote(
    granularity: Granularity,
    date: Moment,
    inNewSplit: boolean
  ): Promise<void> {
    // Check Linkage setting first
    if (!this.plugin.options.enablePeriodicNotesCalendarLinkage) {
      return;
    }

    const { enabled } = this.plugin.options[granularity];
    if (enabled) {
      await this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
    }
  }

  public refresh(): void {
    if (this.calendar) {
      unmount(this.calendar);
      this.onOpen();
    }
  }
}
