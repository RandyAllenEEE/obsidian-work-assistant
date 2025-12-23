<script lang="ts">
  import type { App } from "obsidian";

  import type CalendarSetManager from "src/periodic/calendarSetManager";
  import { router } from "src/periodic/settings/stores";
  import Breadcrumbs from "../components/Breadcrumbs.svelte";

  import Dashboard from "./dashboard/Dashboard.svelte";
  import { onDestroy, onMount } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import type { ISettings } from "..";
  import {
    getLocalizationSettings,
    type ILocalizationSettings,
  } from "../localization";

  export let app: App;
  export let settings: Writable<ISettings>;

  let localization = writable(getLocalizationSettings(app));

  onDestroy(() => {
    router.reset();
  });
</script>

<Dashboard {app} {settings} {localization} />
