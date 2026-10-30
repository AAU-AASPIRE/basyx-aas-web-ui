<template>
  <div class="bpmn-palette">
    <v-text-field
      v-model="search"
      class="bpmn-palette__search mx-2 mt-2 mb-1"
      clearable
      density="compact"
      hide-details
      placeholder="Search the catalog"
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
    />

    <div class="bpmn-palette__groups">
      <template v-for="group in shown" :key="group.title">
        <button
          class="bpmn-palette__group text-overline"
          type="button"
          @click="toggle(group.title)"
        >
          <v-icon :icon="closed.has(group.title) ? 'mdi-chevron-right' : 'mdi-chevron-down'" size="16" />
          <span class="flex-grow-1 text-left">{{ group.title }}</span>
          <span class="text-medium-emphasis">{{ group.items.length }}</span>
        </button>

        <template v-if="!closed.has(group.title)">
          <div
            v-for="item in group.items"
            :key="item.key"
            :aria-label="`${item.title}: drag onto the diagram, or press Enter to insert it`"
            class="bpmn-palette__item"
            :class="{ 'bpmn-palette__item--disabled': disabled }"
            :draggable="!disabled"
            role="button"
            :tabindex="disabled ? -1 : 0"
            :title="item.hint ?? item.subtitle"
            @dblclick="!disabled && emit('add', item.key)"
            @dragend="emit('drag', false)"
            @dragstart="start($event, item.key)"
            @keydown.enter.prevent="!disabled && emit('add', item.key)"
          >
            <svg aria-hidden="true" class="bpmn-palette__glyph" viewBox="0 0 40 28">
              <template v-if="item.glyph === 'task' || item.glyph === 'call'">
                <rect
                  fill="none"
                  height="20"
                  rx="4"
                  :stroke-width="item.glyph === 'call' ? 2.6 : 1.4"
                  width="32"
                  x="4"
                  y="4"
                />

                <path v-if="item.glyph === 'call'" d="M 17 20 h 6 v -6 h -6 z M 20 15 v 4 M 18 17 h 4" fill="none" stroke-width="1" />
              </template>

              <template v-else-if="item.glyph === 'and' || item.glyph === 'xor'">
                <path d="M 20 3 L 31 14 L 20 25 L 9 14 Z" fill="none" stroke-width="1.4" />
                <path :d="item.glyph === 'and' ? 'M 20 9 v 10 M 15 14 h 10' : 'M 16.5 10.5 l 7 7 M 23.5 10.5 l -7 7'" stroke-width="2" />
              </template>

              <template v-else>
                <path d="M 9 6 L 16 14 L 9 22 L 2 14 Z M 31 6 L 38 14 L 31 22 L 24 14 Z" fill="none" stroke-width="1.4" />
                <path d="M 16 14 H 24 M 13 10 C 16 2, 24 2, 27 10" fill="none" stroke-width="1" />
                <path :d="item.glyph === 'and-pair' ? 'M 9 11 v 6 M 6 14 h 6 M 31 11 v 6 M 28 14 h 6' : 'M 7 12 l 4 4 M 11 12 l -4 4 M 29 12 l 4 4 M 33 12 l -4 4'" stroke-width="1.6" />
              </template>
            </svg>

            <div class="bpmn-palette__text">
              <div class="text-body-2 text-truncate">{{ item.title }}</div>
              <div v-if="item.subtitle" class="text-caption text-medium-emphasis text-truncate">{{ item.subtitle }}</div>
            </div>

            <v-icon class="bpmn-palette__drag" icon="mdi-drag-vertical" size="16" />
          </div>
        </template>
      </template>

      <p v-if="shown.length === 0" class="text-caption text-medium-emphasis pa-3">Nothing in the catalog matches.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { PaletteItem } from './bpmnCatalog'
  import { PALETTE_MIME } from './bpmnCatalog'

  const props = defineProps<{ groups: { title: string, items: PaletteItem[] }[], disabled?: boolean }>()
  const emit = defineEmits<{ add: [key: string], drag: [dragging: boolean] }>()

  const search = ref('')
  const closed = ref(new Set<string>())
  const shown = computed(() => {
    const words = (search.value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    return props.groups
      .map(group => ({ ...group, items: group.items.filter(item => words.every(word => `${item.title} ${item.subtitle ?? ''} ${group.title}`.toLowerCase().includes(word))) }))
      .filter(group => group.items.length > 0)
  })

  function toggle (title: string): void {
    const next = new Set(closed.value)
    if (next.has(title)) next.delete(title)
    else next.add(title)
    closed.value = next
  }

  function start (event: DragEvent, key: string): void {
    if (props.disabled || !event.dataTransfer) return
    event.dataTransfer.setData(PALETTE_MIME, key)
    event.dataTransfer.effectAllowed = 'copy'
    emit('drag', true)
  }
</script>

<style scoped>
.bpmn-palette {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.bpmn-palette__groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}

.bpmn-palette__search {
  flex: none;
}

.bpmn-palette__group {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 8px 12px 2px 6px;
  line-height: 1.6;
  border: 0;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
}

.bpmn-palette__group:hover {
  color: rgb(var(--v-theme-on-surface));
}

.bpmn-palette__item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 8px;
  padding: 5px 4px 5px 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  cursor: grab;
  user-select: none;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
}

.bpmn-palette__item:hover,
.bpmn-palette__item:focus-visible {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  outline: none;
}

.bpmn-palette__item:active {
  cursor: grabbing;
  transform: scale(0.98);
}

.bpmn-palette__item--disabled {
  opacity: 0.5;
  cursor: default;
}

.bpmn-palette__glyph {
  flex: none;
  width: 34px;
  height: 24px;
  stroke: #546e7a;
  fill: #546e7a;
}

.bpmn-palette__text {
  flex: 1;
  min-width: 0;
  line-height: 1.25;
}

.bpmn-palette__drag {
  flex: none;
  opacity: 0.35;
}
</style>
