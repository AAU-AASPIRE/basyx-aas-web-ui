import type { ShapeKind } from './bpmnDiagram'
import { isGateway } from './bpmnDiagram'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Route {
  points: [number, number][]
  /** The SVG path, its corners rounded. */
  path: string
  /** Where a label goes: just after the flow leaves its shape, above the line. */
  labelX: number
  labelY: number
  /** BPMN's mark of a default flow: a short slash across it near its start. */
  slash: string
}

const GAP = 18
const RADIUS = 8

/**
 * A sequence flow as orthogonal lines, as BPMN diagrams draw them: out of a shape's right side into
 * the next one's left; out of a split's top or bottom corner and along to a branch on another row;
 * into a join's corner likewise. ``drop``: a split's empty branch, run that far below the split.
 */
export function route (source: Box, target: Box, from: ShapeKind, to: ShapeKind, drop?: number): Route {
  const sx = source.x + source.w
  const sy = source.y + source.h / 2
  const scx = source.x + source.w / 2
  const tx = target.x
  const ty = target.y + target.h / 2
  const tcx = target.x + target.w / 2
  let points: [number, number][]
  if (drop && isGateway(from) && isGateway(to)) {
    const level = sy + drop
    points = [[scx, sy + Math.sign(drop) * source.h / 2], [scx, level], [tcx, level], [tcx, ty + (level > ty ? target.h / 2 : -target.h / 2)]]
  } else if (Math.abs(ty - sy) < 1 && tx >= sx) {
    points = [[sx, sy], [tx, ty]]
  } else if (isGateway(from) && tx > scx + GAP) {
    points = [[scx, sy + (ty > sy ? source.h / 2 : -source.h / 2)], [scx, ty], [tx, ty]]
  } else if (isGateway(to) && tcx > sx + GAP) {
    points = [[sx, sy], [tcx, sy], [tcx, ty + (sy > ty ? target.h / 2 : -target.h / 2)]]
  } else if (tx >= sx + 2 * GAP) {
    const mx = Math.round((sx + tx) / 2)
    points = [[sx, sy], [mx, sy], [mx, ty], [tx, ty]]
  } else {
    // Back to the left: round below both shapes.
    const below = Math.max(source.y + source.h, target.y + target.h) + GAP + 6
    points = [[sx, sy], [sx + GAP, sy], [sx + GAP, below], [tx - GAP, below], [tx - GAP, ty], [tx, ty]]
  }
  points = points.filter((point, index) => index === 0 || point[0] !== points[index - 1]![0] || point[1] !== points[index - 1]![1])
  return { points, path: rounded(points), ...label(points), slash: slash(points) }
}

function rounded (points: [number, number][]): string {
  const [first, ...rest] = points
  let path = `M ${first![0]} ${first![1]}`
  for (const [index, point] of rest.entries()) {
    const next = rest[index + 1]
    if (!next) {
      path += ` L ${point[0]} ${point[1]}`
      break
    }
    const previous = index === 0 ? first! : rest[index - 1]!
    const radius = Math.min(RADIUS, distance(previous, point) / 2, distance(point, next) / 2)
    const before = towards(point, previous, radius)
    const after = towards(point, next, radius)
    path += ` L ${before[0]} ${before[1]} Q ${point[0]} ${point[1]} ${after[0]} ${after[1]}`
  }
  return path
}

const distance = (a: [number, number], b: [number, number]): number => Math.hypot(b[0] - a[0], b[1] - a[1])

function towards (from: [number, number], to: [number, number], length: number): [number, number] {
  const total = distance(from, to) || 1
  return [from[0] + (to[0] - from[0]) * length / total, from[1] + (to[1] - from[1]) * length / total]
}

/** After the first bend if the flow turns at once (out of a gateway's corner), else just after its start. */
function label (points: [number, number][]): { labelX: number, labelY: number } {
  const [a, b] = points
  if (a![0] === b![0] && points.length > 2) {
    return { labelX: b![0] + 10, labelY: b![1] - 4 }
  }
  return { labelX: a![0] + 8, labelY: a![1] - 4 }
}

function slash (points: [number, number][]): string {
  const [a, b] = points
  const length = distance(a!, b!) || 1
  const d = [(b![0] - a![0]) / length, (b![1] - a![1]) / length]
  const n = [-d[1]!, d[0]!]
  const c = [a![0] + d[0]! * 10, a![1] + d[1]! * 10]
  return `M ${c[0]! - n[0]! * 5 - d[0]! * 3} ${c[1]! - n[1]! * 5 - d[1]! * 3} L ${c[0]! + n[0]! * 5 + d[0]! * 3} ${c[1]! + n[1]! * 5 + d[1]! * 3}`
}
