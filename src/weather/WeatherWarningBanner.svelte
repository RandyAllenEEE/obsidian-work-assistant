<script lang="ts">
  import { settings, pluginCache } from "../ui/stores";
  import { setIcon } from "obsidian";
  import { onMount } from "svelte";
  import type { WeatherWarning } from "./QWeatherService";

  let activeWarnings: WeatherWarning[] = [];

  $: {
    const cache = $pluginCache.weather;
    if (cache && cache.warningData && Array.isArray(cache.warningData)) {
      const dismissed = cache.dismissedWarningIds || [];
      activeWarnings = cache.warningData.filter(
        (w: WeatherWarning) => !dismissed.includes(w.id),
      );
    } else {
      activeWarnings = [];
    }
  }

  export let weatherService: any; // Type QWeatherService

  function handleDismiss(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (weatherService) {
      weatherService.dismissWarning(id);
    }
  }
</script>

{#if activeWarnings.length > 0}
  <div class="warning-banner">
    <div class="warning-header">
      <span class="warning-icon">⚠️</span>
      <span class="warning-title">Weather Warning</span>
    </div>

    <div class="warning-content">
      {#each activeWarnings as warning}
        <div class="warning-item">
          <span
            class="warning-level"
            style="background-color: {warning.severityColor || '#ff0000'}"
            >{warning.level}</span
          >
          <span class="warning-text" title={warning.text}
            >{warning.typeName}: {warning.title}</span
          >
          <button
            class="dismiss-btn"
            on:click={(e) => handleDismiss(e, warning.id)}
            aria-label="Dismiss">×</button
          >
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .warning-banner {
    margin-top: 8px;
    padding: 8px 12px;
    background-color: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.4);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .warning-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: bold;
    color: var(--text-error);
    font-size: 0.9em;
  }
  .warning-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--background-primary);
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 0.85em;
  }
  .warning-level {
    color: white;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.8em;
    font-weight: bold;
    text-transform: uppercase;
  }
  .warning-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-normal);
  }
  .dismiss-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1.2em;
    line-height: 1;
    padding: 0 4px;
    opacity: 0.6;
  }
  .dismiss-btn:hover {
    opacity: 1;
    color: var(--text-error);
  }
</style>
