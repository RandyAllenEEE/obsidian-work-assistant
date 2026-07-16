import type { Moment } from "moment";
import { ItemView, FileView } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";


import {
  ASSISTANT_VIEW_DISPLAY_TEXT,
  TRIGGER_ON_OPEN,
  VIEW_TYPE_ASSISTANT,
  DEFAULT_REFRESH_INTERVAL,
} from "src/constants";
import type { ISettings } from "src/settings";

import Calendar from "./ui/Calendar.svelte";
import { mount, unmount } from "svelte";
import { showFileMenu } from "./ui/fileMenu";
import { activeFile, settings } from "./ui/stores";
import {
  customTagsSource,
  streakSource,
  wordCountSource,
  dailyNoteChecklistSource,
  tasksSource,
  createWordCountBackgroundSource,
  createDailyStatsSource,
} from "./ui/sources";
import { WORD_COUNT_STATS_UPDATED_EVENT } from "./wordCountStats";
import type CalendarPlugin from "./main";
import { isMetaPressed } from "./periodic/utils";
import type { Granularity, PeriodicNotesConfig } from "./periodic/types";
import type { ICalendarSource } from "obsidian-calendar-ui";
import { invalidateNoteMetrics } from "./ui/sources/noteMetrics";

export default class CalendarView extends ItemView {
  private calendar: Calendar;
  private plugin: CalendarPlugin;
  private settings: ISettings;
  private refreshTimer: number | undefined;
  private lastRefreshAt = 0;
  private settingsUnsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);

    this.plugin = plugin;
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
    this.registerEvent((<any>this.app.workspace).on(WORD_COUNT_STATS_UPDATED_EVENT, () => this.requestCalendarTick()));
    this.registerEvent(this.app.workspace.on("file-open", this.onFileOpen));

    this.settings = null;
    this.settingsUnsubscribe = settings.subscribe((val) => {
      this.settings = val;
      this.updateHeatmapStyles();
      this.requestCalendarTick();
    });
  }

  private requestCalendarTick(): void {
    if (!this.calendar) return;
    const throttle = Math.max(
      100,
      this.settings?.wordCount.heatmap.refreshInterval || DEFAULT_REFRESH_INTERVAL
    );
    const elapsed = Date.now() - this.lastRefreshAt;
    if (elapsed >= throttle && this.refreshTimer === undefined) {
      this.lastRefreshAt = Date.now();
      this.calendar.tick();
      return;
    }
    if (this.refreshTimer !== undefined) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      this.lastRefreshAt = Date.now();
      this.calendar?.tick();
    }, Math.max(0, throttle - elapsed));
  }

  private stopPendingRefresh(): void {
    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  getViewType(): string {
    return VIEW_TYPE_ASSISTANT;
  }


  getDisplayText(): string {
    return ASSISTANT_VIEW_DISPLAY_TEXT;
  }

  getIcon(): string {
    return "calendar-with-checkmark";
  }

  onClose(): Promise<void> {
    this.stopPendingRefresh();
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
      this.settingsUnsubscribe = null;
    }
    if (this.calendar) {
      unmount(this.calendar);
    }
    return Promise.resolve();
  }

  public async onOpen(): Promise<void> {
    const sources = this.createSources();
    this.app.workspace.trigger(TRIGGER_ON_OPEN, sources);

    this.calendar = mount(Calendar, {
      target: this.contentEl,
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
        taskSyncManager: this.plugin.taskSyncManager,
      }
    }) as unknown as Calendar;
  }

  private updateHeatmapStyles(): void {
    if (!this.settings || !this.settings.wordCount.heatmap.colorRanges) return;
    this.settings.wordCount.heatmap.colorRanges.forEach((range, index) => {
      this.containerEl.style.setProperty(`--heatmap-opacity-${index}`, range.opacity.toString());
    });
  }

  private createSources(): ICalendarSource[] {
    const sources = [
      customTagsSource,
      streakSource,
      wordCountSource,
      dailyNoteChecklistSource,
      tasksSource,
    ];

    sources.push(createWordCountBackgroundSource(() => this.plugin.wordCountStats));
    sources.push(createDailyStatsSource(() => this.plugin.wordCountStats));

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
    const { format } = this.plugin.options.periodicNotes.day;
    const note = this.plugin.cache?.getPeriodicNote("day", date);
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
    const note = this.plugin.cache?.getPeriodicNote("week", date);
    const { format } = this.plugin.options.periodicNotes.week;
    this.app.workspace.trigger(
      "link-hover",
      this,
      targetEl,
      date.format(format),
      note?.path
    );
  }

  private onClickMonth(e: MouseEvent | KeyboardEvent, date: Moment): void {
    if (date) {
      this.tryOpenPeriodicNote("month", date, isMetaPressed(e));
    }
  }

  private onClickYear(e: MouseEvent | KeyboardEvent, date: Moment): void {
    if (date) {
      this.tryOpenPeriodicNote("year", date, isMetaPressed(e));
    }
  }

  private onContextMenuDay(date: Moment, event: MouseEvent): void {
    const note = this.plugin.cache?.getPeriodicNote("day", date);
    if (!note) {
      return;
    }
    showFileMenu(this.app, note, {
      x: event.pageX,
      y: event.pageY,
    });
  }

  private onContextMenuWeek(date: Moment, event: MouseEvent): void {
    const note = this.plugin.cache?.getPeriodicNote("week", date);
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
    invalidateNoteMetrics(file.path);
    this.updateActiveFile();
  }

  private async onFileModified(file: TFile): Promise<void> {
    invalidateNoteMetrics(file.path);
    const meta = this.plugin.cache?.find(file.path);
    if (meta) {
      this.requestCalendarTick();
    }
  }

  private onFileCreated(file: TFile): void {
    if (this.app.workspace.layoutReady && this.calendar) {
      const meta = this.plugin.cache?.find(file.path);
      if (meta) {
        this.requestCalendarTick();
      }
    }
  }

  public onFileOpen(_file: TFile): void {
    if (this.app.workspace.layoutReady) {
      this.updateActiveFile();
    }
  }

  private updateActiveFile(): void {
    const view = this.app.workspace.activeLeaf?.view;

    let file = null;
    if (view instanceof FileView) {
      file = view.file;
    }
    activeFile.setFile(file);

    if (this.calendar) {
      this.requestCalendarTick();
    }
  }

  public revealActiveNote(): void {
    const { activeLeaf } = this.app.workspace;

    if (activeLeaf.view instanceof FileView) {
      const file = activeLeaf.view.file;
      const meta = this.plugin.cache?.find(file.path);
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
    if (!this.plugin.options.periodicNotes.enabled
      || !this.plugin.options.periodicNotes.calendarLinkage) {
      return;
    }

    const { enabled } = (this.plugin.options.periodicNotes as unknown as PeriodicNotesConfig)[granularity];
    if (enabled) {
      await this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
    }
  }

  public refresh(): void {
    this.requestCalendarTick();
  }
}
