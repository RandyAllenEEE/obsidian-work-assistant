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
  import WeatherBanner from "../weather/WeatherBanner.svelte";
  import WeatherWarningBanner from "../weather/WeatherWarningBanner.svelte";
  import FlipClock from "./FlipClock.svelte";
  import type { QWeatherService } from "../weather/QWeatherService";

  export let today: Moment = window.moment();
  export let localeData: Locale = today.localeData();

  $: if (!today) {
    today = getToday($settings);
  }

  export let displayedMonth: Moment = undefined;
  export let weatherService: QWeatherService = undefined;
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
    const localeOverride =
      settings.localeOverride === "system-default"
        ? null
        : settings.localeOverride;
    configureGlobalMomentLocale(
      localeOverride,
      settings.assistant.calendar.weekStart,
    );
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

{#each $settings.assistant.widgetOrder || ["flipClock", "calendar", "weather"] as widget (widget)}
  <div class="widget-container">
    {#if widget === "calendar"}
      {#if $settings.assistant.calendar.enabled}
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
      {/if}
    {:else if widget === "flipClock"}
      {#if $settings.assistant.flipClock.enabled}
        <FlipClock />
      {/if}
    {:else if widget === "weather"}
      {#if $settings.assistant.weather.enabled}
        <div class="weather-container">
          <WeatherWarningBanner {weatherService} />
          <WeatherBanner {weatherService} />
        </div>
      {/if}
    {/if}
  </div>
{/each}

<style>
  .widget-container {
    margin-bottom: 16px; /* Consistent spacing */
    width: 100%;
    display: flex;
    justify-content: center;
    flex-direction: column;
    align-items: center;
  }
  .widget-container:last-child {
    margin-bottom: 0;
  }
  .weather-container {
    width: 100%;
  }
</style>
