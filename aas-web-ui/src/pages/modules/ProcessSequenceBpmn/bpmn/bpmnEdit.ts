import type { Diagram, DiagramFlow, DiagramShape, Parsed, ShapeKind } from './bpmnDiagram'
import { v4 } from 'uuid'
import { isGateway, shapeSize } from './bpmnDiagram'
import { SIZE } from './bpmnLayout'

/**
 * The edits of the drawing. Each returns a new drawing and leaves the one it is given as it is (the
 * editor keeps the old ones to undo); none of them checks the flow: that is ``flowFromDiagram``'s.
 */

/** What is added at once: one shape, or a split and its join with two empty branches. */
export interface Fragment {
  shapes: DiagramShape[]
  flows: DiagramFlow[]
  /** The shape the flow goes into, and the one it comes out of. */
  entry: string
  exit: string
}

export const newShapeId = (): string => `shape:${v4()}`
const newFlowId = (): string => `flow:${v4()}`

/** A shape centred on ``(cx, cy)``. */
export function shapeFragment (id: string, kind: ShapeKind, cx: number, cy: number): Fragment {
  const size = shapeSize(kind)
  return { shapes: [{ id, kind, x: cx - size.w / 2, y: cy - size.h / 2 }], flows: [], entry: id, exit: id }
}

/**
 * A block: its split centred on ``(cx, cy)``, its join to the right, two empty branches, the second a
 * row below. ``branches``: their ids and names, if the block has them (a parallel block, a decision).
 */
export function blockFragment (split: string, join: string, kind: 'and' | 'xor', cx: number, cy: number, branches: { id: string, name: string }[] = []): Fragment {
  const size = SIZE.gateway
  const shapes: DiagramShape[] = [
    { id: split, kind, x: cx - size.w / 2, y: cy - size.h / 2 },
    { id: join, kind, x: cx + size.w / 2 + 2 * SIZE.gap + SIZE.empty, y: cy - size.h / 2 },
  ]
  const flows: DiagramFlow[] = [0, 1].map(index => ({
    id: newFlowId(), source: split, target: join, drop: index * SIZE.row,
    ...(branches[index] ? { branch: { ...branches[index] } } : {}),
    ...(kind === 'xor' ? { otherwise: index === 1 } : {}),
  }))
  return { shapes, flows, entry: split, exit: join }
}

/** Add shapes that are not wired yet. */
export function addFragment (diagram: Diagram, fragment: Fragment): Diagram {
  return { shapes: [...diagram.shapes, ...fragment.shapes], flows: [...diagram.flows, ...fragment.flows] }
}

/**
 * Put a fragment on a flow: the flow goes into the fragment, a new one from it on to where the flow
 * went. The flow keeps what it was (a branch, otherwise). Its shapes may be in the drawing already.
 */
export function insertOnFlow (diagram: Diagram, flowId: string, fragment: Fragment): Diagram {
  const flow = diagram.flows.find(item => item.id === flowId)
  if (!flow) {
    return diagram
  }
  const known = new Set(diagram.shapes.map(shape => shape.id))
  const into: DiagramFlow = { ...flow, target: fragment.entry }
  delete into.drop
  return {
    shapes: [...diagram.shapes, ...fragment.shapes.filter(shape => !known.has(shape.id))],
    flows: [
      ...diagram.flows.flatMap(item => item.id === flowId ? [into] : [item]),
      ...fragment.flows,
      { id: newFlowId(), source: fragment.exit, target: flow.target },
    ],
  }
}

/** Why a flow from ``source`` to ``target`` cannot be drawn; '' when it can. */
export function cannotConnect (diagram: Diagram, source: string, target: string): string {
  const from = diagram.shapes.find(shape => shape.id === source)
  const to = diagram.shapes.find(shape => shape.id === target)
  if (!from || !to) {
    return 'Wire a shape to a shape.'
  }
  if (source === target) {
    return 'A shape cannot lead into itself.'
  }
  if (from.kind === 'end') {
    return 'Nothing follows End.'
  }
  if (to.kind === 'start') {
    return 'Nothing leads into Start.'
  }
  // Between gateways a second flow is a second empty branch; elsewhere it would mean nothing more.
  if (!(isGateway(from.kind) && isGateway(to.kind)) && diagram.flows.some(flow => flow.source === source && flow.target === target)) {
    return 'These two are wired already.'
  }
  return ''
}

const centre = (shape: DiagramShape) => ({ x: shape.x + shapeSize(shape.kind).w / 2, y: shape.y + shapeSize(shape.kind).h / 2 })

/** How far below its split an empty branch runs: the first row that nothing between the two gateways uses. */
function freeRow (diagram: Diagram, source: DiagramShape, target: DiagramShape, flows: DiagramFlow[]): number {
  const from = centre(source)
  const to = centre(target)
  const used = [
    ...diagram.shapes.filter(shape => shape.id !== source.id && shape.id !== target.id && centre(shape).x > from.x && centre(shape).x < to.x).map(shape => centre(shape).y - from.y),
    ...flows.filter(flow => flow.source === source.id && flow.target === target.id).map(flow => flow.drop ?? 0),
  ]
  for (let row = 0; ; row++) {
    if (!used.some(y => Math.abs(y - row * SIZE.row) < SIZE.row / 2)) {
      return row * SIZE.row
    }
  }
}

/**
 * Wire ``source`` to ``target``. Out of a gateway the flow starts a branch of its own; out of an
 * exclusive gateway the second flow is its otherwise, unless one is already.
 */
export function connect (diagram: Diagram, source: string, target: string, keep?: Partial<DiagramFlow>): Diagram {
  if (cannotConnect(diagram, source, target)) {
    return diagram
  }
  const from = diagram.shapes.find(shape => shape.id === source)!
  const to = diagram.shapes.find(shape => shape.id === target)!
  const outs = diagram.flows.filter(flow => flow.source === source)
  const flow: DiagramFlow = { id: newFlowId(), source, target }
  if (isGateway(from.kind)) {
    flow.branch = { id: v4(), name: from.kind === 'xor' ? (outs.length === 0 ? 'Yes' : 'No') : `Branch ${outs.length + 1}` }
    if (from.kind === 'xor') {
      flow.otherwise = outs.length > 0 && !outs.some(item => item.otherwise)
    }
    if (isGateway(to.kind)) {
      flow.drop = freeRow(diagram, from, to, diagram.flows)
    }
  }
  return { ...diagram, flows: [...diagram.flows, { ...flow, ...keep }] }
}

/** Move one end of a flow to another shape; the flow keeps its branch if it still leaves the same shape. */
export function reconnect (diagram: Diagram, flowId: string, source: string, target: string): Diagram {
  const flow = diagram.flows.find(item => item.id === flowId)
  if (!flow) {
    return diagram
  }
  const without = { ...diagram, flows: diagram.flows.filter(item => item.id !== flowId) }
  if (cannotConnect(without, source, target)) {
    return diagram
  }
  const keep = source === flow.source ? { id: flow.id, branch: flow.branch, otherwise: flow.otherwise } : { id: flow.id }
  return connect(without, source, target, keep)
}

export function removeFlow (diagram: Diagram, flowId: string): Diagram {
  return { ...diagram, flows: diagram.flows.filter(flow => flow.id !== flowId) }
}

/**
 * The shapes a removal of ``ids`` takes: a gateway of a well-formed block takes the whole block, its
 * other gateway and what is in its branches. Start and End stay.
 */
export function removalOf (diagram: Diagram, ids: string[], parsed?: Parsed): Set<string> {
  const taken = new Set<string>()
  for (const id of ids) {
    const split = parsed?.blocks.has(id) ? id : [...(parsed?.blocks ?? [])].find(([, block]) => block.join === id)?.[0]
    const block = split ? parsed!.blocks.get(split) : undefined
    for (const item of block ? [split!, block.join, ...block.inner] : [id]) {
      taken.add(item)
    }
  }
  for (const shape of diagram.shapes) {
    if (shape.kind === 'start' || shape.kind === 'end') {
      taken.delete(shape.id)
    }
  }
  return taken
}

/**
 * Take shapes out. If one flow led into what is taken and one out of it, the two ends are wired
 * together, so that taking a step out of a line closes the line.
 */
export function removeShapes (diagram: Diagram, ids: Set<string>): Diagram {
  const entering = diagram.flows.filter(flow => !ids.has(flow.source) && ids.has(flow.target))
  const leaving = diagram.flows.filter(flow => ids.has(flow.source) && !ids.has(flow.target))
  const flows = diagram.flows.filter(flow => !ids.has(flow.source) && !ids.has(flow.target))
  const shapes = diagram.shapes.filter(shape => !ids.has(shape.id))
  if (entering.length === 1 && leaving.length === 1) {
    const healed: DiagramFlow = { ...entering[0]!, target: leaving[0]!.target }
    const from = shapes.find(shape => shape.id === healed.source)
    const to = shapes.find(shape => shape.id === healed.target)
    if (from && to && isGateway(from.kind) && isGateway(to.kind)) {
      healed.drop = freeRow({ shapes, flows }, from, to, flows)
    }
    if (!cannotConnect({ shapes, flows }, healed.source, healed.target)) {
      flows.push(healed)
    }
  }
  return { shapes, flows }
}

/**
 * Room for a fragment put on a flow, where shapes stay where they are put (no auto layout): the
 * fragment goes onto the flow's line just after where the flow starts, and the shapes from the flow's
 * target on move right as far as it needs.
 */
export function placeOnFlow (diagram: Diagram, flowId: string, fragment: Fragment): { diagram: Diagram, fragment: Fragment } {
  const flow = diagram.flows.find(item => item.id === flowId)
  const source = diagram.shapes.find(shape => shape.id === flow?.source)
  const target = diagram.shapes.find(shape => shape.id === flow?.target)
  const entry = fragment.shapes.find(shape => shape.id === fragment.entry)
  if (!flow || !source || !target || !entry) {
    return { diagram, fragment }
  }
  const from = centre(source)
  const to = centre(target)
  const y = flow.drop && isGateway(target.kind) ? from.y + flow.drop : (isGateway(source.kind) ? to.y : from.y)
  const left = Math.min(...fragment.shapes.map(shape => shape.x))
  const right = Math.max(...fragment.shapes.map(shape => shape.x + shapeSize(shape.kind).w))
  const x = (flow.drop || (isGateway(source.kind) && Math.abs(to.y - from.y) > 1) ? from.x : source.x + shapeSize(source.kind).w) + SIZE.gap
  const dx = x - left
  const dy = y - centre(entry).y
  const placed = { ...fragment, shapes: fragment.shapes.map(shape => ({ ...shape, x: shape.x + dx, y: shape.y + dy })) }
  const need = x + (right - left) + SIZE.gap - target.x
  const inside = new Set(fragment.shapes.map(shape => shape.id))
  const shapes = need > 0
    ? diagram.shapes.map(shape => !inside.has(shape.id) && shape.x >= target.x - 0.5 ? { ...shape, x: shape.x + need } : shape)
    : diagram.shapes
  return { diagram: { ...diagram, shapes }, fragment: placed }
}

/**
 * Take a shape out of where it is (closing the gap) and put it on a flow; ``place``: where shapes stay
 * where they are put, onto the flow's line, with room made for it.
 */
export function moveOntoFlow (diagram: Diagram, shapeId: string, flowId: string, place = false): Diagram {
  const flow = diagram.flows.find(item => item.id === flowId)
  const shape = diagram.shapes.find(item => item.id === shapeId)
  if (!flow || !shape || flow.source === shapeId || flow.target === shapeId) {
    return diagram
  }
  // The flow may have been the one that closed the gap; it is the same flow under the same id.
  const lifted = removeShapes(diagram, new Set([shapeId]))
  const single: Fragment = { shapes: [shape], flows: [], entry: shapeId, exit: shapeId }
  const room = place ? placeOnFlow(lifted, flowId, single) : { diagram: lifted, fragment: single }
  return insertOnFlow(room.diagram, flowId, room.fragment)
}

/** Make a flow out of an exclusive gateway its otherwise, and the other one the condition's. */
export function setOtherwise (diagram: Diagram, flowId: string): Diagram {
  const flow = diagram.flows.find(item => item.id === flowId)
  if (!flow) {
    return diagram
  }
  return { ...diagram, flows: diagram.flows.map(item => item.source === flow.source ? { ...item, otherwise: item.id === flowId } : item) }
}

/** Shapes moved to new places (a drag), by id. */
export function moveShapes (diagram: Diagram, moved: Map<string, { x: number, y: number }>): Diagram {
  return { ...diagram, shapes: diagram.shapes.map(shape => moved.has(shape.id) ? { ...shape, ...moved.get(shape.id)! } : shape) }
}
