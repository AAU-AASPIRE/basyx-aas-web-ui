import type { BpmnKind, BpmnLayout, Insertion } from './bpmnLayout'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'

export interface BpmnNodeData {
  kind: BpmnKind
  title: string
  planId?: string
  w: number
  h: number
  /** A task's lines under its name: what it runs and what it is handed. */
  lines: string[]
  /** A step's task that runs a skill, or a call: it opens that skill, or the called sequence. */
  linked: boolean
}

export interface BpmnEdgeData {
  insert?: Insertion
}

const sameInsertion = (a?: Insertion | null, b?: Insertion | null): boolean => !!a && !!b && a.lane === b.lane && a.index === b.index

/**
 * The layout as Vue Flow nodes and edges. ``lines`` and ``linked`` say what a step's task shows; the
 * flow ``insertion`` names, where the next step goes, is drawn highlighted.
 */
export function bpmnGraph (layout: BpmnLayout, insertion: Insertion | null, lines: (planId: string) => string[] = () => [], linked: (planId: string) => boolean = () => false): { nodes: Node<BpmnNodeData>[], edges: Edge<BpmnEdgeData>[] } {
  const kinds = new Map(layout.shapes.map(shape => [shape.id, shape.kind]))
  return {
    nodes: layout.shapes.map(shape => ({
      id: shape.id, type: 'bpmn', position: { x: shape.x, y: shape.y },
      data: {
        kind: shape.kind, title: shape.title, planId: shape.planId, w: shape.w, h: shape.h,
        lines: shape.planId && (shape.kind === 'task' || shape.kind === 'call') ? lines(shape.planId) : [],
        linked: !!shape.planId && (shape.kind === 'task' || shape.kind === 'call') && linked(shape.planId),
      },
    })),
    edges: layout.flows.map(flow => {
      const chosen = sameInsertion(flow.insert, insertion)
      return {
        id: flow.id, source: flow.source, target: flow.target, sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep',
        label: flow.label, data: { insert: flow.insert },
        // Into an empty branch's point the flow goes on: the arrow is at the join.
        markerEnd: kinds.get(flow.target) === 'point' ? undefined : MarkerType.ArrowClosed,
        labelStyle: flow.otherwise ? { fontStyle: 'italic' } : undefined,
        labelBgStyle: { fill: 'rgb(var(--v-theme-surface))' },
        class: flow.insert ? 'bpmn-flow bpmn-flow--insertable' : 'bpmn-flow',
        style: { stroke: chosen ? 'rgb(var(--v-theme-primary))' : '#455a64', strokeWidth: chosen ? 3 : 1.5 },
        interactionWidth: 24,
      }
    }),
  }
}
