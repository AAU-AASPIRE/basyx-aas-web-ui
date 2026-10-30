import type { Diagram, ShapeKind } from './bpmnDiagram'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'
import { shapeSize } from './bpmnDiagram'
import { route } from './bpmnRoute'

export interface BpmnNodeData {
  kind: ShapeKind
  w: number
  h: number
  /** A task's name; a split's block name, under the gateway; Start and End under theirs. */
  title: string
  /** A task's lines under its name: what it runs and what it is handed. */
  lines: string[]
  /** A step's task that runs a skill, or a call: it opens that skill, or the called sequence. */
  linked: boolean
  /** A step that runs nothing yet: no skill, or no process step. */
  empty: boolean
  selected: boolean
  /** What is wrong with it, from the validator. */
  issue: string
  /** Something dragged would go after it, if dropped. */
  target: boolean
}

export interface BpmnEdgeData {
  path: string
  labelX: number
  labelY: number
  label: string
  otherwise: boolean
  slash: string
  state: 'normal' | 'selected' | 'target'
}

export interface ShapeInfo {
  title: string
  lines: string[]
  linked: boolean
  empty: boolean
  /** The label on a flow out of an exclusive gateway that is not its otherwise: the condition. */
  condition?: string
}

export interface GraphState {
  selectedShapes: Set<string>
  selectedFlow: string
  /** The flow or the shape something dragged would go onto. */
  target: string
  issues: Map<string, string>
}

const NORMAL = '#546e7a'

/**
 * The drawing as Vue Flow nodes and edges, each flow routed between its shapes as they are now.
 * ``accent``: the colour of a selected flow's arrowhead (an SVG marker takes no CSS variable).
 */
export function bpmnGraph (diagram: Diagram, info: (id: string, kind: ShapeKind) => ShapeInfo, state: GraphState, accent = '#1976d2'): { nodes: Node<BpmnNodeData>[], edges: Edge<BpmnEdgeData>[] } {
  const shapes = new Map(diagram.shapes.map(shape => [shape.id, shape]))
  const infos = new Map(diagram.shapes.map(shape => [shape.id, info(shape.id, shape.kind)]))
  return {
    nodes: diagram.shapes.map(shape => {
      const size = shapeSize(shape.kind)
      const about = infos.get(shape.id)!
      return {
        id: shape.id, type: 'bpmn', position: { x: shape.x, y: shape.y },
        // Start and End stay: the flow is between them.
        deletable: false, connectable: true,
        data: {
          kind: shape.kind, w: size.w, h: size.h, title: about.title, lines: about.lines, linked: about.linked, empty: about.empty,
          selected: state.selectedShapes.has(shape.id), issue: state.issues.get(shape.id) ?? '', target: state.target === shape.id,
        },
      }
    }),
    edges: diagram.flows.filter(flow => shapes.has(flow.source) && shapes.has(flow.target)).map(flow => {
      const source = shapes.get(flow.source)!
      const target = shapes.get(flow.target)!
      const way = route({ ...source, ...shapeSize(source.kind) }, { ...target, ...shapeSize(target.kind) }, source.kind, target.kind, flow.drop)
      const stateOf = state.target === flow.id ? 'target' : (state.selectedFlow === flow.id ? 'selected' : 'normal')
      const label = source.kind === 'xor' ? (flow.otherwise ? 'otherwise' : (infos.get(flow.source)!.condition ?? '')) : ''
      return {
        id: flow.id, source: flow.source, target: flow.target, sourceHandle: 'out', targetHandle: 'in', type: 'bpmn',
        markerEnd: { type: MarkerType.ArrowClosed, color: stateOf === 'normal' ? NORMAL : accent, width: 18, height: 18 },
        data: { path: way.path, labelX: way.labelX, labelY: way.labelY, label, otherwise: source.kind === 'xor' && !!flow.otherwise, slash: way.slash, state: stateOf },
        interactionWidth: 22,
      }
    }),
  }
}
