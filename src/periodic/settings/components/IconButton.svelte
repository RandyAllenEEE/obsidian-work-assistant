<script lang="ts">
  import { setIcon } from "obsidian";
  import { onMount } from "svelte";

  export let iconType: string;

  let iconEl: HTMLElement;

  onMount(() => {
    setIcon(iconEl, iconType);
  });
</script>

<div class="clickable-icon" bind:this={iconEl}></div>
