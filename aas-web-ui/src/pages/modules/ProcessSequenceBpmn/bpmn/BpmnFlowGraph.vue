<template>
  <div class="bpmn-editor">
    <div class="bpmn-toolbar">
      <v-btn
        v-if="!readonly"
        :active="showCatalog"
        :color="showCatalog ? 'primary' : undefined"
        prepend-icon="mdi-shape-plus-outline"
        size="small"
        :title="showCatalog ? 'Hide the catalog' : 'Show the catalog: process steps, skills and gateways to drag into the diagram'"
        variant="text"
        @click="setCatalog(!showCatalog)"
      >Catalog</v-btn>

      <v-btn
        aria-label="Undo"
        :disabled="readonly || past.length === 0"
        icon="mdi-undo"
        size="small"
        title="Undo (Ctrl+Z)"
        variant="text"
        @click="undo"
      />

      <v-btn
        aria-label="Redo"
        :disabled="readonly || future.length === 0"
        icon="mdi-redo"
        size="small"
        title="Redo (Ctrl+Y)"
        variant="text"
        @click="redo"
      />

      <v-divider class="mx-1" vertical />

      <v-switch
        class="flex-grow-0 ml-1"
        color="primary"
        density="compact"
        :disabled="readonly"
        hide-details
        label="Auto layout"
        :model-value="autoLayout"
        title="On: the diagram is laid out after each change, and what is dropped on an arrow snaps into the flow. Off: shapes stay where you put them."
        @update:model-value="setAutoLayout(!!$event)"
      />

      <v-btn
        v-if="!autoLayout"
        :disabled="readonly || !parsed.nodes"
        prepend-icon="mdi-auto-fix"
        size="small"
        :title="parsed.nodes ? 'Lay the diagram out once' : 'Fix the flow first: only a valid flow is laid out'"
        variant="text"
        @click="tidy"
      >Tidy up</v-btn>

      <template v-if="!readonly">
        <v-btn
          v-if="otherwiseCandidate"
          prepend-icon="mdi-call-split"
          size="small"
          title="Take this flow when the condition fails (BPMN's default flow)"
          variant="text"
          @click="makeOtherwise"
        >Make otherwise</v-btn>

        <v-btn
          v-if="selection.flow || selection.shapes.length > 0"
          color="error"
          prepend-icon="mdi-delete-outline"
          size="small"
          :title="removeTitle"
          variant="text"
          @click="removeSelected"
        >Remove</v-btn>
      </template>

      <v-spacer />

      <v-tooltip v-if="!readonly" location="bottom" max-width="340">
        <template #activator="{ props: tip }">
          <v-icon
            v-bind="tip"
            aria-label="How to draw"
            class="bpmn-help mr-2"
            icon="mdi-information-outline"
            size="20"
            tabindex="0"
          />
        </template>
        Drag from the catalog onto an arrow to insert, or onto the canvas to place freely. Wire from a shape's right dot
        to another shape; drag an arrow's end to rewire it. Delete removes, Ctrl+Z undoes.
      </v-tooltip>

      <v-chip
        class="mr-1"
        :color="parsed.nodes ? 'success' : 'warning'"
        :prepend-icon="parsed.nodes ? 'mdi-check-circle-outline' : 'mdi-alert-outline'"
        size="small"
        variant="tonal"
      >{{ parsed.nodes ? 'Valid flow' : `${parsed.issues.length} to fix` }}</v-chip>

      <v-btn
        :disabled="!parsed.nodes"
        prepend-icon="mdi-download"
        size="small"
        title="The flow as a BPMN 2.0 file, for bpmn.io or Camunda Modeler"
        variant="text"
        @click="download"
      >BPMN</v-btn>

      <v-btn
        aria-label="Fit the diagram"
        icon="mdi-fit-to-screen-outline"
        size="small"
        title="Fit the diagram"
        variant="text"
        @click="fit"
      />
    </div>

    <div class="bpmn-body">
      <div
        ref="canvas"
        :aria-label="label"
        class="bpmn-canvas"
        :class="{ 'bpmn-canvas--wiring': wiring, 'bpmn-canvas--dropping': dragging }"
        role="region"
        tabindex="0"
        @dragleave="onDragLeave"
        @dragover="onDragOver"
        @drop="onDrop"
        @keydown="onKey"
      >
        <VueFlow
          :id="flowId"
          :apply-default="false"
          :connection-line-type="ConnectionLineType.SmoothStep"
          :delete-key-code="null"
          :edges-updatable="!readonly"
          :is-valid-connection="wirable"
          :max-zoom="1.5"
          :min-zoom="0.2"
          :multi-selection-key-code="null"
          :nodes-connectable="!readonly"
          :nodes-draggable="!readonly"
          :selection-key-code="null"
          :snap-grid="[8, 8]"
          snap-to-grid
          :zoom-on-double-click="false"
          @connect="onConnect"
          @connect-end="wiring = false"
          @connect-start="wiring = true"
          @edge-click="({ edge }) => selectFlow(edge.id)"
          @edge-update="({ edge, connection }) => commit(reconnect(diagram, edge.id, connection.source, connection.target))"
          @node-click="({ node }) => selectShape(node.id)"
          @node-drag="onNodeDrag"
          @node-drag-start="onNodeDragStart"
          @node-drag-stop="onNodeDragStop"
          @nodes-change="onNodesChange"
          @nodes-initialized="onInitialized"
          @pane-click="clearSelection"
        >
          <Background :gap="16" pattern-color="#c3ced6" />
          <Controls position="bottom-right" :show-interactive="false" />

          <template #node-bpmn="{ data, id }">
            <BpmnShape :data="data" :readonly="readonly" @open="open(id)" />
          </template>

          <template #edge-bpmn="edge">
            <BpmnEdge v-bind="edge" />
          </template>
        </VueFlow>

        <div v-if="!readonly && nodes.length === 0 && diagram.shapes.length <= 2" class="bpmn-canvas__hint text-body-2">
          <v-icon icon="mdi-gesture-tap-hold" size="20" />
          Drag {{ mode === 'plan' ? 'a process step' : 'a skill' }} from the catalog onto the arrow
        </div>
      </div>

      <!-- After the canvas, over it; what is dropped on the catalog itself does not reach the canvas. -->
      <v-slide-x-transition>
        <aside v-if="showCatalog && !readonly" aria-label="Catalog" class="bpmn-catalog" :class="{ 'bpmn-catalog--dragging': dragging }">
          <div class="bpmn-catalog__head">
            <span class="text-subtitle-2">Catalog</span>

            <v-btn
              aria-label="Close the catalog"
              density="comfortable"
              icon="mdi-close"
              size="small"
              variant="text"
              @click="setCatalog(false)"
            />
          </div>

          <BpmnPalette :groups="groups" @add="addFromCatalog" @drag="dragging = $event" />
        </aside>
      </v-slide-x-transition>
    </div>

    <div v-if="parsed.issues.length > 0" class="bpmn-status">
      <button
        v-for="issue in parsed.issues"
        :key="issue.text"
        class="bpmn-status__issue text-body-2"
        type="button"
        @click="show(issue.shapes)"
      >
        <v-icon color="warning" icon="mdi-alert-circle-outline" size="16" />
        <span>{{ issue.text }}</span>
        <v-icon class="ml-auto" icon="mdi-crosshairs-gps" size="14" />
      </button>

      <p class="text-caption text-medium-emphasis mt-1">Until the drawing is a valid flow, the last valid one is kept and cannot be saved over.</p>
    </div>

    <v-snackbar v-model="noticeShown" location="bottom" timeout="2500">{{ notice }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
  import type { ResourceSkill } from '../../ProcessSequence/skills/skillFlow'
  import type { CallNode, PlanNode, PlanProcess, StepNode } from '../../ProcessSequence/types/plan'
  import type { CatalogItem, Payload } from './bpmnCatalog'
  import type { Diagram, Parsed, ShapeKind } from './bpmnDiagram'
  import type { Fragment } from './bpmnEdit'
  import type { ShapeInfo } from './bpmnGraph'
  import type { TaskDetails } from './bpmnXml'
  import type { Connection, Edge, NodeChange, NodeDragEvent } from '@vue-flow/core'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { ConnectionLineType, getRectOfNodes, useVueFlow, VueFlow } from '@vue-flow/core'
  import { useRouter } from 'vue-router'
  import { useTheme } from 'vuetify'
  import { assignSkill, handedParameter, instanceName } from '../../ProcessSequence/skills/skillFlow'
  import { newComparison } from '../../ProcessSequence/utils/conditions'
  import { setOperation } from '../../ProcessSequence/utils/operation'
  import { flattenNodes, newNode } from '../../ProcessSequence/utils/plan'
  import { catalogGroups, PALETTE_MIME } from './bpmnCatalog'
  import { diagramFromFlow, flowFromDiagram, laidOut, structureKey } from './bpmnDiagram'
  import BpmnEdge from './BpmnEdge.vue'
  import { addFragment, blockFragment, cannotConnect, connect, insertOnFlow, moveOntoFlow, moveShapes, newShapeId, placeOnFlow, reconnect, removalOf, removeFlow, removeShapes, setOtherwise, shapeFragment } from './bpmnEdit'
  import { bpmnGraph } from './bpmnGraph'
  import { conditionText } from './bpmnLayout'
  import BpmnPalette from './BpmnPalette.vue'
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
   * out; ``issues`` says what keeps the drawing from being a flow, so that the editor does not save.
   *
   * Drawn freely (bpmnDiagram): steps, calls and blocks dragged from the catalog onto an arrow or
   * anywhere, wired by hand. The validator reads the drawing back into the flow after each change; while
   * it cannot, the model keeps the last valid flow.
   */
  const props = withDefaults(defineProps<{
    label: string
    selectedId: string
    readonly?: boolean
    mode?: 'skill' | 'plan'
    /** The plan's sequences a call can call, by id. */
    targets?: { id: string, name: string }[]
    /** The planner's process steps, for its catalog. */
    processes?: PlanProcess[]
    /** The skill editor's skills (the module's and its components'), for its catalog. */
    catalog?: ResourceSkill[]
  }>(), { mode: 'skill', targets: () => [], processes: () => [], catalog: () => [] })
  const emit = defineEmits<{ select: [id: string], open: [scopeId: string], issues: [texts: string[]] }>()
  const nodes = defineModel<PlanNode[]>({ required: true })
  const router = useRouter()
  const theme = useTheme()
  const skillLink = useSkillLink()
  const flowId = `bpmn-flow-${useId()}`
  const { fitView, getNodes, screenToFlowCoordinate, setNodes, setEdges, setViewport } = useVueFlow(flowId)
  const AUTO_LAYOUT = 'process-sequence.bpmn-auto-layout'
  const CATALOG = 'process-sequence.bpmn-catalog'
  /** What the open catalog takes of the canvas's left edge: its width and margins. */
  const CATALOG_ROOM = 260

  const canvas = ref<HTMLElement>()
  /** What each task's and each split's shape stands for. Kept for the editor's life, so undo finds it. */
  const registry = new Map<string, PlanNode>()
  const diagram = shallowRef<Diagram>({ shapes: [], flows: [] })
  const parsed = shallowRef<Parsed>({ issues: [], blocks: new Map(), branchFlows: new Map(), made: new Map() })
  const past = shallowRef<Diagram[]>([])
  const future = shallowRef<Diagram[]>([])
  const autoLayout = ref(readChoice(AUTO_LAYOUT) !== 'off')
  /** The catalog floats over the canvas; closed unless opened (and kept open) in this browser. */
  const showCatalog = ref(readChoice(CATALOG) === 'open')
  const selection = ref<{ shapes: string[], flow: string }>({ shapes: [], flow: '' })
  /** The flow, or the shape, that what is dragged would go onto. */
  const target = ref('')
  const dragging = ref(false)
  const wiring = ref(false)
  const notice = ref('')
  const noticeShown = ref(false)
  let dragBefore: Diagram | null = null
  let emittedKey = ''
  let reported: string | null = null
  let fitPending = true

  // The canvas made wider or narrower (a side panel hidden or shown, the window resized): fit again,
  // once it has settled, so the diagram uses the room it has.
  let width = 0
  let refit: ReturnType<typeof setTimeout> | undefined
  const resized = typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0)
      if (width && next && Math.abs(next - width) > 8) {
        clearTimeout(refit)
        refit = setTimeout(fit, 150)
      }
      width = next || width
    })
  onMounted(() => canvas.value && resized?.observe(canvas.value))
  onBeforeUnmount(() => {
    resized?.disconnect()
    clearTimeout(refit)
  })

  /** A component's or a station's short name, from its AAS id. */
  const component = (aasId: string) => aasId.split('/').at(-1)?.replace(/AAS$/, '') ?? ''
  const groups = computed(() => catalogGroups(props.mode, { processes: props.processes, targets: props.targets, skills: props.catalog }))
  const items = computed(() => new Map(groups.value.flatMap(group => group.items).map(item => [item.key, item])))
  /** The flow's nodes as the parent holds them (reactive), by the object they are. */
  const live = computed(() => new Map(flattenNodes(nodes.value).map(node => [toRaw(node), node])))
  const splitOfJoin = computed(() => new Map([...parsed.value.blocks].map(([split, block]) => [block.join, split])))
  const issueOf = computed(() => {
    const found = new Map<string, string>()
    for (const issue of parsed.value.issues) {
      for (const id of issue.shapes) {
        if (!found.has(id)) found.set(id, issue.text)
      }
    }
    return found
  })
  const selectedShapes = computed(() => new Set([
    ...selection.value.shapes,
    ...(props.selectedId ? diagram.value.shapes.filter(shape => planIdOf(shape.id) === props.selectedId).map(shape => shape.id) : []),
  ]))
  const graph = computed(() => bpmnGraph(diagram.value, info, {
    selectedShapes: selectedShapes.value, selectedFlow: selection.value.flow, target: target.value, issues: issueOf.value,
  }, String(theme.current.value.colors.primary)))
  // A flow changed from outside (loaded, another command shown, a type changed in the inspector, a
  // branch added) is drawn anew; a flow this editor handed out is not. Drawn before the edges are
  // first handed to Vue Flow, with the shapes they connect.
  watch(() => structureKey(nodes.value), key => {
    if (key !== emittedKey) load()
  }, { immediate: true })
  // Into Vue Flow's store, the shapes before the flows between them: an edge whose shapes the store
  // does not have yet is dropped, and as props the two are taken in an order of Vue Flow's.
  watch(graph, value => {
    setNodes(value.nodes)
    setEdges(value.edges)
  }, { immediate: true })
  const otherwiseCandidate = computed(() => {
    const flow = diagram.value.flows.find(item => item.id === selection.value.flow)
    return !!flow && !flow.otherwise && diagram.value.shapes.find(shape => shape.id === flow.source)?.kind === 'xor'
  })
  const removeTitle = computed(() => {
    if (selection.value.flow) return 'Remove the selected flow (Delete)'
    const id = selection.value.shapes[0] ?? ''
    return parsed.value.blocks.has(id) || splitOfJoin.value.has(id) ? 'Remove the block: both gateways and what is in its branches (Delete)' : 'Remove the selected shape (Delete)'
  })

  // Selected elsewhere (the inspector, the tree): this editor's own selection gives way.
  watch(() => props.selectedId, id => {
    const own = selection.value.shapes[0]
    if (own && planIdOf(own) !== id) selection.value = { shapes: [], flow: '' }
  })

  /** A choice kept per browser, or null where none is (or none can be) kept. */
  function readChoice (key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function keepChoice (key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Not kept: the choice holds for this page.
    }
  }

  function load (): void {
    const drawn = diagramFromFlow(nodes.value)
    registry.clear()
    for (const [id, node] of drawn.registry) registry.set(id, node)
    diagram.value = drawn.diagram
    parsed.value = flowFromDiagram(drawn.diagram, registry)
    emittedKey = structureKey(nodes.value)
    past.value = []
    future.value = []
    selection.value = { shapes: [], flow: '' }
    fitPending = true
    report()
  }

  /** Take a changed drawing, to be undone. */
  function commit (next: Diagram, before: Diagram = diagram.value): void {
    if (next === before) return
    past.value = [...past.value.slice(-99), before]
    future.value = []
    apply(next)
  }

  /** Read the drawing back into the flow; a valid flow goes to the model (and is laid out, if wanted). */
  function apply (next: Diagram): void {
    const result = flowFromDiagram(next, registry)
    diagram.value = result.nodes && autoLayout.value ? laidOut(next, registry, result) : next
    parsed.value = result
    report()
    if (!result.nodes || JSON.stringify(result.nodes) === JSON.stringify(nodes.value)) return
    for (const [id, node] of result.made) registry.set(id, node)
    emittedKey = structureKey(result.nodes)
    nodes.value = result.nodes
  }

  function report (): void {
    const texts = parsed.value.issues.map(issue => issue.text)
    if (texts.join('\n') === reported) return
    reported = texts.join('\n')
    emit('issues', texts)
  }

  function say (text: string): void {
    notice.value = text
    noticeShown.value = true
  }

  /** The node a shape stands for, as the parent holds it if it is in the flow. */
  function nodeOf (id: string): PlanNode | undefined {
    const raw = registry.get(id)
    return raw ? (live.value.get(toRaw(raw)) ?? raw) : undefined
  }

  /** The id of the step or the block a shape stands for: a join stands for its split's block. */
  function planIdOf (id: string): string {
    return nodeOf(splitOfJoin.value.get(id) ?? id)?.id ?? ''
  }

  /** Every id the flow and the drawing use: a new step in the skill editor is named apart from them. */
  const taken = (): string[] => [...new Set([...flattenNodes(nodes.value), ...registry.values()].map(node => node.id))]

  function info (id: string, kind: ShapeKind): ShapeInfo {
    if (kind === 'start' || kind === 'end') return { title: kind === 'start' ? 'Start' : 'End', lines: [], linked: false, empty: false }
    if (kind === 'and' || kind === 'xor') {
      if (splitOfJoin.value.has(id)) return { title: '', lines: [], linked: false, empty: false }
      const node = nodeOf(id)
      const condition = node && (node.kind === 'decision' || node.kind === 'conditional') ? conditionText(node.condition) : undefined
      return { title: node?.name ?? '', lines: [], linked: false, empty: false, condition }
    }
    const node = nodeOf(id)
    const empty = node?.kind === 'step' && (props.mode === 'skill' ? !node.skillId : !node.process && node.executionMode !== 'manual')
    return { title: node?.name ?? '', lines: lines(node), linked: !!node && opens(node), empty }
  }

  /** A call opens what it calls; a step the skill it runs, if it names one. */
  function opens (node: PlanNode): boolean {
    return node.kind === 'call' || !!skillLink(node)
  }

  /** What a task shows under its name. */
  function lines (node: PlanNode | undefined): string[] {
    if (node?.kind === 'call') {
      return [`Calls ${props.targets.find(item => item.id === node.scopeId)?.name ?? 'a subprocess'}`]
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
      node.process?.name || 'No process step chosen',
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

  /** A new block; in the skill editor named like its instance in the control program. */
  function fresh (kind: 'parallel' | 'decision' | 'conditional'): PlanNode {
    const node = newNode(kind)
    if (props.mode === 'skill') {
      const name = instanceName({ parallel: 'Parallel', decision: 'Decision', conditional: 'Optional' }[kind], taken())
      node.id = name
      node.name = name
      if (node.kind === 'conditional') node.condition = newComparison()
    }
    return node
  }

  /** The shapes a catalog item makes, centred on ``(cx, cy)``, with what they stand for registered. */
  function make (payload: Payload, cx: number, cy: number): Fragment {
    const id = newShapeId()
    switch (payload.kind) {
      case 'step': {
        const node = newNode('step') as StepNode
        if (payload.process) setOperation(node, payload.process)
        if (payload.skill) {
          assignSkill(node, payload.skill, taken())
        } else if (props.mode === 'skill') {
          node.id = instanceName('Step', taken())
          node.name = node.id
        }
        registry.set(id, node)
        return shapeFragment(id, 'task', cx, cy)
      }
      case 'call': {
        const node = newNode('call', payload.scopeId) as CallNode
        node.name = payload.name
        registry.set(id, node)
        return shapeFragment(id, 'call', cx, cy)
      }
      case 'gateway': {
        registry.set(id, fresh(payload.gateway === 'and' ? 'parallel' : 'decision'))
        return shapeFragment(id, payload.gateway, cx, cy)
      }
      default: {
        const block = fresh(payload.block)
        registry.set(id, block)
        const branches = block.kind === 'parallel' || block.kind === 'decision' ? block.branches.map(branch => ({ id: branch.id, name: branch.name })) : []
        return blockFragment(id, newShapeId(), payload.block === 'parallel' ? 'and' : 'xor', cx, cy, branches)
      }
    }
  }

  /** The flow something goes onto: the flow itself, or the one out of a shape (to go after it). */
  function flowOf (hit: string): string {
    if (diagram.value.flows.some(flow => flow.id === hit)) return hit
    const outs = diagram.value.flows.filter(flow => flow.source === hit)
    return outs.length === 1 ? outs[0]!.id : ''
  }

  function place (item: CatalogItem, cx: number, cy: number, onto: string): void {
    const fragment = make(item.payload, cx, cy)
    const flow = flowOf(onto)
    if (!flow) {
      commit(addFragment(diagram.value, fragment))
    } else if (autoLayout.value) {
      commit(insertOnFlow(diagram.value, flow, fragment))
    } else {
      const room = placeOnFlow(diagram.value, flow, fragment)
      commit(insertOnFlow(room.diagram, flow, room.fragment))
    }
    selectShape(fragment.entry)
  }

  /** Double-click or Enter in the catalog: onto the selected flow, after the selected shape, or at the end. */
  function addFromCatalog (key: string): void {
    const item = items.value.get(key)
    if (!item || props.readonly) return
    const end = diagram.value.shapes.find(shape => shape.kind === 'end')!
    const onto = selection.value.flow || flowOf(selection.value.shapes[0] ?? '') || diagram.value.flows.find(flow => flow.target === end.id)?.id || ''
    const flow = diagram.value.flows.find(item => item.id === onto)
    const from = diagram.value.shapes.find(shape => shape.id === flow?.source)
    const to = diagram.value.shapes.find(shape => shape.id === flow?.target)
    const cx = from && to ? (from.x + to.x) / 2 + 40 : end.x + 18
    const cy = from && to ? (from.y + to.y) / 2 + 18 : end.y + 160
    place(item, cx, cy, onto)
  }

  /** What is under the pointer to drop onto: a flow, or a shape with one way out. ``ignore``: the shape dragged. */
  function hitAt (x: number, y: number, ignore = ''): string {
    for (const element of document.elementsFromPoint(x, y)) {
      if (!canvas.value?.contains(element)) continue
      const edge = element.closest<SVGElement>('.vue-flow__edge')?.dataset.id
      if (edge) {
        const flow = diagram.value.flows.find(item => item.id === edge)
        if (flow && flow.source !== ignore && flow.target !== ignore) return edge
        continue
      }
      const shape = element.closest<HTMLElement>('.vue-flow__node')?.dataset.id
      if (shape && shape !== ignore) {
        const outs = diagram.value.flows.filter(flow => flow.source === shape)
        return outs.length === 1 && outs[0]!.target !== ignore ? shape : ''
      }
    }
    return ''
  }

  function onDragOver (event: DragEvent): void {
    if (props.readonly || !event.dataTransfer?.types.includes(PALETTE_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    target.value = hitAt(event.clientX, event.clientY)
  }

  function onDragLeave (event: DragEvent): void {
    if (!canvas.value?.contains(event.relatedTarget as Node | null)) target.value = ''
  }

  function onDrop (event: DragEvent): void {
    const item = items.value.get(event.dataTransfer?.getData(PALETTE_MIME) ?? '')
    dragging.value = false
    if (!item || props.readonly) return
    event.preventDefault()
    const onto = target.value || hitAt(event.clientX, event.clientY)
    target.value = ''
    const at = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    place(item, at.x, at.y, onto)
    canvas.value?.focus()
  }

  function pointer (event: MouseEvent | TouchEvent): { x: number, y: number } | null {
    if ('changedTouches' in event) {
      const touch = event.changedTouches[0] ?? event.touches[0]
      return touch ? { x: touch.clientX, y: touch.clientY } : null
    }
    return { x: event.clientX, y: event.clientY }
  }

  const movable = (id: string): boolean => ['task', 'call'].includes(diagram.value.shapes.find(shape => shape.id === id)?.kind ?? '')

  function onNodesChange (changes: NodeChange[]): void {
    const moved = new Map<string, { x: number, y: number }>()
    for (const change of changes) {
      if (change.type === 'position' && change.position) moved.set(change.id, change.position)
    }
    if (moved.size > 0) diagram.value = moveShapes(diagram.value, moved)
  }

  function onNodeDragStart (): void {
    dragBefore = diagram.value
  }

  function onNodeDrag ({ event, node }: NodeDragEvent): void {
    const at = pointer(event)
    target.value = at && movable(node.id) ? hitAt(at.x, at.y, node.id) : ''
  }

  /** Dropped onto a flow (or after a shape): moved into the flow there. Else it stays, or snaps back to the layout. */
  function onNodeDragStop ({ node }: NodeDragEvent): void {
    const before = dragBefore ?? diagram.value
    const onto = flowOf(target.value)
    target.value = ''
    dragBefore = null
    if (onto && movable(node.id)) {
      commit(moveOntoFlow(diagram.value, node.id, onto, !autoLayout.value), before)
    } else if (autoLayout.value && parsed.value.nodes) {
      apply(diagram.value)
    } else if (diagram.value !== before) {
      commit(diagram.value, before)
    }
  }

  /**
   * Whether a wire may be drawn. Vue Flow asks it of every edge it is handed as well ("An edge needs a
   * source and a target" when it says no): the drawing's own flows are.
   */
  function wirable (connection: Connection | Edge): boolean {
    if ('id' in connection && diagram.value.flows.some(flow => flow.id === connection.id)) return true
    return !cannotConnect(diagram.value, connection.source, connection.target)
  }

  function onConnect (connection: Connection): void {
    const why = cannotConnect(diagram.value, connection.source, connection.target)
    if (why) say(why)
    else commit(connect(diagram.value, connection.source, connection.target))
  }

  function selectShape (id: string): void {
    selection.value = { shapes: [id], flow: '' }
    emit('select', planIdOf(id))
  }

  function selectFlow (id: string): void {
    selection.value = { shapes: [], flow: id }
    emit('select', '')
  }

  function clearSelection (): void {
    selection.value = { shapes: [], flow: '' }
    emit('select', '')
  }

  function removeSelected (): void {
    if (props.readonly) return
    if (selection.value.flow) {
      commit(removeFlow(diagram.value, selection.value.flow))
    } else if (selection.value.shapes.length > 0) {
      const ids = removalOf(diagram.value, selection.value.shapes, parsed.value)
      if (ids.size === 0) {
        say('Start and End stay: the flow runs between them.')
        return
      }
      commit(removeShapes(diagram.value, ids))
    }
    clearSelection()
  }

  function makeOtherwise (): void {
    commit(setOtherwise(diagram.value, selection.value.flow))
  }

  function undo (): void {
    const previous = past.value.at(-1)
    if (!previous) return
    past.value = past.value.slice(0, -1)
    future.value = [diagram.value, ...future.value]
    apply(previous)
  }

  function redo (): void {
    const next = future.value[0]
    if (!next) return
    future.value = future.value.slice(1)
    past.value = [...past.value, diagram.value]
    apply(next)
  }

  function setAutoLayout (on: boolean): void {
    autoLayout.value = on
    keepChoice(AUTO_LAYOUT, on ? 'on' : 'off')
    if (on && parsed.value.nodes) commit(laidOut(diagram.value, registry, parsed.value))
  }

  function setCatalog (open: boolean): void {
    showCatalog.value = open
    keepChoice(CATALOG, open ? 'open' : 'closed')
    if (open) fit()
  }

  function tidy (): void {
    if (!parsed.value.nodes) return
    commit(laidOut(diagram.value, registry, parsed.value))
    fit()
  }

  function onKey (event: KeyboardEvent): void {
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
    const command = event.ctrlKey || event.metaKey
    if ((event.key === 'Delete' || event.key === 'Backspace') && !props.readonly) {
      event.preventDefault()
      removeSelected()
    } else if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    } else if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
    } else if (event.key === 'Escape') {
      clearSelection()
    }
  }

  /** An issue's shapes: selected and in view. */
  function show (ids: string[]): void {
    if (ids.length === 0) return
    selection.value = { shapes: ids.slice(0, 1), flow: '' }
    emit('select', planIdOf(ids[0]!))
    void nextTick(() => fitView({ nodes: ids, padding: 0.8, maxZoom: 1, duration: 300 }))
  }

  function onInitialized (): void {
    if (!fitPending) return
    fitPending = false
    fit()
  }

  /** The whole diagram in view; with the catalog open, in the part of the canvas it leaves free. */
  function fit (): void {
    void nextTick(() => {
      const box = canvas.value?.getBoundingClientRect()
      if (!showCatalog.value || props.readonly || !box || getNodes.value.length === 0) {
        void fitView({ padding: 0.15, maxZoom: 1 })
        return
      }
      const rect = getRectOfNodes(getNodes.value)
      const pad = 32
      const width = box.width - CATALOG_ROOM - 2 * pad
      const zoom = Math.max(0.2, Math.min(1, width / rect.width, (box.height - 2 * pad) / rect.height))
      void setViewport({
        x: CATALOG_ROOM + pad + (width - rect.width * zoom) / 2 - rect.x * zoom,
        y: box.height / 2 - (rect.y + rect.height / 2) * zoom,
        zoom,
      })
    })
  }

  /** A call opens the sequence it calls; a step the skill it runs. */
  function open (id: string): void {
    const node = nodeOf(id)
    if (node?.kind === 'call') {
      emit('open', node.scopeId)
      return
    }
    const link = skillLink(node)
    if (link) void router.push(link)
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
.bpmn-editor {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.bpmn-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 0 8px 6px;
}

.bpmn-body {
  position: relative;
  height: max(480px, calc(100vh - 440px));
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.bpmn-catalog {
  position: absolute;
  z-index: 5;
  top: 10px;
  bottom: 10px;
  left: 10px;
  display: flex;
  flex-direction: column;
  width: 240px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  transition: opacity 0.15s;
}

/* While an item is dragged, the diagram under the catalog shows through. */
.bpmn-catalog--dragging {
  opacity: 0.55;
}

.bpmn-catalog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px 0 14px;
}

.bpmn-catalog :deep(.bpmn-palette) {
  flex: 1;
  height: auto;
}

.bpmn-help {
  cursor: help;
  opacity: 0.7;
}

.bpmn-help:hover,
.bpmn-help:focus-visible {
  opacity: 1;
}

.bpmn-canvas {
  position: relative;
  height: 100%;
  background: rgba(var(--v-theme-on-surface), 0.015);
  outline: none;
  transition: box-shadow 0.12s;
}

.bpmn-canvas:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.4);
}

.bpmn-canvas--dropping {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.25);
}

.bpmn-canvas__hint {
  position: absolute;
  top: 16px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  transform: translateX(-50%);
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  pointer-events: none;
}

.bpmn-status {
  padding: 6px 12px 8px;
}

.bpmn-status__issue {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  text-align: left;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}

.bpmn-status__issue:hover {
  background: rgba(var(--v-theme-warning), 0.1);
}

.bpmn-canvas :deep(.vue-flow__edge) {
  cursor: pointer;
}

.bpmn-canvas :deep(.vue-flow__edgeupdater) {
  cursor: move;
}
</style>
