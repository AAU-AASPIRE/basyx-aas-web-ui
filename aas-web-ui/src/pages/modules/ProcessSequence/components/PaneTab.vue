<template>
  <button
    :aria-label="`Show the ${label}`"
    class="pane-tab"
    :class="`pane-tab--${side}`"
    :title="`Show the ${label}`"
    type="button"
    @click="emit('open')"
  >
    <v-icon :icon="side === 'left' ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left'" size="18" />
    <span class="pane-tab__label">{{ label }}</span>
  </button>
</template>

<script lang="ts" setup>
  /** A side panel, hidden: a narrow tab with its name along the edge; a click shows the panel again. */
  defineProps<{ label: string, side: 'left' | 'right' }>()
  const emit = defineEmits<{ open: [] }>()
</script>

<style scoped>
  .pane-tab {
    display: flex;
    flex: 0 0 34px;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
    border-radius: 8px;
    background: rgb(var(--v-theme-surface));
    color: rgba(var(--v-theme-on-surface), 0.75);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .pane-tab:hover,
  .pane-tab:focus-visible {
    background: rgba(var(--v-theme-primary), 0.08);
    color: rgb(var(--v-theme-primary));
    outline: none;
  }

  .pane-tab__label {
    font-size: 0.8125rem;
    letter-spacing: 0.02em;
    white-space: nowrap;
    writing-mode: vertical-rl;
  }

  .pane-tab__label::first-letter {
    text-transform: uppercase;
  }

  .pane-tab--left .pane-tab__label {
    transform: rotate(180deg);
  }
</style>
