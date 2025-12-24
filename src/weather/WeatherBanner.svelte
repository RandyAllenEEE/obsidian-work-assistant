<script lang="ts">
  import { onMount, tick } from "svelte";

  import type {
    QWeatherService,
    WeatherData,
    HourlyForecast,
    DailyForecast,
  } from "./QWeatherService";
  import { settings, pluginCache } from "../ui/stores";
  import { QWeatherIcons } from "./qweatherIcons";

  export let weatherService: QWeatherService;

  let loading = false;

  $: weatherCache = $pluginCache.weather;
  $: current = weatherCache?.weatherData;
  $: hourlyRaw = weatherCache?.hourlyData || [];
  $: dailyRaw = weatherCache?.dailyData || [];
  // Simple language check based on moment locale which Obsidian manages
  $: isChinese = window.moment.locale().toLowerCase().startsWith("zh");

  // Filter Hourly: Show from current hour onwards
  $: hourlyFiltered = hourlyRaw.filter((h: HourlyForecast) => {
    const hTime = window.moment(h.fxTime);
    const now = window.moment();
    return hTime.isSameOrAfter(now, "hour");
  });

  // Combine Current + Hourly
  $: displayList = current
    ? [
        {
          type: "now",
          time: isChinese ? "当前" : "Now",
          temp: current.temp,
          icon: current.icon,
          text: current.text,
          isHighligt: true,
        },
        ...hourlyFiltered.map((h: HourlyForecast) => ({
          type: "hourly",
          time: window.moment(h.fxTime).format("HH:mm"),
          temp: h.temp,
          icon: h.icon,
          text: h.text, // Ensure interface has text
          isHighligt: false,
        })),
      ]
    : [];

  // Get Tomorrow's Forecast
  $: tomorrow = dailyRaw.find((d: DailyForecast) => {
    // Find the entry that matches tomorrow roughly
    if (!d.fxDate) return false;
    return window.moment(d.fxDate).isSame(window.moment().add(1, "d"), "day");
  });

  let visible = true; // Default true, update on mount
  let bannerEl: HTMLElement;

  export async function refresh() {
    if (!weatherService) return;
    if (
      !$settings.assistant.weather.enabled ||
      !$settings.assistant.weather.token ||
      !$settings.assistant.weather.city
    )
      return;
    // Only fetch if visible
    if (!visible) return;

    loading = true;
    await weatherService.getWeather(false);
    loading = false;
  }

  function getIconSvg(code: string): string {
    return QWeatherIcons[code] || QWeatherIcons["999"];
  }

  // Reactive Icon Rendering Action
  function renderIcon(node: HTMLElement, code: string) {
    if (!code) return;
    node.innerHTML = getIconSvg(code);
    return {
      update(newCode: string) {
        node.innerHTML = getIconSvg(newCode);
      },
    };
  }

  // Tomorrow Icon (Side)
  let tomorrowIconEl: HTMLElement;
  $: if (tomorrow && tomorrowIconEl && tomorrow.iconDay) {
    tomorrowIconEl.innerHTML = getIconSvg(tomorrow.iconDay);
  }

  onMount(() => {
    // Visibility Observer
    const observer = new IntersectionObserver((entries) => {
      const isVisible = entries[0].isIntersecting;
      if (isVisible && !visible) {
        // Became visible, trigger refresh if needed?
        // Weather service handles throttling internally, so just calling refresh() is safe.
        visible = true;
        refresh();
      } else {
        visible = isVisible;
      }
    });
    if (bannerEl) observer.observe(bannerEl);

    refresh(); // Initial fetch

    return () => {
      observer.disconnect();
      if (refreshTimer) clearInterval(refreshTimer);
    };
  });

  let refreshTimer: number;

  // React to settings changes for interval
  $: if ($settings.assistant.weather.refreshInterval) {
    if (refreshTimer) clearInterval(refreshTimer);
    const intervalMs =
      ($settings.assistant.weather.refreshInterval || 60) * 60 * 1000;
    refreshTimer = window.setInterval(() => {
      refresh();
    }, intervalMs);
  }

  $: $settings.assistant.weather.city,
    $settings.assistant.weather.token,
    refresh();
</script>

{#if $settings.assistant.weather.enabled && current}
  <div class="weather-banner compact" bind:this={bannerEl}>
    <!-- Left: Horizontal Scroll (Now + Hourly) -->
    <div class="weather-scroll-area">
      {#each displayList as item}
        <div class="weather-item {item.isHighligt ? 'is-current' : ''}">
          <span class="w-time">{item.time}</span>
          <div class="w-icon" use:renderIcon={item.icon}></div>
          <span class="w-temp">{item.temp}°</span>
          <span class="w-text" title={item.text}>{item.text}</span>
        </div>
      {/each}
    </div>

    <!-- Right: City + Tomorrow -->
    {#if tomorrow}
      <div class="weather-side-compact">
        <div class="side-city" title={$settings.assistant.weather.city}>
          {$settings.assistant.weather.city}
        </div>
        <div class="side-content">
          <div class="side-icon-sm" bind:this={tomorrowIconEl}></div>
          <div class="side-info">
            <div class="side-range">
              <span class="max">{tomorrow.tempMax}°</span>
              <span class="sep">/</span>
              <span class="min">{tomorrow.tempMin}°</span>
            </div>
            <div class="side-text">{tomorrow.textDay}</div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .weather-banner.compact {
    margin-top: 12px;
    background-color: var(--background-secondary);
    border-radius: 12px;
    display: flex;
    overflow: hidden;
    border: 1px solid var(--background-modifier-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    height: 98px; /* Fixed compact height */
  }

  /* Left Scroll Area */
  .weather-scroll-area {
    flex: 1;
    display: flex;
    overflow-x: auto;
    align-items: center;
    padding: 0 10px;
    gap: 16px;
    scrollbar-width: none;
    /* Ensure text doesn't break layout */
    white-space: nowrap;
  }
  .weather-scroll-area::-webkit-scrollbar {
    display: none;
  }

  .weather-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 44px;
    padding: 4px 0;
    opacity: 0.75;
    transition: opacity 0.2s;
  }

  /* Highlight Current */
  .weather-item.is-current {
    opacity: 1;
    min-width: 50px; /* Slightly larger */
  }
  .weather-item.is-current .w-icon {
    color: var(--text-accent); /* Highlight Icon */
    transform: scale(1.15);
  }
  .weather-item.is-current .w-time {
    font-weight: 700;
    color: var(--text-normal);
  }
  .weather-item.is-current .w-temp {
    font-weight: 700;
    font-size: 0.95em;
  }

  .w-time {
    font-size: 0.7em;
    color: var(--text-muted);
  }

  .w-icon {
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 2px 0;
  }
  :global(.w-icon svg) {
    width: 100%;
    height: 100%;
  }

  .w-temp {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-normal);
    line-height: 1.1;
  }

  .w-text {
    font-size: 0.65em;
    color: var(--text-muted);
    max-width: 54px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Right Side Compact */
  .weather-side-compact {
    width: 90px;
    flex-shrink: 0;
    background-color: var(--background-primary-alt);
    border-left: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    padding: 6px 4px;
    justify-content: center;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .side-city {
    font-size: 0.75em;
    font-weight: 700;
    color: var(--text-normal);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    max-width: 80px;
  }

  .side-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .side-icon-sm {
    color: var(--text-accent);
    width: 26px;
    height: 26px;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 2px;
  }
  :global(.side-icon-sm svg) {
    width: 100%;
    height: 100%;
  }

  .side-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }

  .side-range {
    font-size: 0.85em;
    font-weight: 600;
    white-space: nowrap;
  }
  .sep {
    margin: 0 2px;
    color: var(--text-faint);
  }
  .max {
    color: var(--text-normal);
  }
  .min {
    color: var(--text-muted);
  }

  .side-text {
    font-size: 0.65em;
    color: var(--text-muted);
    text-align: center;
    white-space: nowrap;
  }
</style>
