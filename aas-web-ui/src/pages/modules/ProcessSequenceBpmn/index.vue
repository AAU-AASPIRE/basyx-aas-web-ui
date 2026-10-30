<template>
  <v-container class="pa-md-4" fluid>
    <PlanProductPicker v-model="eligible" />

    <PlanEditor v-if="eligible" :graph="PlanBpmnGraph" />
    <v-empty-state v-else icon="mdi-package-variant-closed" text="Choose a product above to open or create its process sequence." title="Select a product" />
  </v-container>
</template>

<script setup lang="ts">
  import PlanEditor from '../ProcessSequence/components/PlanEditor.vue'
  import PlanProductPicker from '../ProcessSequence/components/PlanProductPicker.vue'
  import PlanBpmnGraph from './PlanBpmnGraph.vue'

  // The Process Sequence module with the plan's flow in BPMN notation: the same plans (Production
  // Sequence in the product's AAS), the same product picker, inspector and saving; only the graph is
  // drawn as a BPMN process. See README.md.
  defineOptions({
    inheritAttrs: false,
    moduleTitle: 'Process Sequence (BPMN)',
    isDesktopModule: true,
    isOnlyVisibleWithSelectedAas: false,
    preserveRouteQuery: true,
  })

  const eligible = ref(false)
</script>
