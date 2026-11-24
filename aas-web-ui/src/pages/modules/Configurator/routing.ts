import type { Element, Model } from './model'
import { children, field, submodel } from './model'

// The planar controller's line mode (planar-controller/planar/lines.py): the xbots travel only on
// lanes, turn only on turn spots and wait in the idle area. A line keeps its routing as a parameter,
// the collection PlanarRouting, whose $value the controller reads at startup (LINE_LAYOUT):
//   PlanarRouting  Lanes [{ Name, OneWay, Points [point] }], TurnSpots [point], IdleArea [point]
//   a point        { X, Y } in mm
export const PARAMETERS_SEMANTIC = 'https://smartproductionlab.aau.dk/ARSO/Parameters/1/0/Submodel'
export const ROUTING = 'PlanarRouting'
export const ROUTING_SEMANTIC = 'https://smartproductionlab.aau.dk/semantics/PlanarRouting'
const LANE_SEMANTIC = `${ROUTING_SEMANTIC}/Lane`
const POINT_SEMANTIC = `${ROUTING_SEMANTIC}/Point`

export type Point = [number, number]
export interface Lane { name: string, points: Point[], oneWay: boolean }
export interface Routing { lanes: Lane[], turnSpots: Point[], idleArea: Point[] }
export interface Frame { columns: number, rows: number, flyway: number, slot: number, flyways: Set<string> }
export type Slot = [number, number]

export const emptyRouting = (): Routing => ({ lanes: [], turnSpots: [], idleArea: [] })

/** The routing a line keeps, or undefined (free routing); an error when what is kept is no routing. */
export function readRouting (system: Model): { routing?: Routing, error?: string } {
  const node = field(submodel(system, 'Parameters'), ROUTING)
  if (!node) {
    return {}
  }
  try {
    const legacy = field(node, 'Value')?.value
    if (typeof legacy === 'string') {
      return { routing: fromJson(legacy) }
    }
    const number = (value: unknown, what: string): number => {
      if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Number(value))) {
        throw new Error(`${what}: ${JSON.stringify(value)} is not a number in mm`)
      }
      return Number(value)
    }
    const points = (list: Element | undefined, what: string): Point[] =>
      children(list).map(p => [number(field(p, 'X')?.value, `${what} X`), number(field(p, 'Y')?.value, `${what} Y`)])
    const lanes = field(node, 'Lanes')
    if (!lanes) {
      throw new Error('no Lanes')
    }
    return { routing: {
      lanes: children(lanes).map((lane, i) => {
        const name = String(field(lane, 'Name')?.value || `Lane ${i + 1}`)
        return { name, points: points(field(lane, 'Points'), name), oneWay: field(lane, 'OneWay')?.value === 'true' }
      }),
      turnSpots: points(field(node, 'TurnSpots'), 'TurnSpots'),
      idleArea: points(field(node, 'IdleArea'), 'IdleArea'),
    } }
  } catch (error) {
    return { error: `${ROUTING} is not a routing the controller reads: ${error instanceof Error ? error.message : error}` }
  }
}

/** The routing's first form, the controller's JSON in a Value (saved again as the collection). */
function fromJson (value: string): Routing {
  const data = JSON.parse(value)
  const point = (p: unknown): Point => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(v => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error(`${JSON.stringify(p)} is not an [x, y] point`)
    }
    return [p[0], p[1]]
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.lanes)) {
    throw new Error('no lanes')
  }
  return {
    lanes: data.lanes.map((lane: any, i: number) => ({ name: String(lane.name ?? `Lane ${i + 1}`), points: (lane.points ?? []).map((p: unknown) => point(p)), oneWay: lane.oneWay === true })),
    turnSpots: (data.turnSpots ?? []).map((p: unknown) => point(p)),
    idleArea: (data.idleArea ?? []).map((p: unknown) => point(p)),
  }
}

const ref = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const text = (value: string) => [{ language: 'en', text: value }]
const property = (idShort: string, valueType: string, value: string): Element => ({ modelType: 'Property', idShort, valueType, value })
/** A list of collections, in order; its items have no idShort, an empty one no value (as the AAS has them). */
function list (idShort: string, itemSemantic: string, items: Element[], description: string): Element {
  return {
    modelType: 'SubmodelElementList',
    idShort,
    description: text(description),
    orderRelevant: true,
    semanticIdListElement: ref(itemSemantic),
    typeValueListElement: 'SubmodelElementCollection',
    ...(items.length > 0 ? { value: items } : {}),
  }
}
const point = (p: Point): Element => ({ modelType: 'SubmodelElementCollection', semanticId: ref(POINT_SEMANTIC), value: [property('X', 'xs:double', String(p[0])), property('Y', 'xs:double', String(p[1]))] })
const points = (idShort: string, values: Point[], description: string) => list(idShort, POINT_SEMANTIC, values.map(p => point(p)), `${description} Each point is an X and a Y in mm in the planar table's coordinates.`)

/** The routing as the collection PlanarRouting. */
export function routingCollection (routing: Routing): Element {
  const lanes = routing.lanes.map(lane => ({
    modelType: 'SubmodelElementCollection',
    semanticId: ref(LANE_SEMANTIC),
    value: [
      property('Name', 'xs:string', lane.name),
      property('OneWay', 'xs:boolean', String(lane.oneWay)),
      points('Points', lane.points, 'Slot centres the lane goes through, each stretch along a row or a column; a one-way lane is driven from the first to the last.'),
    ],
  }))
  return {
    modelType: 'SubmodelElementCollection',
    idShort: ROUTING,
    semanticId: ref(ROUTING_SEMANTIC),
    description: text('The planar table\'s routing in line mode: lanes, turn spots and the idle area. The planar controller reads its value (LINE_LAYOUT).'),
    value: [
      list('Lanes', LANE_SEMANTIC, lanes, 'The lanes the shuttles travel on.'),
      points('TurnSpots', routing.turnSpots, 'Where the shuttles turn: a flyway\'s centre, or where four flyways meet.'),
      points('IdleArea', routing.idleArea, 'The loading queue in order, its first point the loading position.'),
    ],
  }
}

/** Keep the routing in the line's Parameters (made when the line has none); undefined removes it. */
export function writeRouting (system: Model, routing: Routing | undefined): void {
  let parameters = submodel(system, 'Parameters')
  if (!routing) {
    if (parameters) {
      parameters.submodelElements = children(parameters).filter(node => node.idShort !== ROUTING)
    }
    return
  }
  if (!parameters) {
    parameters = { modelType: 'Submodel', id: `${system.shell.id}/submodels/Parameters`, idShort: 'Parameters', kind: 'Instance', semanticId: ref(PARAMETERS_SEMANTIC), submodelElements: [] }
    system.submodels.push(parameters)
    system.shell.submodels ??= []
    system.shell.submodels.push({ type: 'ModelReference', keys: [{ type: 'Submodel', value: parameters.id }] })
  }
  parameters.submodelElements = [...children(parameters).filter(node => node.idShort !== ROUTING), routingCollection(routing)]
}

/** Where the controller fetches the routing from (its LINE_LAYOUT): the collection's value in the repository. */
export function routingUrl (system: Model, submodelRepository: string): string | undefined {
  const parameters = submodel(system, 'Parameters')
  if (!parameters || !field(parameters, ROUTING) || !submodelRepository) {
    return
  }
  const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(parameters.id))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const base = submodelRepository.replace(/\/+$/, '').replace(/\/submodels$/, '')
  return `${base}/submodels/${encoded}/submodel-elements/${ROUTING}/$value`
}

// --- the table's slots -------------------------------------------------------------------------

export const key = (c: number, r: number): string => `${c},${r}`
export const slotCenter = (frame: Frame, slot: Slot): Point => [(slot[0] + 0.5) * frame.slot, (slot[1] + 0.5) * frame.slot]
export function hasSlot (frame: Frame, slot: Slot): boolean {
  const per = Math.round(frame.flyway / frame.slot)
  return slot[0] >= 0 && slot[1] >= 0 && frame.flyways.has(key(Math.floor(slot[0] / per), Math.floor(slot[1] / per)))
}
/** The slot whose centre this point is (within half a millimetre), or undefined. */
export function slotAt (frame: Frame, point: Point): Slot | undefined {
  const slot: Slot = [Math.floor(point[0] / frame.slot), Math.floor(point[1] / frame.slot)]
  const [x, y] = slotCenter(frame, slot)
  return Math.abs(point[0] - x) < 0.5 && Math.abs(point[1] - y) < 0.5 ? slot : undefined
}

/**
 * The point a shuttle turns on for this turn spot, as the controller takes it: where four flyways
 * meet, or a flyway's centre (another point in a flyway stands for its centre); undefined between
 * flyways or off them.
 */
export function spotOf (frame: Frame, point: Point): Point | undefined {
  const f = frame.flyway
  const onBorder = (v: number) => Math.abs(v - Math.round(v / f) * f) < 0.5
  if (onBorder(point[0]) && onBorder(point[1])) {
    const c = Math.round(point[0] / f), r = Math.round(point[1] / f)
    const four = [[c - 1, r - 1], [c, r - 1], [c - 1, r], [c, r]].every(([a, b]) => frame.flyways.has(key(a!, b!)))
    return four ? [c * f, r * f] : undefined
  }
  if (onBorder(point[0]) || onBorder(point[1])) {
    return undefined
  }
  const c = Math.floor(point[0] / f), r = Math.floor(point[1] / f)
  return frame.flyways.has(key(c, r)) ? [(c + 0.5) * f, (r + 0.5) * f] : undefined
}

/** The slots a turn on this spot sweeps: the square one flyway wide around it. */
export function spotSlots (frame: Frame, spot: Point): Slot[] {
  const half = frame.flyway / 2
  const out: Slot[] = []
  for (let c = Math.floor((spot[0] - half) / frame.slot); c * frame.slot < spot[0] + half; c++) {
    for (let r = Math.floor((spot[1] - half) / frame.slot); r * frame.slot < spot[1] + half; r++) {
      const [x, y] = slotCenter(frame, [c, r])
      if (Math.abs(x - spot[0]) < half && Math.abs(y - spot[1]) < half && hasSlot(frame, [c, r])) {
        out.push([c, r])
      }
    }
  }
  return out
}

/** The slots a line passes, in order, or why it cannot be driven. */
export function trace (frame: Frame, points: Point[]): { slots: Slot[], error?: string } {
  const mm = (p: Point) => `(${p[0]}, ${p[1]}) mm`
  const slots: Slot[] = []
  for (const point of points) {
    const slot = slotAt(frame, point)
    if (!slot || !hasSlot(frame, slot)) {
      return { slots, error: `${mm(point)} is not a slot centre on a flyway` }
    }
    const last = slots.at(-1)
    if (last && last[0] !== slot[0] && last[1] !== slot[1]) {
      return { slots, error: `from ${mm(slotCenter(frame, last))} to ${mm(point)} is not along a row or a column` }
    }
    while (last && (slots.at(-1)![0] !== slot[0] || slots.at(-1)![1] !== slot[1])) {
      const [c, r] = slots.at(-1)!
      const next: Slot = [c + Math.sign(slot[0] - c), r + Math.sign(slot[1] - r)]
      if (!hasSlot(frame, next)) {
        return { slots, error: `${mm(points[0]!)} … ${mm(point)} crosses a missing flyway` }
      }
      slots.push(next)
    }
    if (!last) {
      slots.push(slot)
    }
  }
  return { slots }
}

/** What keeps the controller from taking this routing on this table (as planar/lines.py checks it). */
export function problems (routing: Routing, frame: Frame, xbots = 0): string[] {
  const found: string[] = []
  const lanes = routing.lanes.map(lane => ({ lane, ...trace(frame, lane.points) }))
  if (lanes.length === 0) {
    found.push('Draw at least one lane.')
  }
  for (const { lane, slots, error } of lanes) {
    if (error) {
      found.push(`${lane.name}: ${error}.`)
    } else if (lane.points.length < 2 || slots.length < 2) {
      found.push(`${lane.name}: a lane needs at least two slots.`)
    }
  }
  const idle = trace(frame, routing.idleArea)
  if (idle.error) {
    found.push(`Idle area: ${idle.error}.`)
  } else if (new Set(idle.slots.map(s => key(...s))).size !== idle.slots.length) {
    found.push('Idle area: it passes a slot twice.')
  } else if (xbots > 0 && idle.slots.length < xbots) {
    found.push(`Idle area: ${idle.slots.length} slots for ${xbots} shuttles; free shuttles that do not fit wait on the lanes, in the way.`)
  }
  const laneSlots = new Set(lanes.flatMap(({ slots }) => slots.map(slot => key(...slot))))
  for (const point of routing.turnSpots) {
    const spot = spotOf(frame, point)
    if (!spot) {
      found.push(`Turn spot (${point[0]}, ${point[1]}) mm is neither a flyway's centre nor where four flyways meet.`)
    } else if (!spotSlots(frame, spot).some(slot => laneSlots.has(key(...slot)))) {
      found.push(`Turn spot (${point[0]}, ${point[1]}) mm has no lane slot under it: no shuttle gets there.`)
    }
  }
  if (found.length === 0) {
    // Every lane slot must lead to every other, along the lanes (one-way ones forward only).
    const next = new Map<string, Set<string>>()
    const edge = (a: Slot, b: Slot) => {
      if (!next.has(key(...a))) {
        next.set(key(...a), new Set())
      }
      next.get(key(...a))!.add(key(...b))
    }
    for (const { lane, slots } of lanes) {
      for (let i = 0; i + 1 < slots.length; i++) {
        edge(slots[i]!, slots[i + 1]!)
        if (!lane.oneWay) {
          edge(slots[i + 1]!, slots[i]!)
        }
      }
      for (const slot of slots) {
        if (!next.has(key(...slot))) {
          next.set(key(...slot), new Set())
        }
      }
    }
    const all = [...next.keys()]
    const reach = (from: string, edges: Map<string, Set<string>>) => {
      const seen = new Set([from]), queue = [from]
      while (queue.length > 0) {
        for (const to of edges.get(queue.shift()!) ?? []) {
          if (!seen.has(to)) {
            seen.add(to)
            queue.push(to)
          }
        }
      }
      return seen
    }
    const back = new Map<string, Set<string>>()
    for (const [from, tos] of next) {
      for (const to of tos) {
        back.set(to, (back.get(to) ?? new Set()).add(from))
      }
    }
    const first = all[0]!
    const missing = all.find(slot => !reach(first, next).has(slot) || !reach(first, back).has(slot))
    if (missing) {
      found.push(`The lanes do not lead from every lane slot to every other (slot ${missing}); mind the one-way lanes.`)
    }
  }
  return found
}
