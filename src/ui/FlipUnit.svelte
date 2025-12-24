<script lang="ts">
  import { tick, onDestroy } from "svelte";

  export let value: string = "00";

  // State
  let nextValue = value;
  let currValue = value;

  let isFlipping = false;
  let timeoutId: any = null;

  onDestroy(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  $: if (value !== nextValue && !isFlipping) {
    flip(value);
  }

  async function flip(newValue: string) {
    if (isFlipping) return;
    isFlipping = true;

    nextValue = newValue;

    await tick();

    // The animation takes 600ms.
    // The animation takes 600ms.
    timeoutId = setTimeout(() => {
      currValue = nextValue;
      isFlipping = false;
      timeoutId = null;
    }, 600);
  }
</script>

<div class="flip-block {isFlipping ? 'flipping' : ''}">
  <!-- Card 1: Next Top (Static Background) -->
  <div class="card upper-card back-layer">
    <div class="digit-content">{nextValue}</div>
  </div>

  <!-- Card 2: Next Bottom (Flaps DOWN) -->
  <div class="card lower-card moving-card-bottom">
    <div class="digit-content">{nextValue}</div>
  </div>

  <!-- Card 3: Current Top (Flaps DOWN) -->
  <div class="card upper-card moving-card-top">
    <div class="digit-content">{currValue}</div>
  </div>

  <!-- Card 4: Current Bottom (Static Background) -->
  <div class="card lower-card front-layer">
    <div class="digit-content">{currValue}</div>
  </div>
</div>

<style>
  .flip-block {
    position: relative;
    width: 60px;
    height: 60px;
    perspective: 1000px;
    transform-style: preserve-3d;
    font-family: "JetBrains Mono", monospace, sans-serif;
    font-weight: 700;
    font-size: 36px;
    color: var(--text-normal);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    background: var(--background-primary);
    user-select: none;
  }

  /* Reset box-sizing and margins */
  .flip-block *,
  .flip-block *::before,
  .flip-block *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Common Card Container */
  .card {
    position: absolute;
    left: 0;
    width: 100%;
    height: 50%;
    overflow: hidden;
    /* Ensure opacity even if theme has transparency */
    background-color: var(--background-secondary);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    /* Force GPU rendering and clarify layering */
    transform-style: preserve-3d;
    will-change: transform;
  }

  /* Inner Text Positioning */
  .digit-content {
    width: 100%;
    height: 200%; /* Relative to .card (50% of .flip-block) */
    line-height: 60px; /* Should match .flip-block height */
    text-align: center;
    position: absolute;
    left: 0;
    pointer-events: none;
    /* Ensure text doesn't flicker during transform */
    -webkit-font-smoothing: antialiased;
  }

  /* Upper Cards */
  .upper-card {
    top: 0;
    border-radius: 6px 6px 0 0;
    transform-origin: center bottom;
    /* Tiny overlap to prevent hairline gap */
    padding-bottom: 0.1px;
  }
  .upper-card .digit-content {
    top: 0;
  }

  /* Lower Cards */
  .lower-card {
    top: 50%;
    border-radius: 0 0 6px 6px;
    transform-origin: center top;
  }
  .lower-card .digit-content {
    top: -30px;
  }

  /* Static Layers */
  .back-layer {
    z-index: 1;
    /* Hide the 'next' value when not flipping to prevent leakage */
    visibility: hidden;
  }
  .flipping .back-layer {
    visibility: visible;
  }

  .front-layer {
    z-index: 1;
  }

  /* Card 2: Next Bottom (folds up initially) */
  .moving-card-bottom {
    z-index: 2;
    transform: rotateX(180deg);
    visibility: hidden;
  }
  .flipping .moving-card-bottom {
    visibility: visible;
  }

  /* Card 3: Current Top (starts flat) */
  .moving-card-top {
    z-index: 5;
    transform: rotateX(0deg);
  }

  /* Separator Line */
  .flip-block::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    height: 1px;
    background: rgba(0, 0, 0, 0.4);
    z-index: 100; /* Always on top */
    transform: translateY(-50%) translateZ(1px); /* Ensure it's in front of everything */
  }

  /* Animations */
  .flipping .moving-card-bottom {
    animation:
      unfold 0.6s ease-in-out forwards,
      zIndexFlip 0.6s step-end forwards;
  }

  .flipping .moving-card-top {
    animation: fold 0.6s ease-in-out forwards;
  }

  @keyframes unfold {
    0% {
      transform: rotateX(180deg);
    }
    100% {
      transform: rotateX(0deg);
    }
  }

  @keyframes fold {
    0% {
      transform: rotateX(0deg);
    }
    100% {
      transform: rotateX(-180deg);
    }
  }

  /* Z-Index Flip: Ensure Card 2 jumps above Card 3 halfway through */
  @keyframes zIndexFlip {
    0% {
      z-index: 2;
    }
    50% {
      z-index: 10;
    }
    100% {
      z-index: 10;
    }
  }
</style>
