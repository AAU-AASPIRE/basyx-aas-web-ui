<template>
  <BaseEdge
    :id="id"
    :class="`bpmn-flow bpmn-flow--${data.state}`"
    :interaction-width="interactionWidth"
    :marker-end="markerEnd"
    :path="data.path"
  />

  <path v-if="data.otherwise" class="bpmn-flow__slash" :d="data.slash" />

  <EdgeLabelRenderer v-if="data.label">
    <div
      class="bpmn-flow__label text-caption"
      :class="{ 'bpmn-flow__label--otherwise': data.otherwise }"
      :style="{ transform: `translate(${data.labelX}px, ${data.labelY}px) translate(0, -100%)` }"
    >{{ data.label }}</div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
  import type { BpmnEdgeData } from './bpmnGraph'
  import { BaseEdge, EdgeLabelRenderer } from '@vue-flow/core'

  // A sequence flow, routed by bpmnRoute; out of an exclusive gateway with its condition or otherwise.
  // Vue Flow hands an edge more than it draws with: not passed on, it has no single root to take it.
  defineOptions({ inheritAttrs: false })
  defineProps<{ id: string, data: BpmnEdgeData, markerEnd?: string, interactionWidth?: number }>()
</script>

<!-- Not scoped: the path is BaseEdge's, which takes no scope of this component's. -->
<style>
.vue-flow__edge-path.bpmn-flow {
  fill: none;
  stroke: #546e7a;
  stroke-width: 1.5;
  transition: stroke 0.12s, stroke-width 0.12s;
}

.vue-flow__edge-path.bpmn-flow--selected {
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 2.5;
}

.vue-flow__edge-path.bpmn-flow--target {
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 4;
  stroke-dasharray: 6 4;
  animation: bpmn-flow-march 0.6s linear infinite;
}

@keyframes bpmn-flow-march {
  to {
    stroke-dashoffset: -10;
  }
}

.vue-flow__edge:hover .vue-flow__edge-path.bpmn-flow--normal {
  stroke: rgb(var(--v-theme-primary));
}

.bpmn-flow__slash {
  fill: none;
  stroke: #546e7a;
  stroke-width: 1.5;
}

.bpmn-flow__label {
  position: absolute;
  padding: 0 4px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.8);
  pointer-events: none;
}

.bpmn-flow__label--otherwise {
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
