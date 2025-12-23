<script lang="ts">
  import type { App } from "obsidian";
  import { slide } from "svelte/transition";
  import capitalize from "lodash/capitalize";

  import { displayConfigs } from "src/periodic/commands";
  import { t } from "src/i18n";
  import NoteFormatSetting from "../../components/NoteFormatSetting.svelte";
  import NoteTemplateSetting from "../../components/NoteTemplateSetting.svelte";
  import NoteFolderSetting from "../../components/NoteFolderSetting.svelte";
  import type { Granularity, PeriodicConfig } from "src/periodic/types";
  import Arrow from "../../components/Arrow.svelte";
  import { DEFAULT_PERIODIC_CONFIG } from "../../../constants";
  import type { ISettings } from "src/periodic/settings";
  import type { Writable } from "svelte/store";
  import writableDerived from "svelte-writable-derived";
  import OpenAtStartupSetting from "../../components/OpenAtStartupSetting.svelte";

  export let app: App;
  export let granularity: Granularity;
  export let settings: Writable<ISettings>;

  let displayConfig = displayConfigs[granularity];
  let isExpanded = false;

  let config: Writable<PeriodicConfig> = writableDerived(
    settings,
    ($settings) => $settings[granularity] ?? DEFAULT_PERIODIC_CONFIG,
    (reflecting, $settings) => {
      // @ts-ignore
      $settings[granularity] = reflecting;
      return $settings;
    },
  );

  function toggleExpand() {
    isExpanded = !isExpanded;
  }
</script>

<div class="periodic-group">
  <div
    class="setting-item setting-item-heading periodic-group-heading"
    on:click={toggleExpand}
  >
    <div class="setting-item-info">
      <h3 class="setting-item-name periodic-group-title">
        <Arrow {isExpanded} />
        {t(`periodic-note-heading-${granularity}`)}
        {#if $config.openAtStartup}
          <span class="badge">{t("settings-common-open-startup")}</span>
        {/if}
      </h3>
    </div>
    <div class="setting-item-control">
      <label
        class="checkbox-container"
        class:is-enabled={$config.enabled}
        on:click|stopPropagation
      >
        <input
          type="checkbox"
          bind:checked={$config.enabled}
          style="display: none;"
        />
      </label>
    </div>
  </div>
  {#if isExpanded}
    <div
      class="periodic-group-content"
      in:slide|local={{ duration: 300 }}
      out:slide|local={{ duration: 300 }}
    >
      <NoteFormatSetting {config} {granularity} />
      <NoteFolderSetting {app} {config} {granularity} />
      <NoteTemplateSetting {app} {config} {granularity} />
      <OpenAtStartupSetting {config} {settings} {granularity} />
    </div>
  {/if}
</div>

<style lang="scss">
  .periodic-group-title {
    display: flex;
  }

  .badge {
    font-style: italic;
    margin-left: 1em;
    color: var(--text-muted);
    font-weight: 500;
    font-size: 70%;
  }

  .periodic-group {
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;

    &:not(:last-of-type) {
      margin-bottom: 24px;
    }
  }

  .periodic-group-heading {
    cursor: pointer;
    padding: 24px;

    h3 {
      font-size: 1.1em;
      margin: 0;
    }
  }

  .periodic-group-content {
    padding: 24px;
  }
</style>
