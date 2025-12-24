<script lang="ts">
  import type { Locale, Moment } from "moment";

  import Day from "./Day.svelte";
  import Nav from "./Nav.svelte";
  import WeekNum from "./WeekNum.svelte";
  import { getDailyMetadata, getWeeklyMetadata } from "../metadata";
  import type { ICalendarSource, IMonth } from "../types";
  import { getDaysOfWeek, getMonth, isWeekend } from "../utils";

  // Localization
  export let localeData: Locale;

  // Settings
  export let showWeekNums: boolean = false;

  // Event Handlers
  export let onHoverDay: (
    date: Moment,
    targetEl: EventTarget,
    isMetaPressed: boolean,
  ) => void;
  export let onHoverWeek: (
    date: Moment,
    targetEl: EventTarget,
    isMetaPressed: boolean,
  ) => void;
  export let onContextMenuDay: (date: Moment, event: MouseEvent) => void;
  export let onContextMenuWeek: (date: Moment, event: MouseEvent) => void;
  export let onClickDay: (date: Moment, isMetaPressed: boolean) => void;
  export let onClickWeek: (date: Moment, isMetaPressed: boolean) => void;
  export let onClickMonth: (
    e: MouseEvent | KeyboardEvent,
    date: Moment,
  ) => void = undefined;
  export let onClickYear: (
    e: MouseEvent | KeyboardEvent,
    date: Moment,
  ) => void = undefined;

  // External sources (All optional)
  export let sources: ICalendarSource[] = [];
  export let selectedId: string = null;

  // Override-able local state
  export let today: Moment = window.moment();
  export let displayedMonth = today;

  let month: IMonth;
  let daysOfWeek: { full: string; short: string }[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let isMobile = (window.app as any).isMobile;

  $: month = getMonth(displayedMonth, localeData);
  $: daysOfWeek = getDaysOfWeek(today, localeData);

  // Exports
  export function incrementDisplayedMonth() {
    displayedMonth = displayedMonth.clone().add(1, "month");
  }

  export function decrementDisplayedMonth() {
    displayedMonth = displayedMonth.clone().subtract(1, "month");
  }

  export function resetDisplayedMonth() {
    displayedMonth = today.clone();
  }
</script>

<div id="calendar-container" class="container" class:is-mobile={isMobile}>
  <Nav
    {today}
    {displayedMonth}
    {incrementDisplayedMonth}
    {decrementDisplayedMonth}
    {resetDisplayedMonth}
    {onClickMonth}
    {onClickYear}
  />
  <table class="calendar">
    <colgroup>
      {#if showWeekNums}
        <col />
      {/if}
      {#each month[1].days as date}
        <col class:weekend={isWeekend(date)} />
      {/each}
    </colgroup>
    <thead>
      <tr>
        {#if showWeekNums}
          <th>W</th>
        {/if}
        {#each daysOfWeek as dayOfWeek}
          <th>
            <span class="day-full">{dayOfWeek.full}</span>
            <span class="day-short">{dayOfWeek.short}</span>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each month as week (week.weekNum)}
        <tr>
          {#if showWeekNums}
            <WeekNum
              {...week}
              metadata={getWeeklyMetadata(sources, week.days[0], today)}
              onClick={onClickWeek}
              onContextMenu={onContextMenuWeek}
              onHover={onHoverWeek}
              {selectedId}
            />
          {/if}
          {#each week.days as day (day.format())}
            <Day
              date={day}
              {today}
              {displayedMonth}
              onClick={onClickDay}
              onContextMenu={onContextMenuDay}
              onHover={onHoverDay}
              metadata={getDailyMetadata(sources, day, today)}
              {selectedId}
            />
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .container {
    --color-background-heading: transparent;
    --color-background-day: transparent;
    --color-background-weeknum: transparent;
    --color-background-weekend: transparent;

    --color-dot: var(--text-muted);
    --color-arrow: var(--text-muted);
    --color-button: var(--text-muted);

    --color-text-title: var(--text-normal);
    --color-text-heading: var(--text-muted);
    --color-text-day: var(--text-normal);
    --color-text-today: var(--interactive-accent);
    --color-text-weeknum: var(--text-muted);

    container-type: inline-size;
  }

  .container {
    padding: 0 8px;
  }

  .container.is-mobile {
    padding: 0;
  }

  th {
    text-align: center;
  }

  .weekend {
    background-color: var(--color-background-weekend);
  }

  .calendar {
    border-collapse: collapse;
    width: 100%;
  }

  th {
    background-color: var(--color-background-heading);
    color: var(--color-text-heading);
    font-size: 0.6em;
    letter-spacing: 1px;
    padding: 4px;
    text-transform: uppercase;
  }

  .day-short {
    display: none;
  }

  @container (max-width: 280px) {
    .day-full {
      display: none;
    }
    th .day-short {
      display: inline;
    }
  }
</style>
