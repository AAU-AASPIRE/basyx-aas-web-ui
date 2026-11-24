<template>
  <svg
    ref="svg"
    aria-label="Product assembly"
    class="assembly"
    role="group"
    :viewBox="`0 0 440 ${Math.max(260, items.length * 145 + 40)}`"
  >
    <defs><linearGradient id="configurator-part"><stop offset="0" stop-color="rgba(var(--v-theme-on-surface), .5)" /><stop offset=".35" stop-color="rgba(var(--v-theme-on-surface), .12)" /><stop offset="1" stop-color="rgba(var(--v-theme-on-surface), .45)" /></linearGradient></defs>

    <line
      stroke="rgba(var(--v-theme-on-surface), .2)"
      stroke-dasharray="3 6"
      x1="110"
      x2="110"
      y1="20"
      :y2="items.length * 145 + 20"
    />

    <g
      v-for="(part, index) in items"
      :key="part.path.join('.')"
      :aria-label="`Edit ${label(part.node)}`"
      :class="{ 'assembly-dragging': gesture?.source === part && moved }"
      role="button"
      tabindex="0"
      :transform="`translate(110 ${index * 145 + 85})`"
      @click="select(part)"
      @keydown.enter="$emit('select', part)"
      @keydown.space.prevent="$emit('select', part)"
      @pointercancel="cancelPointer"
      @pointerdown="begin($event, part)"
      @pointermove="movePointer"
      @pointerup="endPointer"
    >
      <rect
        class="part-hit-area"
        fill="transparent"
        height="140"
        width="420"
        x="-100"
        y="-70"
      />

      <g fill="url(#configurator-part)" stroke="rgba(var(--v-theme-on-surface), .65)" stroke-width="1.2">
        <path v-if="shape(part, model) === 'liquid'" d="M0 -26 C-4 -15 -18 -2 -18 6 A18 17 0 0 0 18 6 C18 -2 4 -15 0 -26Z" fill="rgba(var(--v-theme-primary), .2)" stroke="rgb(var(--v-theme-primary))" />
        <g v-else-if="shape(part, model) === 'vial'"><path d="M-15 -48 H15 V-30 L29 -17 V38 Q29 49 0 49 Q-29 49 -29 38 V-17 L-15 -30Z" /><ellipse cy="-48" fill="rgba(var(--v-theme-on-surface), .2)" rx="15" ry="4" /></g>
        <g v-else-if="shape(part, model) === 'syringe'"><path d="M-26 -57 H26 V-50 H14 V40 L4 53 V63 H-4 V53 L-14 40 V-50 H-26Z" /><path d="M5 -35 H14 M5 -20 H14 M5 -5 H14 M5 10 H14 M5 25 H14" /></g>
        <g v-else-if="shape(part, model) === 'cartridge'"><path d="M-18 -55 H18 V40 L12 53 H-12 L-18 40Z" /><ellipse cy="-55" rx="18" ry="5" /></g>
        <g v-else><path d="M-21 -10 H21 V10 Q0 19 -21 10Z" /><ellipse cy="-10" fill="rgba(var(--v-theme-on-surface), .45)" rx="21" ry="6" /></g>
      </g>

      <path d="M45 0 H70 L82 -7 H100" fill="none" stroke="rgba(var(--v-theme-on-surface), .3)" />
      <text fill="currentColor" font-size="13" x="110" y="-5">{{ label(part.node).slice(0, 29) }}</text>
      <text fill="rgba(var(--v-theme-on-surface), .65)" font-size="12" x="110" y="16">{{ field(part.node, 'Quantity')?.value }} {{ field(part.node, 'QuantityUnit')?.value }}</text>
    </g>

    <line
      v-if="target >= 0"
      class="assembly-insertion"
      x1="12"
      x2="428"
      :y1="target * 145 + (edge === 'before' ? 15 : 155)"
      :y2="target * 145 + (edge === 'before' ? 15 : 155)"
    />
  </svg>
</template>

<script setup lang="ts">
  import type { Model, Part } from './model'
  import { assemblyParts, field, label, shape } from './model'
  const props = defineProps<{ model: Model, readonly: boolean }>()
  const emit = defineEmits<{ select: [part: Part], reorder: [source: Part, target: Part, position: 'before' | 'after'] }>()
  const svg = ref<SVGSVGElement>()
  const gesture = shallowRef<{ source: Part, x: number, y: number }>()
  const moved = ref(false)
  const target = ref(-1)
  const edge = ref<'before' | 'after'>('before')
  let suppressClick = false
  const items = computed(() => assemblyParts(props.model))
  function select (part: Part) {
    if (suppressClick) {
      suppressClick = false
      return
    }
    emit('select', part)
  }
  function begin (event: PointerEvent, part: Part) {
    suppressClick = false
    if (props.readonly || event.button !== 0) return
    gesture.value = { source: part, x: event.clientX, y: event.clientY }
    moved.value = false
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  }
  function movePointer (event: PointerEvent) {
    const active = gesture.value
    if (!active || !svg.value) return
    if (!moved.value && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 6) return
    moved.value = true
    event.preventDefault()
    const matrix = svg.value.getScreenCTM()
    if (!matrix) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const index = Math.max(0, Math.min(items.value.length - 1, Math.floor((point.y - 15) / 145)))
    edge.value = point.y < index * 145 + 85 ? 'before' : 'after'
    const candidate = items.value[index]
    target.value = candidate && candidate.path.slice(0, -1).join('.') === active.source.path.slice(0, -1).join('.') ? index : -1
  }
  function endPointer () {
    if (moved.value && gesture.value) {
      suppressClick = true
      const candidate = items.value[target.value]
      if (candidate) emit('reorder', gesture.value.source, candidate, edge.value)
    }
    cancelPointer()
  }
  function cancelPointer () {
    gesture.value = undefined
    moved.value = false
    target.value = -1
  }
</script>

<style scoped>
.assembly { display: block; background: rgb(var(--v-theme-surface)); width: 100%; max-width: 460px; max-height: 540px; margin: auto; }
[role="button"] { cursor: grab; touch-action: none; user-select: none; }
.assembly-insertion { stroke: rgb(var(--v-theme-primary)); stroke-width: 3; stroke-linecap: round; pointer-events: none; }
.assembly-dragging { opacity: .5; }
[role="button"]:focus { outline: 2px solid rgb(var(--v-theme-primary)); }
</style>
