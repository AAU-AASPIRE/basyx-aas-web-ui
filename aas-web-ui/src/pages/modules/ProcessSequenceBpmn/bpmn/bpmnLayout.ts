import type { PlanCondition, PlanNode } from '../../ProcessSequence/types/plan'
import { conditionalLaneId } from '../../ProcessSequence/utils/planGraph'

/**
 * A flow of the sequence editor (a plan's or a skill's steps) in BPMN notation: the shapes and
 * sequence flows of a BPMN process, laid out left to right. Only what the structured flow says is
 * drawn: a step is a task, a call a call activity, a parallel block a pair of AND gateways, a
 * decision and a conditional flow a pair of XOR gateways, each split with its own join. So every
 * diagram is a well-structured BPMN process, and nothing can be drawn that the flow cannot hold.
 *
 * A projection only, like ``buildPlanGraph``: nothing of it is saved; the plan or the skill's steps
 * stay the source. Used for the graph on screen (``bpmnGraph``) and the BPMN XML (``bpmnXml``).
 */
export type BpmnKind = 'start' | 'end' | 'task' | 'call' | 'and-split' | 'and-join' | 'xor-split' | 'xor-join' | 'point'

/** Where a step inserted on a sequence flow goes: position ``index`` of the lane ``lane``. */
export interface Insertion {
  /** 'root', a branch's id, or ``conditionalLaneId`` of a conditional flow. */
  lane: string
  index: number
}

export interface BpmnShape {
  id: string
  kind: BpmnKind
  /** Top left corner and size, in px. */
  x: number
  y: number
  w: number
  h: number
  title: string
  /** The plan node the shape stands for: a step, or a block for its gateways. */
  planId?: string
}

export interface BpmnFlow {
  id: string
  source: string
  target: string
  /** The branch's condition, on the flow out of an XOR split. */
  label?: string
  /** Not taken unless the other branches' conditions fail (a decision's No, a conditional's skip). */
  otherwise?: boolean
  /** Where a step goes when inserted on this flow; none on a conditional flow's skip. */
  insert?: Insertion
}

export interface BpmnLayout {
  shapes: BpmnShape[]
  flows: BpmnFlow[]
}

export const SIZE = {
  task: { w: 160, h: 76 },
  call: { w: 160, h: 76 },
  gateway: { w: 44, h: 44 },
  event: { w: 36, h: 36 },
  point: { w: 2, h: 2 },
  /** Between two shapes of a lane, and the height of one row of branches. */
  gap: 56,
  row: 112,
  /** The length of an empty branch. */
  empty: 48,
}

const OPERATORS = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' }

/** A condition in words, short enough for a flow's label. */
export function conditionText (condition: PlanCondition): string {
  if ('conditions' in condition) {
    return condition.conditions.map(rule => conditionText(rule)).join(condition.kind === 'all' ? ' and ' : ' or ')
  }
  if (condition.kind === 'everyNthProduct') {
    return `every ${condition.every}th product`
  }
  const operand = condition.operand
  const what = operand ? (operand.kind === 'output' ? `${operand.stepId}.${operand.outputId}` : operand.source.path.at(-1) ?? '…') : '…'
  return `${what} ${OPERATORS[condition.operator]} ${condition.expected.value}${condition.unit ? ` ${condition.unit}` : ''}`
}

type Branch = { key?: string, nodes: PlanNode[], label?: string, otherwise?: boolean }

/** The branches of a block, as drawn: a conditional flow is a branch that runs and one that is skipped. */
function branchesOf (node: Exclude<PlanNode, { kind: 'step' | 'call' }>): Branch[] {
  switch (node.kind) {
    case 'parallel': {
      return node.branches.map(branch => ({ key: branch.id, nodes: branch.nodes }))
    }
    case 'decision': {
      return [
        { key: node.branches[0].id, nodes: node.branches[0].nodes, label: conditionText(node.condition) },
        { key: node.branches[1].id, nodes: node.branches[1].nodes, label: 'otherwise', otherwise: true },
      ]
    }
    default: {
      return [
        { key: conditionalLaneId(node.id), nodes: node.nodes, label: conditionText(node.condition) },
        { nodes: [], label: 'otherwise', otherwise: true },
      ]
    }
  }
}

const isBlock = (node: PlanNode): node is Exclude<PlanNode, { kind: 'step' | 'call' }> => node.kind !== 'step' && node.kind !== 'call'

function laneWidth (nodes: PlanNode[]): number {
  if (nodes.length === 0) {
    return SIZE.empty
  }
  return nodes.reduce((sum, node) => sum + width(node), 0) + SIZE.gap * (nodes.length - 1)
}

function width (node: PlanNode): number {
  if (!isBlock(node)) {
    return SIZE.task.w
  }
  return 2 * SIZE.gateway.w + 2 * SIZE.gap + Math.max(...branchesOf(node).map(branch => laneWidth(branch.nodes)))
}

/** How many rows a lane or a node takes: its line and the rows of other branches below it. */
function laneRows (nodes: PlanNode[]): number {
  return Math.max(1, ...nodes.map(node => rows(node)))
}

function rows (node: PlanNode): number {
  return isBlock(node) ? branchesOf(node).reduce((sum, branch) => sum + laneRows(branch.nodes), 0) : 1
}

export function layoutBpmn (sequence: PlanNode[]): BpmnLayout {
  const shapes: BpmnShape[] = []
  const flows: BpmnFlow[] = []

  function shape (id: string, kind: BpmnKind, x: number, cy: number, title: string, planId?: string): string {
    const size = { task: SIZE.task, call: SIZE.call, start: SIZE.event, end: SIZE.event, point: SIZE.point }[kind as 'task'] ?? SIZE.gateway
    shapes.push({ id, kind, x, y: cy - size.h / 2, w: size.w, h: size.h, title, planId })
    return id
  }

  function flow (source: string, target: string, extra: Omit<BpmnFlow, 'id' | 'source' | 'target'> = {}): void {
    flows.push({ id: `flow:${source}->${target}`, source, target, ...extra })
  }

  /** The nodes of a lane from ``x`` on, on the line ``cy``; returns the last shape and the x after it. */
  function lane (nodes: PlanNode[], key: string | undefined, x: number, cy: number, entry: string, first: Omit<BpmnFlow, 'id' | 'source' | 'target'>): string {
    let last = entry
    for (const [index, node] of nodes.entries()) {
      const into = index === 0 ? first : {}
      const placed = item(node, x, cy)
      flow(last, placed.in, { ...into, ...(key ? { insert: { lane: key, index } } : {}) })
      last = placed.out
      x += width(node) + SIZE.gap
    }
    return last
  }

  function item (node: PlanNode, x: number, cy: number): { in: string, out: string } {
    if (!isBlock(node)) {
      const id = shape(`node:${node.id}`, node.kind === 'call' ? 'call' : 'task', x, cy, node.name, node.id)
      return { in: id, out: id }
    }
    const kind = node.kind === 'parallel' ? 'and' : 'xor'
    const split = shape(`split:${node.id}`, `${kind}-split`, x, cy, node.name, node.id)
    const joinX = x + width(node) - SIZE.gateway.w
    const join = shape(`join:${node.id}`, `${kind}-join`, joinX, cy, node.name, node.id)
    // The first branch goes on along the line (a decision's yes); the others below it, each on rows of its own.
    let below = 0
    for (const [index, branch] of branchesOf(node).entries()) {
      const branchY = cy + below * SIZE.row
      below += laneRows(branch.nodes)
      const start = x + SIZE.gateway.w + SIZE.gap
      const first = { label: branch.label, otherwise: branch.otherwise }
      if (branch.nodes.length === 0) {
        // An empty branch passes a point on its own row, so its flow is drawn there, not across the others.
        const point = shape(`point:${node.id}:${index}`, 'point', start + SIZE.empty / 2, branchY, '')
        const insert = branch.key ? { insert: { lane: branch.key, index: 0 } } : {}
        flow(split, point, { ...first, ...insert })
        flow(point, join, insert)
        continue
      }
      const last = lane(branch.nodes, branch.key, start, branchY, split, first)
      flow(last, join, branch.key ? { insert: { lane: branch.key, index: branch.nodes.length } } : {})
    }
    return { in: split, out: join }
  }

  const start = shape('start', 'start', 0, 0, 'Start')
  const x = SIZE.event.w + SIZE.gap
  const last = lane(sequence, 'root', x, 0, start, {})
  const end = shape('end', 'end', x + (sequence.length > 0 ? laneWidth(sequence) + SIZE.gap : 0), 0, 'End')
  flow(last, end, { insert: { lane: 'root', index: sequence.length } })
  return { shapes, flows }
}

/** The nodes of a lane named by an ``Insertion``, to insert into. */
export function laneNodes (sequence: PlanNode[], key: string): PlanNode[] | undefined {
  if (key === 'root') {
    return sequence
  }
  for (const node of sequence) {
    if (node.kind === 'conditional') {
      if (conditionalLaneId(node.id) === key) {
        return node.nodes
      }
      const found = laneNodes(node.nodes, key)
      if (found) {
        return found
      }
    }
    if (node.kind === 'parallel' || node.kind === 'decision') {
      for (const branch of node.branches) {
        if (branch.id === key) {
          return branch.nodes
        }
        const found = laneNodes(branch.nodes, key)
        if (found) {
          return found
        }
      }
    }
  }
}
