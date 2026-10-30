import type { PlanBranch, PlanNode } from '../../ProcessSequence/types/plan'
import { layoutBpmn, SIZE } from './bpmnLayout'

/**
 * A flow as it is drawn: shapes where the user put them, sequence flows between them as the user
 * wired them. Drawn freely, it holds more than a flow can (a loop, a split that is never joined), so
 * ``flowFromDiagram`` reads it back into the structured flow, or says what keeps it from being one.
 * The structured flow stays what is saved: the drawing is kept on screen only.
 *
 * A task's or a call's shape stands for a step or a call of the flow, a gateway that splits for its
 * block; the ``Registry`` holds them by shape id. A join stands for nothing of its own: it closes the
 * block of the split whose branches meet there.
 */
export type ShapeKind = 'start' | 'end' | 'task' | 'call' | 'and' | 'xor'

export interface DiagramShape {
  id: string
  kind: ShapeKind
  /** Top left corner, in px. */
  x: number
  y: number
}

export interface DiagramFlow {
  id: string
  source: string
  target: string
  /** Out of an exclusive gateway: taken when the condition fails (BPMN's default flow). */
  otherwise?: boolean
  /** Out of a gateway: the branch it starts, so that a branch keeps its id and name. */
  branch?: { id: string, name: string }
  /** From a split straight to its join (an empty branch): how far below the split it runs, in px. */
  drop?: number
}

export interface Diagram {
  shapes: DiagramShape[]
  flows: DiagramFlow[]
}

export type Registry = Map<string, PlanNode>

export interface DiagramIssue {
  text: string
  /** The shapes it is about, to mark and to show. */
  shapes: string[]
}

export interface Parsed {
  /** The structured flow; none while there are issues. */
  nodes?: PlanNode[]
  issues: DiagramIssue[]
  /** A well-formed block by its split: its join, and the shapes between them. */
  blocks: Map<string, { join: string, inner: string[] }>
  /** The flows out of a split, in the order of the block's branches. */
  branchFlows: Map<string, string[]>
  /** The blocks as read, by their split: new objects, for the registry once the flow is taken. */
  made: Map<string, PlanNode>
}

export function shapeSize (kind: ShapeKind): { w: number, h: number } {
  if (kind === 'task' || kind === 'call') {
    return SIZE.task
  }
  if (kind === 'start' || kind === 'end') {
    return SIZE.event
  }
  return SIZE.gateway
}

export const isGateway = (kind: ShapeKind): boolean => kind === 'and' || kind === 'xor'
const centreY = (shape: DiagramShape): number => shape.y + shapeSize(shape.kind).h / 2

type Block = Exclude<PlanNode, { kind: 'step' | 'call' }>

/** A block's branches in drawing order: a decision's yes, then otherwise; a conditional flow's steps, then its skip. */
function branchesOf (node: Block): { branch?: PlanBranch, nodes: PlanNode[], otherwise?: boolean }[] {
  switch (node.kind) {
    case 'parallel': {
      return node.branches.map(branch => ({ branch, nodes: branch.nodes }))
    }
    case 'decision': {
      return [{ branch: node.branches[0], nodes: node.branches[0].nodes }, { branch: node.branches[1], nodes: node.branches[1].nodes, otherwise: true }]
    }
    default: {
      return [{ nodes: node.nodes }, { nodes: [], otherwise: true }]
    }
  }
}

/** The flow drawn as ``layoutBpmn`` lays it out, with the registry of what each shape stands for. */
export function diagramFromFlow (sequence: PlanNode[]): { diagram: Diagram, registry: Registry } {
  const at = new Map(layoutBpmn(sequence).shapes.map(shape => [shape.id, shape]))
  const shapes: DiagramShape[] = []
  const flows: DiagramFlow[] = []
  const registry: Registry = new Map()

  function place (id: string, kind: ShapeKind, node?: PlanNode): string {
    const laid = at.get(id)!
    shapes.push({ id, kind, x: laid.x, y: laid.y })
    if (node) {
      registry.set(id, toRaw(node))
    }
    return id
  }

  function flow (source: string, target: string, extra: Partial<DiagramFlow> = {}): void {
    let id = `flow:${source}->${target}`
    for (let n = 2; flows.some(item => item.id === id); n++) {
      id = `flow:${source}->${target}:${n}`
    }
    flows.push({ id, source, target, ...extra })
  }

  function item (node: PlanNode): { in: string, out: string } {
    if (node.kind === 'step' || node.kind === 'call') {
      const id = place(`node:${node.id}`, node.kind === 'call' ? 'call' : 'task', node)
      return { in: id, out: id }
    }
    const kind = node.kind === 'parallel' ? 'and' : 'xor'
    const split = place(`split:${node.id}`, kind, node)
    const join = place(`join:${node.id}`, kind)
    for (const [index, branch] of branchesOf(node).entries()) {
      const first: Partial<DiagramFlow> = {
        ...(branch.branch ? { branch: { id: branch.branch.id, name: branch.branch.name } } : {}),
        ...(kind === 'xor' ? { otherwise: !!branch.otherwise } : {}),
      }
      if (branch.nodes.length === 0) {
        const point = at.get(`point:${node.id}:${index}`)!
        flow(split, join, { ...first, drop: point.y + point.h / 2 - centreY(shapes.find(shape => shape.id === split)!) })
        continue
      }
      let last = split
      for (const inner of branch.nodes) {
        const placed = item(inner)
        flow(last, placed.in, last === split ? first : {})
        last = placed.out
      }
      flow(last, join)
    }
    return { in: split, out: join }
  }

  let last = place('start', 'start')
  for (const node of sequence) {
    const placed = item(node)
    flow(last, placed.in)
    last = placed.out
  }
  flow(last, place('end', 'end'))
  return { diagram: { shapes, flows }, registry }
}

class Unstructured extends Error {
  constructor (public issue: DiagramIssue) {
    super(issue.text)
  }
}

/** A shape in words, for an issue. */
export function shapeName (shape: DiagramShape | undefined, registry: Registry): string {
  if (!shape) {
    return 'a shape'
  }
  if (shape.kind === 'start') {
    return 'Start'
  }
  if (shape.kind === 'end') {
    return 'End'
  }
  const node = registry.get(shape.id)
  if (shape.kind === 'task' || shape.kind === 'call') {
    return node?.name || 'a step'
  }
  return `the ${shape.kind === 'and' ? 'parallel' : 'exclusive'} gateway${node ? ` ${node.name}` : ''}`
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * What each gateway does, by how many flows lead in and out (a split: one in, several out; a join: several
 * in, one out), and the issues of shapes wired in a way no flow is: a task with two ways out, a loose shape.
 */
function roles (diagram: Diagram, into: Map<string, DiagramFlow[]>, out: Map<string, DiagramFlow[]>, name: (id: string) => string, issue: (text: string, ...ids: string[]) => void): Map<string, 'split' | 'join'> {
  const role = new Map<string, 'split' | 'join'>()
  for (const shape of diagram.shapes) {
    const ins = into.get(shape.id)!.length
    const outs = out.get(shape.id)!.length
    const what = name(shape.id)
    if (shape.kind === 'start') {
      if (outs === 0) {
        issue('Start leads nowhere: wire it to the first step.', shape.id)
      }
      if (outs > 1) {
        issue('Start leads to one shape: split after it with a gateway.', shape.id)
      }
      continue
    }
    if (shape.kind === 'end') {
      if (ins === 0) {
        issue('Nothing leads to End: wire the last step to it.', shape.id)
      }
      if (ins > 1) {
        issue(`${ins} flows end in End: join them with a gateway first.`, shape.id)
      }
      continue
    }
    if (ins === 0 && outs === 0) {
      issue(`${capital(what)} is not connected: drop it onto an arrow, or wire it.`, shape.id)
      continue
    }
    if (ins === 0) {
      issue(`Nothing leads into ${what}.`, shape.id)
    }
    if (outs === 0) {
      issue(`${capital(what)} leads nowhere: wire it on.`, shape.id)
    }
    if (ins === 0 || outs === 0) {
      continue
    }
    if (shape.kind === 'task' || shape.kind === 'call') {
      if (ins > 1) {
        issue(`${ins} flows lead into ${what}: join them with a gateway first.`, shape.id)
      }
      if (outs > 1) {
        issue(`${capital(what)} has ${outs} ways out: split with a gateway.`, shape.id)
      }
      continue
    }
    if (ins === 1 && outs === 1) {
      issue(`${capital(what)} neither splits nor joins: give it a second way out, or a second way in.`, shape.id)
    } else if (ins > 1 && outs > 1) {
      issue(`${capital(what)} both joins and splits: use one gateway for each.`, shape.id)
    } else if (outs > 1) {
      role.set(shape.id, 'split')
      if (shape.kind === 'xor') {
        const otherwise = out.get(shape.id)!.filter(flow => flow.otherwise).length
        if (outs > 2) {
          issue(`${capital(what)} has ${outs} ways out: an exclusive gateway chooses between two, the condition and otherwise.`, shape.id)
        } else if (otherwise !== 1) {
          issue(`Mark one of the two flows out of ${what} as otherwise.`, shape.id)
        }
      }
    } else {
      role.set(shape.id, 'join')
    }
  }
  return role
}

/**
 * The structured flow the drawing stands for, or what keeps it from being one: a flow runs once from
 * Start to End; a task has one way in and one way out; a gateway either splits (one in, several out)
 * or joins (several in, one out); the branches of a split meet at one join of its kind and nothing
 * else enters there; an exclusive gateway splits in two, the condition and otherwise.
 *
 * A split's block keeps what it has (name, condition, ids) and takes its branches from the drawing. An
 * exclusive split whose otherwise is empty stays a conditional flow (run or skip) if it was one; with
 * steps on its otherwise it becomes a decision, its condition kept.
 */
export function flowFromDiagram (diagram: Diagram, registry: Registry): Parsed {
  const issues: DiagramIssue[] = []
  const blocks = new Map<string, { join: string, inner: string[] }>()
  const branchFlows = new Map<string, string[]>()
  const made = new Map<string, PlanNode>()
  const result: Parsed = { issues, blocks, branchFlows, made }
  const shapes = new Map(diagram.shapes.map(shape => [shape.id, shape]))
  const out = new Map(diagram.shapes.map(shape => [shape.id, [] as DiagramFlow[]]))
  const into = new Map(diagram.shapes.map(shape => [shape.id, [] as DiagramFlow[]]))
  for (const flow of diagram.flows) {
    if (shapes.has(flow.source) && shapes.has(flow.target)) {
      out.get(flow.source)!.push(flow)
      into.get(flow.target)!.push(flow)
    }
  }
  const name = (id: string): string => shapeName(shapes.get(id), registry)
  const issue = (text: string, ...ids: string[]): void => {
    issues.push({ text, shapes: ids })
  }

  const role = roles(diagram, into, out, name, issue)
  if (issues.length > 0) {
    return result
  }

  const seen = new Set<string>()

  function lane (first: string): { nodes: PlanNode[], end: string, inner: string[] } {
    const nodes: PlanNode[] = []
    const inner: string[] = []
    let at = first
    for (;;) {
      const shape = shapes.get(at)!
      if (shape.kind === 'end' || role.get(at) === 'join') {
        return { nodes, end: at, inner }
      }
      if (seen.has(at)) {
        throw new Unstructured({ text: `The flow comes back to ${name(at)}: a flow runs once from Start to End, without loops.`, shapes: [at] })
      }
      seen.add(at)
      inner.push(at)
      if (shape.kind === 'task' || shape.kind === 'call') {
        nodes.push(registry.get(at)!)
        at = out.get(at)![0]!.target
        continue
      }
      const block = split(at)
      nodes.push(block.node)
      inner.push(...block.inner, block.join)
      at = out.get(block.join)![0]!.target
    }
  }

  function split (id: string): { node: PlanNode, join: string, inner: string[] } {
    const flows = out.get(id)!
    const lanes = flows.map(flow => ({ flow, ...lane(flow.target) }))
    const ends = [...new Set(lanes.map(item => item.end))]
    const join = ends[0]!
    if (ends.length > 1 || shapes.get(join)!.kind === 'end') {
      throw new Unstructured({ text: `The branches of ${name(id)} do not meet again at one gateway: join them before the flow goes on.`, shapes: [id, ...ends.filter(end => end !== 'end')] })
    }
    if (into.get(join)!.length !== flows.length) {
      throw new Unstructured({ text: `Flows from outside ${name(id)} lead into the gateway that joins its branches.`, shapes: [id, join] })
    }
    const kind = shapes.get(id)!.kind
    if (shapes.get(join)!.kind !== kind) {
      throw new Unstructured({ text: `${capital(name(id))} is joined by a gateway of the other kind: a parallel split by a parallel join, an exclusive one by an exclusive join.`, shapes: [id, join] })
    }
    seen.add(join)
    const base = registry.get(id) as Block
    const branch = (item: typeof lanes[number], index: number, fallback: string): PlanBranch => ({
      id: item.flow.branch?.id ?? `${base.id}-${index + 1}`, name: item.flow.branch?.name ?? fallback, nodes: item.nodes,
    })
    let node: Block
    if (kind === 'and') {
      // Top to bottom: the first branch is the one on the line.
      const y = (item: typeof lanes[number]): number => item.nodes.length > 0 ? centreY(shapes.get(item.inner[0]!)!) : centreY(shapes.get(id)!) + (item.flow.drop ?? 0)
      const sorted = lanes.map((item, index) => ({ item, index, y: y(item) })).toSorted((a, b) => a.y - b.y || a.index - b.index).map(entry => entry.item)
      node = { id: base.id, kind: 'parallel', name: base.name, branches: sorted.map((item, index) => branch(item, index, `Branch ${index + 1}`)) }
      branchFlows.set(id, sorted.map(item => item.flow.id))
    } else {
      const yes = lanes.find(item => !item.flow.otherwise)!
      const no = lanes.find(item => item.flow.otherwise)!
      const condition = base.kind === 'parallel' ? { kind: 'everyNthProduct' as const, every: 5 } : base.condition
      if (no.nodes.length === 0 && base.kind === 'conditional') {
        node = { ...base, nodes: yes.nodes }
      } else {
        const before = base.kind === 'decision' ? base.branches : undefined
        node = {
          id: base.id, kind: 'decision', name: base.name, condition,
          branches: [branch(yes, 0, before?.[0].name ?? 'Yes'), branch(no, 1, before?.[1].name ?? 'No')],
        }
      }
      branchFlows.set(id, [yes.flow.id, no.flow.id])
    }
    made.set(id, node)
    blocks.set(id, { join, inner: lanes.flatMap(item => item.inner) })
    return { node, join, inner: lanes.flatMap(item => item.inner) }
  }

  try {
    const start = diagram.shapes.find(shape => shape.kind === 'start')!
    const top = lane(out.get(start.id)![0]!.target)
    if (shapes.get(top.end)!.kind !== 'end') {
      throw new Unstructured({ text: `${capital(name(top.end))} joins flows that were not split by one gateway.`, shapes: [top.end] })
    }
    const loose = diagram.shapes.filter(shape => !seen.has(shape.id) && shape.kind !== 'start' && shape.kind !== 'end')
    for (const shape of loose) {
      issue(`${capital(name(shape.id))} is not on the way from Start to End.`, shape.id)
    }
    if (loose.length === 0) {
      result.nodes = top.nodes
    }
  } catch (error) {
    if (!(error instanceof Unstructured)) {
      throw error
    }
    issues.push(error.issue)
  }
  return result
}

/** The drawing laid out as ``layoutBpmn`` lays out the flow it stands for: what Auto layout does. */
export function laidOut (diagram: Diagram, registry: Registry, parsed: Parsed): Diagram {
  if (!parsed.nodes) {
    return diagram
  }
  const at = new Map(layoutBpmn(parsed.nodes).shapes.map(shape => [shape.id, shape]))
  const splitOf = new Map([...parsed.blocks].map(([split, block]) => [block.join, split]))
  const block = (split: string): PlanNode | undefined => parsed.made.get(split) ?? registry.get(split)
  function laidId (shape: DiagramShape): string {
    if (shape.kind === 'start' || shape.kind === 'end') {
      return shape.kind
    }
    if (shape.kind === 'task' || shape.kind === 'call') {
      return `node:${registry.get(shape.id)?.id}`
    }
    const split = splitOf.get(shape.id)
    return split ? `join:${block(split)?.id}` : `split:${block(shape.id)?.id}`
  }
  const shapes = diagram.shapes.map(shape => {
    const laid = at.get(laidId(shape))
    return laid ? { ...shape, x: laid.x, y: laid.y } : shape
  })
  const flows = diagram.flows.map(flow => {
    const index = parsed.branchFlows.get(flow.source)?.indexOf(flow.id) ?? -1
    if (index < 0 || parsed.blocks.get(flow.source)?.join !== flow.target) {
      return flow
    }
    const id = block(flow.source)?.id
    const point = at.get(`point:${id}:${index}`)
    const split = at.get(`split:${id}`)
    return point && split ? { ...flow, drop: point.y + point.h / 2 - (split.y + split.h / 2) } : flow
  })
  return { shapes, flows }
}

const identities = new WeakMap<object, number>()
let nextIdentity = 1
function identity (node: PlanNode): number {
  const raw = toRaw(node)
  if (!identities.has(raw)) {
    identities.set(raw, nextIdentity++)
  }
  return identities.get(raw)!
}

/**
 * The structure of a flow: which steps and blocks, in which branches. Not what they are named or
 * handed: a changed structure is redrawn, a renamed step only relabelled.
 */
export function structureKey (nodes: PlanNode[]): string {
  return nodes.map(node => {
    switch (node.kind) {
      case 'step':
      case 'call': {
        return `${identity(node)}`
      }
      case 'conditional': {
        return `${identity(node)}c(${structureKey(node.nodes)})`
      }
      default: {
        return `${identity(node)}${node.kind[0]}(${node.branches.map(branch => `${branch.id}:${structureKey(branch.nodes)}`).join('|')})`
      }
    }
  }).join(',')
}
