<template>
  <BpmnFlowGraph
    v-model="nodes"
    :label="label"
    mode="plan"
    :processes="processes"
    :selected-id="selectedId"
    :targets="targets"
    @issues="emit('issues', $event)"
    @open="emit('open', $event)"
    @select="emit('select', $event)"
  />
</template>

<script setup lang="ts">
  import type { PlanNode, PlanProcess, PlanScope } from '../ProcessSequence/types/plan'
  import BpmnFlowGraph from './bpmn/BpmnFlowGraph.vue'

  /**
   * The planner's sequence in BPMN notation, with PlanGraph's props and events, for PlanEditor.
   * Materials are PlanGraph's: the BPMN notation shows the flow, the inspector the rest. The process
   * steps are its catalog. ``issues``: what keeps the drawing from being a flow, not to be saved over.
   */
  defineProps<{ label: string, selectedId: string, materialScopes: PlanScope[], processes: PlanProcess[], targets: { id: string, name: string }[] }>()
  const emit = defineEmits<{ 'select': [id: string], 'open': [id: string], 'change-type': [id: string, kind: PlanNode['kind']], 'issues': [texts: string[]] }>()
  const nodes = defineModel<PlanNode[]>({ required: true })
</script>
