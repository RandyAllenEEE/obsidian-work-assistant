<script lang="ts">
  import { onMount } from "svelte";

  import { DEFAULT_FORMAT } from "src/periodic/constants";
  import type { Granularity, PeriodicConfig } from "src/periodic/types";
  import { validateFormat, validateFormatComplexity } from "../validation";
  import type { Readable } from "svelte/store";
  import { displayConfigs } from "src/periodic/commands";
  import { t } from "src/i18n";

  export let granularity: Granularity;
  export let config: Readable<PeriodicConfig>;

  const defaultFormat = DEFAULT_FORMAT[granularity];

  let inputEl: HTMLInputElement;
  let value: string = "";
  let error: string;
  let warning: string;

  $: {
    value = $config.format || "";
  }

  onMount(() => {
    error = validateFormat(inputEl.value, granularity);
    warning = validateFormatComplexity(inputEl.value, granularity);
  });

  function clearError() {
    error = "";
  }

  function onChange() {
    error = validateFormat(inputEl.value, granularity);
    warning = validateFormatComplexity(inputEl.value, granularity);
  }
</script>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">{t("settings-common-format")}</div>
    <div class="setting-item-description">
      <a href="https://momentjs.com/docs/#/displaying/format/"
        >{t("settings-common-syntax-ref")}</a
      >
      <div>
        {t("settings-common-syntax-preview")}
        <b class="u-pop">{window.moment().format(value || defaultFormat)} </b>
      </div>
    </div>
    {#if error}
      <div class="has-error">{error}</div>
    {/if}
  </div>
  <div class="setting-item-control">
    <input
      bind:value={$config.format}
      bind:this={inputEl}
      class:has-error={!!error}
      type="text"
      spellcheck={false}
      placeholder={defaultFormat}
      on:change={onChange}
      on:input={clearError}
    />
  </div>
</div>

<style>
  .alert-warning {
    color: var(--text-muted);
    font-size: 80%;
    margin-top: 0.6em;
  }
  .setting-item-control input {
    flex-grow: 1;
  }
</style>
