<script lang="ts">
  import type { Writable } from "svelte/store";

  import type { Granularity, PeriodicConfig } from "src/periodic/types";
  import { displayConfigs } from "src/periodic/commands";
  import { t } from "src/i18n";

  import SettingItem from "./SettingItem.svelte";
  import Toggle from "./Toggle.svelte";
  import type { ISettings } from "..";
  import { clearStartupNote } from "../utils";

  export let config: Writable<PeriodicConfig>;
  export let settings: Writable<ISettings>;
  export let granularity: Granularity;
</script>

<SettingItem
  name={t("settings-common-open-startup")}
  description={t("settings-common-open-startup-desc").replace(
    "{noteType}",
    t(`periodic-note-heading-${granularity}`).toLowerCase(),
  )}
  type="toggle"
  isHeading={false}
>
  <Toggle
    slot="control"
    isEnabled={$config.openAtStartup}
    onChange={(val) => {
      settings.update(clearStartupNote);
      $config.openAtStartup = val;
    }}
  />
</SettingItem>
