<template>
  <div
    class="bpmn-shape"
    :class="[`bpmn-shape--${data.kind}`, { 'bpmn-shape--selected': selected }]"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
  >
    <Handle id="in" class="bpmn-handle" :position="Position.Left" type="target" />

    <button
      v-if="data.kind === 'task' || data.kind === 'call'"
      :aria-label="data.title"
      :aria-pressed="selected"
      class="bpmn-activity nodrag"
      @click="emit('select')"
    >
      <!-- BPMN's marker of a service task: the work is done by a system, here a skill. -->
      <v-icon v-if="data.kind === 'task'" class="bpmn-activity__marker" icon="mdi-cog-outline" size="14" />
      <span class="font-weight-medium text-truncate">{{ data.title }}</span>
      <span v-for="line in data.lines" :key="line" class="text-caption text-medium-emphasis text-truncate">{{ line }}</span>
      <!-- A call activity's marker: what it calls is a sequence of its own. -->
      <span v-if="data.kind === 'call'" class="bpmn-activity__collapsed">+</span>
    </button>

    <button
      v-else-if="data.kind.endsWith('split') || data.kind.endsWith('join')"
      :aria-label="`${data.title}: ${data.kind.startsWith('and') ? 'parallel' : 'exclusive'} gateway`"
      :aria-pressed="selected"
      class="bpmn-gateway nodrag"
      @click="emit('select')"
    >
      <span class="bpmn-gateway__diamond" />
      <span class="bpmn-gateway__marker">{{ data.kind.startsWith('and') ? '+' : '×' }}</span>
    </button>

    <button
      v-else-if="data.kind === 'start' || data.kind === 'end'"
      :aria-label="data.title"
      class="bpmn-event nodrag"
      @click="emit('select')"
    />

    <v-btn
      v-if="data.linked"
      :aria-label="opens"
      class="bpmn-activity__open nodrag"
      density="comfortable"
      icon="mdi-open-in-new"
      size="x-small"
      :title="opens"
      variant="text"
      @click.stop="emit('open')"
    />

    <span v-if="data.kind === 'start' || data.kind === 'end' || data.kind.endsWith('split')" class="bpmn-shape__label text-caption">{{ data.title }}</span>

    <Handle id="out" class="bpmn-handle" :position="Position.Right" type="source" />
  </div>
</template>

<script setup lang="ts">
  import type { BpmnNodeData } from './bpmnGraph'
  import { Handle, Position } from '@vue-flow/core'

  const props = defineProps<{ data: BpmnNodeData, selected: boolean }>()
  const emit = defineEmits<{ select: [], open: [] }>()
  const opens = computed(() => (props.data.kind === 'call' ? 'Open the sequence it calls' : 'Open the skill this step runs'))
</script>

<style scoped>
.bpmn-shape {
  position: relative;
}

.bpmn-handle {
  opacity: 0;
  pointer-events: none;
}

/* An empty branch's point: the flow comes in and goes on at the same spot. */
.bpmn-shape--point .bpmn-handle {
  top: 50%;
  right: auto;
  left: 50%;
  width: 1px;
  min-width: 0;
  height: 1px;
  min-height: 0;
  transform: translate(-50%, -50%);
}

.bpmn-activity {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  width: 100%;
  height: 100%;
  padding: 6px 12px 6px 24px;
  text-align: left;
  border: 1.5px solid #455a64;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}

.bpmn-shape--call .bpmn-activity {
  border-width: 3px;
}

.bpmn-shape--selected .bpmn-activity,
.bpmn-shape--selected .bpmn-gateway__diamond,
.bpmn-shape--selected .bpmn-event {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
}

.bpmn-activity__marker {
  position: absolute;
  top: 6px;
  left: 6px;
}

.bpmn-activity__collapsed {
  position: absolute;
  bottom: 2px;
  left: 50%;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  font-size: 12px;
  line-height: 12px;
  text-align: center;
  border: 1px solid #455a64;
}

.bpmn-activity__open {
  position: absolute;
  top: 2px;
  right: 2px;
}

.bpmn-gateway {
  position: relative;
  width: 100%;
  height: 100%;
}

.bpmn-gateway__diamond {
  position: absolute;
  inset: 6px;
  transform: rotate(45deg);
  border: 1.5px solid #455a64;
  background: rgb(var(--v-theme-surface));
}

.bpmn-gateway__marker {
  position: absolute;
  inset: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 44px;
  text-align: center;
}

.bpmn-event {
  width: 100%;
  height: 100%;
  border: 1.5px solid #455a64;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
}

.bpmn-shape--end .bpmn-event {
  border-width: 4px;
}

.bpmn-shape__label {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
}
</style>
