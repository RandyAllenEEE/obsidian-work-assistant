<script lang="ts">
  export let isEnabled: boolean;
  export let onChange: (value: boolean) => void;
</script>

<div
  class="checkbox-container"
  class:is-enabled={isEnabled}
  on:click={() => onChange(!isEnabled)}
  on:keydown={(e) => e.key === "Enter" && onChange(!isEnabled)}
  role="checkbox"
  aria-checked={isEnabled}
  tabindex="0"
></div>
