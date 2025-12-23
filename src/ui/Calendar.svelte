<script lang="ts">
  import type { Moment } from "moment";
  import {
    Calendar as CalendarBase,
    configureGlobalMomentLocale,
  } from "../calendar-ui";
  import type { ICalendarSource } from "../calendar-ui";
  import { onDestroy } from "svelte";
  import type { Locale } from "moment";

  import type { ISettings } from "src/settings";
  import { dailyNotes, settings, weeklyNotes } from "./stores";

  export let today: Moment = window.moment();
  export let localeData: Locale = today.localeData();

  $: if (!today) {
    today = getToday($settings);
  }

  export let displayedMonth: Moment = undefined;
  export let sources: ICalendarSource[] = [];
  export let onHoverDay: (
    date: Moment,
    targetEl: EventTarget,
    isMetaPressed: boolean,
  ) => void = () => {};
  export let onHoverWeek: (
    date: Moment,
    targetEl: EventTarget,
    isMetaPressed: boolean,
  ) => void = () => {};
  export let onClickDay: (
    date: Moment,
    isMetaPressed: boolean,
  ) => void = () => {};
  export let onClickWeek: (
    date: Moment,
    isMetaPressed: boolean,
  ) => void = () => {};
  export let onContextMenuDay: (
    date: Moment,
    event: MouseEvent,
  ) => void = () => {};
  export let onContextMenuWeek: (
    date: Moment,
    event: MouseEvent,
  ) => void = () => {};

  export let onClickMonth: (
    e: MouseEvent | KeyboardEvent,
    date: Moment,
  ) => void = () => {};
  export let onClickYear: (
    e: MouseEvent | KeyboardEvent,
    date: Moment,
  ) => void = () => {};

  $: showWeekNums = true;

  export function tick() {
    today = window.moment();
  }

  function getToday(settings: ISettings) {
    // Removed localeOverride since it's no longer in ISettings
    configureGlobalMomentLocale(null, settings.weekStart);
    dailyNotes.reindex();
    weeklyNotes.reindex();
    return window.moment();
  }

  // 1 minute heartbeat to keep `today` reflecting the current day
  let heartbeat = setInterval(() => {
    tick();

    const isViewingCurrentMonth = displayedMonth.isSame(today, "day");
    if (isViewingCurrentMonth) {
      // if it's midnight on the last day of the month, this will
      // update the display to show the new month.
      displayedMonth = today;
    }
  }, 1000 * 60);

  onDestroy(() => {
    clearInterval(heartbeat);
  });
</script>

<CalendarBase
  {sources}
  {today}
  {onHoverDay}
  {onHoverWeek}
  {onContextMenuDay}
  {onContextMenuWeek}
  {onClickDay}
  {onClickWeek}
  bind:displayedMonth
  localeData={localeData || today.localeData()}
  {showWeekNums}
  {onClickMonth}
  {onClickYear}
/>
