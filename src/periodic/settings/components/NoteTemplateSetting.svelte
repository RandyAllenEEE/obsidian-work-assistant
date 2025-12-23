<script lang="ts">
  import type { App } from "obsidian";
  import { onMount } from "svelte";
  import type { Readable } from "svelte/store";
  import capitalize from "lodash/capitalize";

  import type { Granularity, PeriodicConfig } from "src/periodic/types";
  import { FileSuggest } from "src/periodic/ui/file-suggest";

  import { validateTemplate } from "../validation";
  import { displayConfigs } from "src/periodic/commands";
  import { t } from "src/i18n";

  export let app: App;
  export let granularity: Granularity;
  export let config: Readable<PeriodicConfig>;

  let error: string;
  let inputEl: HTMLInputElement;

  function validateOnBlur() {
    error = validateTemplate(app, inputEl.value);
  }

  function clearError() {
    error = "";
  }

  onMount(() => {
    error = validateTemplate(app, inputEl.value);
    new FileSuggest(app, inputEl);
  });
</script>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">
      {t(`template-title-${granularity}`)}
    </div>
    <div class="setting-item-description">
      {t("settings-common-template-desc")}
    </div>
    {#if error}
      <div class="has-error">{error}</div>
    {/if}
  </div>
  <div class="setting-item-control">
    <input
      class:has-error={!!error}
      type="text"
      spellcheck={false}
      placeholder={t("settings-common-template-placeholder")}
      bind:value={$config.templatePath}
      bind:this={inputEl}
      on:change={validateOnBlur}
      on:input={clearError}
    />
  </div>
</div>

<style>
  .setting-item-control input {
    flex-grow: 1;
  }
</style>
