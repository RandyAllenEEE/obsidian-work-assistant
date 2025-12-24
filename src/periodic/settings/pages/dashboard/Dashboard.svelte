<script lang="ts">
  import type { App } from "obsidian";
  import type { Writable } from "svelte/store";

  import type { ISettings } from "src/periodic/settings/index";
  import SettingItem from "../../components/SettingItem.svelte";
  import Toggle from "../../components/Toggle.svelte";
  import { granularities } from "src/periodic/types";

  import { t } from "src/i18n";
  import PeriodicGroup from "../details/PeriodicGroup.svelte";

  export let app: App;
  export let settings: Writable<ISettings>;
</script>

<div class="setting-item setting-item-heading">
  <div class="setting-item-info">
    <div class="setting-item-name">{t("settings-periodic-notes-title")}</div>
  </div>
</div>
<!-- Show periodic note configurations directly -->
<div class="periodic-groups-container">
  {#each granularities as granularity}
    <PeriodicGroup {app} {granularity} {settings} />
  {/each}

  <SettingItem
    name={t("settings-timeline-title")}
    description={t("settings-timeline-desc")}
    type="toggle"
    isHeading={false}
  >
    <Toggle
      slot="control"
      isEnabled={$settings.periodicNotes.timelineComplication}
      onChange={(val) => {
        $settings.periodicNotes.timelineComplication = val;
      }}
    />
  </SettingItem>
</div>

<style>
  .periodic-groups-container {
    margin-top: 8px;
    margin-bottom: 8px;
    margin-left: 4px;
    border-left: 2px solid var(--background-modifier-border);
    padding-left: 18px;
  }
</style>
