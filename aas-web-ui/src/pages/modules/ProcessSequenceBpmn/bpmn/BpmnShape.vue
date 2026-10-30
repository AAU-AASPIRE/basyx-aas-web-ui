<template>
  <div
    class="bpmn-shape"
    :class="[`bpmn-shape--${data.kind}`, {
      'bpmn-shape--selected': data.selected,
      'bpmn-shape--issue': !!data.issue,
      'bpmn-shape--empty': data.empty,
      'bpmn-shape--target': data.target,
    }]"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    :title="data.issue || undefined"
  >
    <Handle
      v-if="data.kind !== 'start'"
      id="in"
      class="bpmn-port bpmn-port--in"
      :connectable="!readonly"
      :position="Position.Left"
      type="target"
    />

    <div v-if="data.kind === 'task' || data.kind === 'call'" class="bpmn-activity">
      <!-- BPMN's marker of a service task: the work is done by a system, here a skill. -->
      <v-icon v-if="data.kind === 'task'" class="bpmn-activity__marker" icon="mdi-cog-outline" size="14" />
      <span class="bpmn-activity__title font-weight-medium text-truncate">{{ data.title }}</span>
      <span v-for="line in data.lines" :key="line" class="text-caption text-medium-emphasis text-truncate">{{ line }}</span>
      <!-- A call activity's marker: what it calls is a sequence of its own. -->
      <span v-if="data.kind === 'call'" class="bpmn-activity__collapsed">+</span>
    </div>

    <div v-else-if="data.kind === 'and' || data.kind === 'xor'" class="bpmn-gateway">
      <span class="bpmn-gateway__diamond" />
      <span class="bpmn-gateway__marker">{{ data.kind === 'and' ? '+' : '×' }}</span>
    </div>

    <div v-else class="bpmn-event" />

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

    <v-icon
      v-if="data.issue"
      class="bpmn-shape__issue"
      color="warning"
      icon="mdi-alert-circle"
      size="18"
    />

    <span v-if="data.title && data.kind !== 'task' && data.kind !== 'call'" class="bpmn-shape__label text-caption">{{ data.title }}</span>

    <Handle
      v-if="data.kind !== 'end'"
      id="out"
      class="bpmn-port bpmn-port--out"
      :connectable="!readonly"
      :position="Position.Right"
      type="source"
    />
  </div>
</template>

<script setup lang="ts">
  import type { BpmnNodeData } from './bpmnGraph'
  import { Handle, Position } from '@vue-flow/core'

  const props = defineProps<{ data: BpmnNodeData, readonly?: boolean }>()
  const emit = defineEmits<{ open: [] }>()
  const opens = computed(() => (props.data.kind === 'call' ? 'Open the sequence it calls' : 'Open the skill this step runs'))
</script>

<style scoped>
.bpmn-shape {
  position: relative;
  cursor: grab;
}

.bpmn-shape:active {
  cursor: grabbing;
}

/* A port: where a flow is wired from (right) or to (left); shown on hover and while wiring. */
.bpmn-port {
  width: 12px;
  height: 12px;
  min-width: 0;
  min-height: 0;
  border: 2px solid rgb(var(--v-theme-surface));
  background: rgb(var(--v-theme-primary));
  opacity: 0;
  transition: opacity 0.12s, transform 0.12s;
}

.bpmn-shape:hover .bpmn-port,
.bpmn-shape--selected .bpmn-port,
:global(.bpmn-canvas--wiring) .bpmn-port--in {
  opacity: 1;
}

.bpmn-port--out {
  cursor: crosshair;
}

.bpmn-port:hover {
  transform: translate(50%, -50%) scale(1.35);
}

.bpmn-port--in:hover {
  transform: translate(-50%, -50%) scale(1.35);
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
  border: 1.5px solid #546e7a;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition: box-shadow 0.12s, border-color 0.12s;
}

.bpmn-shape:hover .bpmn-activity {
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.12);
}

.bpmn-shape--call .bpmn-activity {
  border-width: 3px;
}

/* A step that runs nothing yet. */
.bpmn-shape--empty .bpmn-activity {
  border-style: dashed;
}

.bpmn-activity__title {
  padding-right: 18px;
}

.bpmn-shape--selected .bpmn-activity,
.bpmn-shape--selected .bpmn-gateway__diamond,
.bpmn-shape--selected .bpmn-event {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.3);
}

.bpmn-shape--issue .bpmn-activity,
.bpmn-shape--issue .bpmn-gateway__diamond,
.bpmn-shape--issue .bpmn-event {
  border-color: rgb(var(--v-theme-warning));
}

/* What is dropped goes after this shape. */
.bpmn-shape--target .bpmn-activity,
.bpmn-shape--target .bpmn-gateway__diamond {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 4px 0 0 0 rgb(var(--v-theme-primary));
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
  border: 1px solid #546e7a;
}

.bpmn-activity__open {
  position: absolute;
  top: 2px;
  right: 2px;
}

.bpmn-shape__issue {
  position: absolute;
  top: -8px;
  left: -8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
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
  border: 1.5px solid #546e7a;
  border-radius: 3px;
  background: rgb(var(--v-theme-surface));
}

.bpmn-gateway__marker {
  position: absolute;
  inset: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 44px;
  text-align: center;
  pointer-events: none;
}

.bpmn-event {
  width: 100%;
  height: 100%;
  border: 1.5px solid #546e7a;
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
  margin-top: 2px;
  transform: translateX(-50%);
  white-space: nowrap;
  pointer-events: none;
}
</style>
