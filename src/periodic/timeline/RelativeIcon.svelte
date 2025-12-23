<script lang="ts">
  import { setIcon } from "obsidian";
  import { onMount } from "svelte";

  let iconEl: HTMLElement;

  onMount(() => {
    setIcon(iconEl, "forward-arrow");
  });
</script>

<span bind:this={iconEl}></span>
