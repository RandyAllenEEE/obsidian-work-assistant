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

<!-- Show periodic note configurations directly -->
<div class="periodic-groups-container">
  {#each granularities as granularity}
    <PeriodicGroup {app} {granularity} {settings} />
  {/each}
</div>

<SettingItem
  name={t("settings-timeline-title")}
  description={t("settings-timeline-desc")}
  type="toggle"
  isHeading={false}
>
  <Toggle
    slot="control"
    isEnabled={$settings.enableTimelineComplication}
    onChange={(val) => {
      $settings.enableTimelineComplication = val;
    }}
  />
</SettingItem>

<style>
  .periodic-groups-container {
    margin-top: 1em;
    margin-bottom: 2em;
  }

  h3 {
    margin-top: 2em;
    margin-bottom: 0.8em;
  }
</style>
