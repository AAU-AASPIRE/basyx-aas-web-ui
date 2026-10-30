<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-1 px-3 pb-2">
      <v-btn
        :disabled="readonly"
        prepend-icon="mdi-plus"
        size="small"
        variant="tonal"
        @click="add('step')"
      >Add step</v-btn>

      <v-menu>
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            :disabled="readonly"
            prepend-icon="mdi-source-branch"
            size="small"
            variant="text"
          >Add a block</v-btn>
        </template>

        <v-list density="compact">
          <v-list-item title="Parallel block: AND gateways, all branches" @click="add('parallel')" />
          <v-list-item title="Decision: XOR gateways, one of two branches" @click="add('decision')" />
          <v-list-item title="Conditional steps: XOR gateways, run or skip" @click="add('conditional')" />
        </v-list>
      </v-menu>

      <span class="text-caption text-medium-emphasis flex-grow-1 px-2">{{ insertionLabel }}</span>

      <template v-if="selected && !readonly">
        <v-btn
          aria-label="Move earlier"
          :disabled="!location || location.index <= 0"
          icon="mdi-arrow-left"
          size="x-small"
          variant="text"
          @click="move(-1)"
        />

        <v-btn
          aria-label="Move later"
          :disabled="!location || location.index >= location.nodes.length - 1"
          icon="mdi-arrow-right"
          size="x-small"
          variant="text"
          @click="move(1)"
        />

        <v-btn color="error" size="small" variant="text" @click="remove">Remove selected</v-btn>
      </template>

      <v-btn
        prepend-icon="mdi-download"
        size="small"
        title="The flow as a BPMN 2.0 file, for bpmn.io or Camunda Modeler"
        variant="text"
        @click="download"
      >BPMN</v-btn>

      <v-btn
        aria-label="Fit graph"
        icon="mdi-fit-to-screen-outline"
        size="small"
        variant="text"
        @click="fit"
      />
    </div>

    <div :aria-label="label" class="bpmn-canvas" role="region">
      <VueFlow
        :id="flowId"
        :delete-key-code="null"
        :edges="edges"
        :edges-updatable="false"
        :max-zoom="1.5"
        :min-zoom="0.2"
        :nodes="graph.nodes"
        :nodes-connectable="false"
        :nodes-draggable="false"
        :nodes-focusable="false"
        @edge-click="({ edge }) => choose(edge.data?.insert)"
        @nodes-initialized="fit"
      >
        <Background :gap="20" pattern-color="#aebbc5" />
        <Controls :show-interactive="false" />

        <template #node-bpmn="{ data, id }">
          <BpmnShape
            :data="data"
            :selected="!!data.planId && data.planId === selectedId"
            @open="open(data.planId)"
            @select="select(id, data.planId)"
          />
        </template>
      </VueFlow>
    </div>

    <p class="text-caption text-medium-emphasis px-3 py-1">
      Select a sequence flow (an arrow) to insert there, or a step to insert after it. Gateways come in pairs: a block's split and its join.
    </p>
  </div>
</template>

<script setup lang="ts">
  import type { PlanNode, StepNode } from '../../ProcessSequence/types/plan'
  import type { Insertion } from './bpmnLayout'
  import type { TaskDetails } from './bpmnXml'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { useVueFlow, VueFlow } from '@vue-flow/core'
  import { useRouter } from 'vue-router'
  import { handedParameter, instanceName } from '../../ProcessSequence/skills/skillFlow'
  import { newComparison } from '../../ProcessSequence/utils/conditions'
  import { flattenNodes, newNode } from '../../ProcessSequence/utils/plan'
  import { findLane } from '../../ProcessSequence/utils/planGraph'
  import { bpmnGraph } from './bpmnGraph'
  import { laneNodes, layoutBpmn } from './bpmnLayout'
  import BpmnShape from './BpmnShape.vue'
  import { bpmnXml } from './bpmnXml'
  import { useSkillLink } from './skillLink'
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'
  import '@vue-flow/controls/dist/style.css'

  /**
   * A flow of steps in BPMN notation, for the skill editor (``mode`` skill: a module level skill's
   * steps, which run the skills of its components) and the planner (plan: a product's process steps).
   * The same contract as SkillFlowGraph and PlanGraph: the steps as the model, the selected one in and
   * out. Editing is by blocks only, so a split always has its join.
   */
  const props = withDefaults(defineProps<{
    label: string
    selectedId: string
    readonly?: boolean
    mode?: 'skill' | 'plan'
    /** The plan's sequences a call can call, by id. */
    targets?: { id: string, name: string }[]
  }>(), { mode: 'skill', targets: () => [] })
  const emit = defineEmits<{ select: [id: string], open: [scopeId: string] }>()
  const nodes = defineModel<PlanNode[]>({ required: true })
  const router = useRouter()
  const skillLink = useSkillLink()
  const flowId = `bpmn-flow-${useId()}`
  const { fitView } = useVueFlow({ id: flowId })
  /** The sequence flow chosen to insert on; none: after the selected step, or at the end. */
  const insertion = ref<Insertion | null>(null)

  /** A component's or a station's short name, from its AAS id. */
  const component = (aasId: string) => aasId.split('/').at(-1)?.replace(/AAS$/, '') ?? ''
  const steps = computed(() => new Map(flattenNodes(nodes.value).map(node => [node.id, node])))
  const selected = computed(() => steps.value.get(props.selectedId))
  const location = computed(() => findLane(nodes.value, props.selectedId))
  /** A call opens what it calls; a step the skill it runs, if it names one. */
  const opens = (id: string): boolean => steps.value.get(id)?.kind === 'call' || !!skillLink(steps.value.get(id))
  const graph = computed(() => bpmnGraph(layoutBpmn(nodes.value), insertion.value, id => lines(steps.value.get(id)), opens))
  // Vue Flow drops an edge whose shapes it does not have yet ("Edge source or target is missing"), and
  // a new block brings new shapes: its flows are handed over once the shapes are there. Until then only
  // the flows between shapes that were there and still are.
  const edges = shallowRef(graph.value.edges)
  watch(graph, (value, old) => {
    const before = new Set(old.nodes.map(node => node.id))
    const now = new Set(value.nodes.map(node => node.id))
    edges.value = value.edges.filter(edge => [edge.source, edge.target].every(id => before.has(id) && now.has(id)))
    void nextTick(() => {
      edges.value = value.edges
    })
  })
  const insertionLabel = computed(() => {
    if (insertion.value) return 'Insert on the selected flow'
    if (selected.value) return `Insert after ${selected.value.name}`
    return 'Append to the end: select a flow or a step to insert there'
  })

  /** What a task shows under its name. */
  function lines (node: PlanNode | undefined): string[] {
    if (node?.kind === 'call') {
      return [`Calls ${props.targets.find(target => target.id === node.scopeId)?.name ?? 'a subprocess'}`]
    }
    if (node?.kind !== 'step') return []
    if (props.mode === 'skill') {
      const handed = node.bindings.map(binding => `${binding.name} ${handedParameter(binding) ? `← ${handedParameter(binding)}` : `= ${binding.value}`}`)
      return [
        node.skillId ? `${node.skillId} (${component(node.resourceAasId)})` : 'No skill chosen',
        [...handed, ...(node.outputs ?? []).map(output => `→ ${output.id}`)].join(', '),
      ].filter(Boolean)
    }
    return [
      node.process?.name || 'Process step',
      node.skillId ? `${node.skillId} at ${component(node.resourceAasId)}` : (node.executionMode === 'manual' ? 'Manual' : ''),
    ].filter(Boolean)
  }

  const details: TaskDetails = node => {
    if (node.kind !== 'step') return {}
    const step = node as StepNode
    return {
      documentation: lines(step).join('; '),
      properties: {
        process: step.process?.name ?? '',
        resource: step.resourceAasId,
        skill: step.skillId,
        skillReference: step.skillReference?.keys.map(key => key.value).join(' / ') ?? '',
        requiredCapabilities: (step.requiredCapabilities ?? step.process?.requiredCapabilities ?? []).map(item => item.name).join(', '),
        bindings: step.bindings.map(binding => `${binding.name}${handedParameter(binding) ? ` <- ${handedParameter(binding)}` : ` = ${binding.value}`}`).join('; '),
        outputs: (step.outputs ?? []).map(output => output.id).join(', '),
      },
    }
  }

  function fit (): void {
    void nextTick(() => fitView({ padding: 0.15, maxZoom: 1 }))
  }

  function choose (insert: Insertion | undefined): void {
    if (!insert) return
    insertion.value = insert
    emit('select', '')
  }

  function select (id: string, planId: string | undefined): void {
    if (id === 'start') {
      choose({ lane: 'root', index: 0 })
    } else if (id === 'end') {
      choose({ lane: 'root', index: nodes.value.length })
    } else if (planId) {
      insertion.value = null
      emit('select', planId)
    }
  }

  /** A call opens the sequence it calls; a step the skill it runs. */
  function open (planId: string | undefined): void {
    const node = planId ? steps.value.get(planId) : undefined
    if (node?.kind === 'call') {
      emit('open', node.scopeId)
      return
    }
    const target = skillLink(node)
    if (target) void router.push(target)
  }

  function add (kind: 'step' | 'parallel' | 'decision' | 'conditional'): void {
    const node = newNode(kind)
    if (props.mode === 'skill') {
      if (node.kind !== 'step') {
        // A block is named like its instance in the control program.
        const name = instanceName({ parallel: 'Parallel', decision: 'Decision', conditional: 'Optional' }[kind as 'parallel'], [...steps.value.keys()])
        node.id = name
        node.name = name
      }
      if (node.kind === 'conditional') {
        node.condition = newComparison()
      }
    }
    const into = insertion.value ? laneNodes(nodes.value, insertion.value.lane) : undefined
    if (into && insertion.value) {
      into.splice(Math.min(insertion.value.index, into.length), 0, node)
    } else if (location.value) {
      location.value.nodes.splice(location.value.index + 1, 0, node)
    } else {
      nodes.value.push(node)
    }
    insertion.value = null
    emit('select', node.id)
  }

  function move (delta: number): void {
    const lane = location.value
    if (!lane || lane.index < 0 || lane.index + delta < 0 || lane.index + delta >= lane.nodes.length) return
    const node = lane.nodes.splice(lane.index, 1)[0]!
    lane.nodes.splice(lane.index + delta, 0, node)
  }

  function remove (): void {
    const lane = location.value
    if (!lane || lane.index < 0) return
    lane.nodes.splice(lane.index, 1)
    insertion.value = null
    emit('select', '')
  }

  function download (): void {
    const blob = new Blob([bpmnXml(nodes.value, props.label, details)], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${props.label.replaceAll(/[^\w.-]+/g, '_') || 'flow'}.bpmn`
    link.click()
    URL.revokeObjectURL(url)
  }
</script>

<style scoped>
.bpmn-canvas {
  height: max(420px, calc(100vh - 520px));
  min-width: 0;
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.bpmn-canvas :deep(.bpmn-flow--insertable) {
  cursor: pointer;
}
</style>
