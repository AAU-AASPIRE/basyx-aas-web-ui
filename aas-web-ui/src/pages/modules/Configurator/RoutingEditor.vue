<template>
  <div>
    <v-alert v-if="parseError" class="mb-3" density="compact" type="warning">{{ parseError }} Drawing a new routing replaces it.</v-alert>

    <div v-if="!routing" class="mb-3">
      <p class="mb-3">This line has no routing: the shuttles may travel anywhere on the table (the controller's free mode). Lay out lanes for line mode, so the way between two stations is always the same.</p>
      <v-btn :disabled="readonly" prepend-icon="mdi-vector-polyline" @click="start">Lay out lanes</v-btn>
    </div>

    <template v-else>
      <div class="d-flex ga-2 flex-wrap align-center mb-2">
        <v-btn-toggle
          v-model="tool"
          density="compact"
          divided
          mandatory
          variant="outlined"
        >
          <v-btn prepend-icon="mdi-vector-polyline" value="lane">Lane</v-btn>
          <v-btn prepend-icon="mdi-rotate-right" value="turn">Turn spot</v-btn>
          <v-btn prepend-icon="mdi-format-list-numbered" value="idle">Idle area</v-btn>
        </v-btn-toggle>

        <template v-if="drawing.length > 0">
          <v-btn color="primary" :disabled="drawing.length < 2" @click="finish">Finish lane</v-btn>
          <v-btn variant="text" @click="drawing = []">Cancel</v-btn>
        </template>

        <v-spacer />
        <v-btn color="error" :disabled="readonly" variant="text" @click="free">Free routing</v-btn>
      </div>

      <p class="text-body-small mb-2">{{ hints[tool] }}</p>
    </template>

    <div
      class="route-board"
      :style="{ aspectRatio: `${frame.columns * frame.flyway + 2 * frame.flyway} / ${frame.rows * frame.flyway + 2 * frame.flyway}`, maxWidth: `calc(max(360px, 100vh - 440px) * ${(frame.columns + 2) / (frame.rows + 2)})` }"
    >
      <svg
        ref="svg"
        aria-label="Planar table routing"
        :class="{ editing: routing && !readonly }"
        :viewBox="`${-frame.flyway} ${-frame.flyway} ${width + 2 * frame.flyway} ${height + 2 * frame.flyway}`"
        @click="clickAt"
        @dblclick.prevent="finish"
        @mouseleave="hover = undefined"
        @mousemove="hoverAt"
      >
        <defs>
          <marker
            id="route-arrow"
            markerHeight="5"
            markerWidth="5"
            orient="auto"
            refX="4"
            refY="3"
            viewBox="0 0 6 6"
          ><path class="arrow" d="M0,0 L6,3 L0,6 z" /></marker>
        </defs>

        <rect
          class="frame"
          :height="height"
          :width="width"
          x="0"
          y="0"
        />

        <g v-for="position in positions" :key="position.id">
          <rect
            :class="position.present ? 'flyway' : 'no-flyway'"
            :height="frame.flyway"
            :width="frame.flyway"
            :x="position.c * frame.flyway"
            :y="height - (position.r + 1) * frame.flyway"
          />

          <template v-if="position.present">
            <line
              class="slot-line"
              :x1="(position.c + 0.5) * frame.flyway"
              :x2="(position.c + 0.5) * frame.flyway"
              :y1="height - (position.r + 1) * frame.flyway"
              :y2="height - position.r * frame.flyway"
            />

            <line
              class="slot-line"
              :x1="position.c * frame.flyway"
              :x2="(position.c + 1) * frame.flyway"
              :y1="height - (position.r + 0.5) * frame.flyway"
              :y2="height - (position.r + 0.5) * frame.flyway"
            />
          </template>

          <text v-else class="no-flyway-label" :x="(position.c + 0.5) * frame.flyway" :y="height - (position.r + 0.5) * frame.flyway">no flyway</text>
        </g>

        <g v-for="module in modules" :key="module.name" class="module">
          <rect :height="frame.flyway" :width="frame.flyway" :x="module.x - frame.flyway / 2" :y="height - module.y - frame.flyway / 2" />
          <text :x="module.x" :y="height - module.y">{{ module.name }}</text>
        </g>

        <template v-if="routing">
          <g v-for="(spot, i) in [...turnSpots, ...(hoverSpot ? [hoverSpot] : [])]" :key="`turn-${i}`" :class="['turn-spot', { ghost: i >= turnSpots.length }]">
            <rect :height="frame.flyway - 8" :width="frame.flyway - 8" :x="spot[0] - frame.flyway / 2 + 4" :y="height - spot[1] - frame.flyway / 2 + 4" />
            <text :x="spot[0]" :y="height - spot[1]">↻</text>
          </g>

          <g v-for="(slot, i) in idleSlots" :key="`idle-${i}`" class="idle">
            <rect :height="frame.slot - 16" :width="frame.slot - 16" :x="slot[0] * frame.slot + 8" :y="height - (slot[1] + 1) * frame.slot + 8" />
            <text :x="(slot[0] + 0.5) * frame.slot" :y="height - (slot[1] + 0.5) * frame.slot">{{ i === 0 ? 'Load' : i + 1 }}</text>
          </g>

          <g v-for="(lane, i) in routing.lanes" :key="`lane-${i}`" :class="['lane', { selected: selected === i, 'two-way': !lane.oneWay }]">
            <polyline :points="svgPoints(lane.points)" />

            <template v-if="lane.oneWay">
              <line
                v-for="(step, k) in steps(lane)"
                :key="k"
                class="lane-step"
                marker-end="url(#route-arrow)"
                :x1="step[0]"
                :x2="step[2]"
                :y1="step[1]"
                :y2="step[3]"
              />
            </template>
          </g>

          <polyline v-if="drawing.length > 0" class="drawing" :points="svgPoints(hoverPoint ? [...drawing, ...joinTo(drawing.at(-1)!, hoverPoint)] : drawing)" />

          <circle
            v-if="hoverPoint"
            class="hover"
            :cx="hoverPoint[0]"
            :cy="height - hoverPoint[1]"
            :r="frame.slot / 5"
          />
        </template>
      </svg>
    </div>

    <template v-if="routing">
      <v-alert
        v-if="found.length > 0"
        class="mt-3"
        density="compact"
        type="warning"
        variant="tonal"
      >
        <div>The controller would not take this routing yet:</div>
        <ul class="ms-4"><li v-for="problem in found" :key="problem">{{ problem }}</li></ul>
      </v-alert>

      <v-alert
        v-else
        class="mt-3"
        density="compact"
        type="success"
        variant="tonal"
      >The controller takes this routing (checked as the controller checks it at its Reset).</v-alert>

      <v-card class="mt-3" :title="`Lanes (${routing.lanes.length})`" variant="tonal">
        <v-card-text>
          <p v-if="routing.lanes.length === 0" class="text-body-small">None yet: choose Lane and click slot centres on the table.</p>

          <div
            v-for="(lane, i) in routing.lanes"
            :key="i"
            class="d-flex align-center ga-2 mb-2 flex-wrap"
            @mouseenter="selected = i"
            @mouseleave="selected = -1"
          >
            <v-text-field
              class="lane-name"
              :disabled="readonly"
              label="Name"
              :model-value="lane.name"
              @update:model-value="value => edit(() => { lane.name = value || `Lane ${i + 1}` })"
            />

            <v-switch
              color="primary"
              density="compact"
              :disabled="readonly"
              hide-details
              label="One-way"
              :model-value="lane.oneWay"
              @update:model-value="value => edit(() => { lane.oneWay = Boolean(value) })"
            />

            <span class="text-body-small">{{ trace(frame, lane.points).slots.length }} slots</span>

            <v-btn
              :disabled="readonly"
              icon="mdi-swap-horizontal"
              size="small"
              title="Reverse its direction"
              variant="text"
              @click="edit(() => lane.points.reverse())"
            />

            <v-btn
              :disabled="readonly"
              icon="mdi-delete-outline"
              size="small"
              title="Remove the lane"
              variant="text"
              @click="edit(() => routing!.lanes.splice(i, 1))"
            />
          </div>
        </v-card-text>
      </v-card>

      <v-card class="mt-3" title="Turn spots and idle area" variant="tonal">
        <v-card-text>
          <p class="text-body-small mb-2">{{ routing.turnSpots.length === 0 ? 'No turn spots: the shuttles turn on any flyway centre.' : `${routing.turnSpots.length} turn spot(s): a shuttle turns only there, on the one nearest to it along the lanes, and waits for it while another turns there (a target turned off the axes still on its own spot).` }} A turn claims the square one flyway wide around the spot.</p>
          <p class="text-body-small mb-2">{{ idleSlots.length === 0 ? 'No idle area: a free shuttle waits where it was.' : `Idle area: ${idleSlots.length} slots, the loading queue in order (Load first).` }} Give it a slot for every shuttle.</p>
          <v-btn :disabled="readonly || routing.turnSpots.length === 0" size="small" variant="text" @click="edit(() => { routing!.turnSpots = [] })">Clear turn spots</v-btn>
          <v-btn :disabled="readonly || routing.idleArea.length === 0" size="small" variant="text" @click="edit(() => { routing!.idleArea = [] })">Clear idle area</v-btn>
        </v-card-text>
      </v-card>

      <v-card class="mt-3" title="For the planar controller" variant="tonal">
        <v-card-text>
          <p class="text-body-small mb-2">Review and save keeps the routing in this line's AAS, not the planar table's (the table's is rewritten from the controller): <strong>{{ system.shell.idShort ?? system.shell.id }} › Parameters › {{ ROUTING }}</strong>, a collection of its Lanes, TurnSpots and IdleArea. The controller reads its value at startup in line mode, and again at every Reset of the table (a changed routing is taken by pressing Reset); set in its <code>.env</code>:</p>

          <pre class="controller-env">MODE=line
LINE_LAYOUT={{ url ?? '(saved to the repository first)' }}</pre>

          <v-btn
            v-if="url"
            class="mt-2"
            prepend-icon="mdi-content-copy"
            size="small"
            variant="text"
            @click="copy"
          >Copy</v-btn>
        </v-card-text>
      </v-card>
    </template>

    <v-alert
      v-if="message"
      class="mt-3"
      density="compact"
      role="status"
      type="info"
    >{{ message }}</v-alert>

    <p class="text-body-small mt-3">The flyways are what the planar table reports (its AAS, from the controller): they are shown, never written here.</p>
  </div>
</template>

<script setup lang="ts">
  import type { Model, Pose } from './model'
  import type { Frame, Lane, Point, Routing, Slot } from './routing'
  import { useInfrastructureStore } from '@/store/InfrastructureStore'
  import { clone, moduleCenter } from './model'
  import { emptyRouting, hasSlot, key, problems, readRouting, ROUTING, routingUrl, slotCenter, spotOf, trace, writeRouting } from './routing'

  const props = defineProps<{ system: Model, frame: Frame, modules: { name: string, pose: Pose }[], xbots: number, readonly: boolean }>()
  const emit = defineEmits<{ change: [ids: string[]] }>()
  const infrastructure = useInfrastructureStore()
  const kept = readRouting(props.system)
  const routing = ref<Routing | undefined>(kept.routing && clone(kept.routing))
  const parseError = ref(kept.error ?? '')
  const tool = ref<'lane' | 'turn' | 'idle'>('lane')
  const drawing = ref<Point[]>([])
  const hover = ref<Point>() // where the pointer is on the table, mm
  const selected = ref(-1)
  const message = ref('')
  const svg = ref<SVGSVGElement>()
  const hints = {
    lane: 'Click slot centres along the lane; a corner is added between two clicks that are not in line. Click its first slot again to close a loop, double-click or Finish lane to end it. New lanes are one-way, from the first click.',
    turn: 'Click a flyway\'s centre, or where four flyways meet, to make it a turn spot; click a turn spot to remove it. Put one on a lane.',
    idle: 'Click slots in queue order, the loading position first; click the last one again to remove it.',
  }
  const width = computed(() => props.frame.columns * props.frame.flyway)
  const height = computed(() => props.frame.rows * props.frame.flyway)
  const positions = computed(() => Array.from({ length: props.frame.columns * props.frame.rows }, (_, i) => {
    const c = i % props.frame.columns, r = Math.floor(i / props.frame.columns)
    return { id: key(c, r), c, r, present: props.frame.flyways.has(key(c, r)) }
  }))
  const modules = computed(() => props.modules.map(item => ({ name: item.name, ...moduleCenter(item.pose, props.frame.flyway) })))
  const idleSlots = computed(() => routing.value ? trace(props.frame, routing.value.idleArea).slots : [])
  const found = computed(() => routing.value ? problems(routing.value, props.frame, props.xbots) : [])
  const url = computed(() => routingUrl(props.system, infrastructure.getSubmodelRepoURL))
  const hoverSlot = computed(() => hover.value && slotOf(hover.value))
  const hoverPoint = computed(() => tool.value !== 'turn' && hoverSlot.value ? slotCenter(props.frame, hoverSlot.value) : undefined)
  const hoverSpot = computed(() => tool.value === 'turn' && hover.value ? spotNear(hover.value) : undefined)
  const turnSpots = computed(() => routing.value ? routing.value.turnSpots.map(point => spotOf(props.frame, point) ?? point) : [])
  // A line read again (after a reload) brings its own routing.
  watch(() => props.system, system => {
    const again = readRouting(system)
    routing.value = again.routing && clone(again.routing)
    parseError.value = again.error ?? ''
    drawing.value = []
  })

  const svgPoints = (points: Point[]) => points.map(p => `${p[0]},${height.value - p[1]}`).join(' ')
  /** An arrow per slot step of a one-way lane, from the step's middle on. */
  function steps (lane: Lane) {
    const slots = trace(props.frame, lane.points).slots
    return slots.slice(1).map((to, k) => {
      const [x0, y0] = slotCenter(props.frame, slots[k]!), [x1, y1] = slotCenter(props.frame, to)
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
      return [mx - (x1 - x0) * 0.15, height.value - (my - (y1 - y0) * 0.15), mx + (x1 - x0) * 0.15, height.value - (my + (y1 - y0) * 0.15)]
    })
  }
  /** From a point to the next along rows and columns: through a corner when they are not in line. */
  function joinTo (from: Point, to: Point): Point[] {
    if (from[0] === to[0] || from[1] === to[1]) return [to]
    for (const corner of [[to[0], from[1]], [from[0], to[1]]] as Point[]) {
      const at: Slot = [Math.floor(corner[0] / props.frame.slot), Math.floor(corner[1] / props.frame.slot)]
      if (hasSlot(props.frame, at) && !trace(props.frame, [from, corner, to]).error) return [corner, to]
    }
    return [[to[0], from[1]], to]
  }
  function pointAtEvent (event: MouseEvent): Point | undefined {
    const matrix = svg.value?.getScreenCTM()
    if (!matrix) return
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return [p.x, height.value - p.y]
  }
  function slotOf (point: Point): Slot | undefined {
    const slot: Slot = [Math.floor(point[0] / props.frame.slot), Math.floor(point[1] / props.frame.slot)]
    return hasSlot(props.frame, slot) ? slot : undefined
  }
  /** The turn spot nearest a point: where four flyways meet within a quarter flyway, else its flyway's centre. */
  function spotNear (point: Point): Point | undefined {
    const f = props.frame.flyway
    const corner: Point = [Math.round(point[0] / f) * f, Math.round(point[1] / f) * f]
    const junction = Math.abs(point[0] - corner[0]) < f / 4 && Math.abs(point[1] - corner[1]) < f / 4 ? spotOf(props.frame, corner) : undefined
    return junction ?? spotOf(props.frame, [(Math.floor(point[0] / f) + 0.5) * f, (Math.floor(point[1] / f) + 0.5) * f])
  }
  function hoverAt (event: MouseEvent) {
    hover.value = routing.value && !props.readonly ? pointAtEvent(event) : undefined
  }
  function toggleSpot (point: Point | undefined) {
    const spot = point && spotNear(point)
    if (!spot) {
      message.value = 'Click a flyway\'s centre, or where four flyways meet.'
      return
    }
    message.value = ''
    const spots = routing.value!.turnSpots
    const at = turnSpots.value.findIndex(s => s[0] === spot[0] && s[1] === spot[1])
    edit(() => at === -1 ? spots.push(spot) : spots.splice(at, 1))
  }
  function edit (change: () => void) {
    if (props.readonly || !routing.value) return
    change()
    writeRouting(props.system, routing.value)
    emit('change', [props.system.shell.id])
  }
  function start () {
    routing.value = emptyRouting()
    parseError.value = ''
    tool.value = 'lane'
  }
  function free () {
    if (!window.confirm('Remove this line\'s lanes, turn spots and idle area? The controller then routes freely (MODE=free).')) return
    routing.value = undefined
    drawing.value = []
    writeRouting(props.system, undefined)
    emit('change', [props.system.shell.id])
  }
  function finish () {
    if (drawing.value.length < 2) return
    const lane = { name: `Lane ${routing.value!.lanes.length + 1}`, points: drawing.value, oneWay: true }
    drawing.value = []
    edit(() => routing.value!.lanes.push(lane))
    message.value = `Added ${lane.name}. Untick One-way to drive it both ways.`
  }
  function clickAt (event: MouseEvent) {
    if (props.readonly || !routing.value || event.detail > 1) return
    const at = pointAtEvent(event)
    if (tool.value === 'turn') {
      toggleSpot(at)
      return
    }
    const slot = at && slotOf(at)
    if (!slot) {
      message.value = 'Click a slot on a flyway.'
      return
    }
    const point = slotCenter(props.frame, slot)
    const same = (a?: Point) => a !== undefined && a[0] === point[0] && a[1] === point[1]
    message.value = ''
    if (tool.value === 'lane') {
      if (same(drawing.value.at(-1))) return
      if (drawing.value.length > 1 && same(drawing.value[0])) {
        drawing.value.push(...joinTo(drawing.value.at(-1)!, point))
        finish()
        return
      }
      drawing.value.push(...(drawing.value.length > 0 ? joinTo(drawing.value.at(-1)!, point) : [point]))
    } else {
      const idle = routing.value.idleArea
      if (same(idle.at(-1))) {
        edit(() => idle.pop())
      } else if (idleSlots.value.some(s => s[0] === slot[0] && s[1] === slot[1])) {
        message.value = 'That slot is in the idle area already.'
      } else {
        edit(() => idle.push(...(idle.length > 0 ? joinTo(idle.at(-1)!, point) : [point])))
      }
    }
  }
  async function copy () {
    if (url.value) await navigator.clipboard.writeText(`MODE=line\nLINE_LAYOUT=${url.value}`)
    message.value = 'Copied.'
  }
</script>

<style scoped>
.route-board { position: relative; width: 100%; background: rgb(var(--v-theme-surface-variant)); border: 2px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 6px; }
.route-board svg { position: absolute; width: 100%; height: 100%; }
.route-board svg.editing { cursor: crosshair; }
.frame { fill: none; stroke: rgba(var(--v-border-color), .6); stroke-dasharray: 6 6; }
.flyway { fill: #202221; stroke: #737878; stroke-width: 1; }
.no-flyway { fill: rgba(var(--v-theme-on-surface), .04); stroke: rgba(var(--v-theme-on-surface), .25); stroke-dasharray: 8 6; }
.no-flyway-label { fill: #bdbdbd; font-size: 18px; text-anchor: middle; dominant-baseline: middle; }
.slot-line { stroke: #3d4140; stroke-width: 1; }
.module rect { fill: rgb(var(--v-theme-surface)); stroke: rgba(var(--v-border-color), .5); opacity: .8; }
.module text { fill: rgb(var(--v-theme-on-surface)); font-size: 16px; text-anchor: middle; dominant-baseline: middle; }
.turn-spot rect { fill: rgba(255, 179, 0, .12); stroke: #ffb300; stroke-width: 3; stroke-dasharray: 10 6; }
.turn-spot text { fill: #ffb300; font-size: 56px; text-anchor: middle; dominant-baseline: central; }
.turn-spot.ghost { opacity: .45; pointer-events: none; }
.idle rect { fill: rgba(76, 175, 80, .3); stroke: #66bb6a; stroke-width: 2; }
.idle text { fill: #e8f5e9; font-size: 20px; text-anchor: middle; dominant-baseline: middle; }
.lane polyline { fill: none; stroke: rgb(var(--v-theme-primary)); stroke-width: 10; stroke-linejoin: round; stroke-linecap: round; opacity: .7; }
.lane.two-way polyline { stroke-dasharray: 2 14; stroke-width: 12; }
.lane.selected polyline { opacity: 1; stroke-width: 14; }
.lane-step { stroke: transparent; stroke-width: 6; }
.arrow { fill: #fff; }
.drawing { fill: none; stroke: #fff; stroke-width: 6; stroke-dasharray: 12 8; }
.hover { fill: rgba(255, 255, 255, .7); pointer-events: none; }
.lane-name { max-width: 220px; }
.controller-env { white-space: pre-wrap; word-break: break-all; font-size: 12px; padding: 8px; border-radius: 6px; background: rgba(var(--v-theme-on-surface), .06); }
</style>
