<script context="module">
  // Embedded sub-component pattern in Svelte is tricky if not using separate files.
  // I will just use strictly separated file logic or standard include?
  // Svelte 3/4 doesn't support multiple components in one file easily.
  // I will write FlipClock.svelte and FlipUnit.svelte?
  // User asked for "Flip Clock Component". I'll split it into two files to be clean.
  // File 1: FlipUnit.svelte (The flipper)
  // File 2: FlipClock.svelte (The container)
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  import FlipUnit from "./FlipUnit.svelte";

  let now = window.moment();
  let timeStr = now.format("HHmmss"); // 123456

  let hours = timeStr.slice(0, 2);
  let minutes = timeStr.slice(2, 4);
  let seconds = timeStr.slice(4, 6);

  let interval: any;
  let visible = true;
  let container: HTMLElement;

  function update() {
    if (!visible) return;
    const m = window.moment();
    const s = m.format("HHmmss");
    if (s !== timeStr) {
      timeStr = s;
      hours = s.slice(0, 2);
      minutes = s.slice(2, 4);
      seconds = s.slice(4, 6);
    }
  }

  onMount(() => {
    // Visibility Check
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    });
    if (container) observer.observe(container);

    interval = setInterval(update, 1000);

    return () => {
      clearInterval(interval);
      observer.disconnect();
    };
  });

  // Helper component for a pair of digits? No, we need per-digit or per-group flipping.
  // HH : MM : SS
  // Usually we flip the whole group (e.g. 59 -> 00).
  // Let's create a sub-component mechanism via #each?
  // Svelte doesn't easily support "call method on child" without binding.
  // We can just define the FlipUnit in the same file to ensure encapsulation in one file.
</script>

<div class="flip-clock-wrapper">
  <div class="flip-clock-container" bind:this={container}>
    <div class="flip-group">
      <FlipUnit value={hours} />
      <span class="sep">:</span>
      <FlipUnit value={minutes} />
      <span class="sep seconds-sep">:</span>
      <div class="seconds-unit">
        <FlipUnit value={seconds} />
      </div>
    </div>
  </div>
</div>

<style>
  .flip-clock-wrapper {
    width: 100%;
    container-type: inline-size;
  }
  .flip-clock-container {
    display: flex;
    justify-content: center;
    padding: 10px;
    user-select: none;
  }
  .flip-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sep {
    font-size: 24px;
    font-weight: bold;
    color: var(--text-muted);
    margin-top: -2px;
    padding: 0 2px;
  }

  @container (max-width: 210px) {
    .seconds-sep,
    .seconds-unit {
      display: none;
    }
  }
</style>
