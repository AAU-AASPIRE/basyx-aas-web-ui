import type { PlanNode, StepNode } from '../../ProcessSequence/types/plan'
import type { Diagram } from './bpmnDiagram'
import { describe, expect, it } from 'vitest'
import { newNode } from '../../ProcessSequence/utils/plan'
import { diagramFromFlow, flowFromDiagram } from './bpmnDiagram'
import { addFragment, blockFragment, cannotConnect, connect, insertOnFlow, moveOntoFlow, placeOnFlow, reconnect, removalOf, removeShapes, setOtherwise, shapeFragment } from './bpmnEdit'
import { route } from './bpmnRoute'

function step (name: string): StepNode {
  return { ...(newNode('step') as StepNode), id: name, name }
}

function names (nodes: PlanNode[] | undefined): unknown[] {
  return (nodes ?? []).map(node => {
    if (node.kind === 'step' || node.kind === 'call') {
      return node.name
    }
    if (node.kind === 'conditional') {
      return { [node.kind]: names(node.nodes) }
    }
    return { [node.kind]: node.branches.map(branch => names(branch.nodes)) }
  })
}

const into = (diagram: Diagram, target: string): string => diagram.flows.find(flow => flow.target === target)!.id

describe('editing the drawing', () => {
  it('inserts a step dropped on a flow, and closes the gap when it is removed', () => {
    const { diagram, registry } = diagramFromFlow([step('A'), step('B')])
    registry.set('c', step('C'))
    const inserted = insertOnFlow(diagram, into(diagram, 'node:B'), shapeFragment('c', 'task', 0, 0))
    expect(names(flowFromDiagram(inserted, registry).nodes)).toEqual(['A', 'C', 'B'])
    const removed = removeShapes(inserted, new Set(['node:A']))
    expect(names(flowFromDiagram(removed, registry).nodes)).toEqual(['C', 'B'])
  })

  it('drops a parallel block as a split, its join and two empty branches', () => {
    const { diagram, registry } = diagramFromFlow([step('A')])
    const block = newNode('parallel')
    registry.set('s', block)
    const branches = block.kind === 'parallel' ? block.branches.map(branch => ({ id: branch.id, name: branch.name })) : []
    const next = insertOnFlow(diagram, into(diagram, 'end'), blockFragment('s', 'j', 'and', 0, 0, branches))
    const parsed = flowFromDiagram(next, registry)
    expect(parsed.issues).toEqual([])
    expect(names(parsed.nodes)).toEqual(['A', { parallel: [[], []] }])
    expect(parsed.nodes![1]).toMatchObject({ id: block.id, branches: [{ id: branches[0]!.id }, { id: branches[1]!.id }] })
  })

  it('takes a step placed freely into the flow once it is wired', () => {
    const { diagram, registry } = diagramFromFlow([step('A')])
    registry.set('x', step('X'))
    let next = addFragment(diagram, shapeFragment('x', 'task', 400, 300))
    expect(flowFromDiagram(next, registry).nodes).toBeUndefined()
    // Rewire A's flow to End into X, then X to End.
    next = reconnect(next, into(next, 'end'), 'node:A', 'x')
    next = connect(next, 'x', 'end')
    expect(names(flowFromDiagram(next, registry).nodes)).toEqual(['A', 'X'])
  })

  it('wires a decision by hand: the second flow out of an exclusive gateway is its otherwise', () => {
    const { diagram, registry } = diagramFromFlow([step('A')])
    registry.set('split', newNode('decision'))
    registry.set('join', newNode('decision'))
    registry.set('yes', step('Yes'))
    registry.set('no', step('No'))
    let next: Diagram = {
      shapes: [...diagram.shapes, ...['split', 'join'].map(id => ({ id, kind: 'xor' as const, x: 0, y: 0 })), ...['yes', 'no'].map(id => ({ id, kind: 'task' as const, x: 0, y: 0 }))],
      flows: diagram.flows.filter(flow => flow.target !== 'end'),
    }
    for (const [source, target] of [['node:A', 'split'], ['split', 'yes'], ['split', 'no'], ['yes', 'join'], ['no', 'join'], ['join', 'end']]) {
      next = connect(next, source!, target!)
    }
    const parsed = flowFromDiagram(next, registry)
    expect(parsed.issues).toEqual([])
    expect(names(parsed.nodes)).toEqual(['A', { decision: [['Yes'], ['No']] }])
    // Swapped: the other branch is taken when the condition fails.
    const swapped = setOtherwise(next, next.flows.find(flow => flow.source === 'split' && flow.target === 'yes')!.id)
    expect(names(flowFromDiagram(swapped, registry).nodes)).toEqual(['A', { decision: [['No'], ['Yes']] }])
  })

  it('moves a step dragged onto a flow out of its place and into the branch', () => {
    const block = newNode('parallel')
    const flow: PlanNode[] = [step('A'), block]
    const { diagram, registry } = diagramFromFlow(flow)
    const branch = diagram.flows.find(item => item.source === `split:${block.id}`)!.id
    const moved = moveOntoFlow(diagram, 'node:A', branch)
    expect(names(flowFromDiagram(moved, registry).nodes)).toEqual([{ parallel: [['A'], []] }])
  })

  it('removes a block with what is in it, by either gateway', () => {
    const block = newNode('decision')
    if (block.kind === 'decision') {
      block.branches[0].nodes.push(step('Inside'))
    }
    const { diagram, registry } = diagramFromFlow([step('A'), block, step('B')])
    const parsed = flowFromDiagram(diagram, registry)
    const taken = removalOf(diagram, [`join:${block.id}`], parsed)
    expect([...taken].toSorted()).toEqual([`join:${block.id}`, 'node:Inside', `split:${block.id}`])
    expect(names(flowFromDiagram(removeShapes(diagram, taken), registry).nodes)).toEqual(['A', 'B'])
    expect(removalOf(diagram, ['start'], parsed).size).toBe(0)
  })

  it('makes room on the line for what snaps onto a flow, where shapes stay where they are put', () => {
    const { diagram } = diagramFromFlow([step('A'), step('B')])
    const a = diagram.shapes.find(shape => shape.id === 'node:A')!
    const b = diagram.shapes.find(shape => shape.id === 'node:B')!
    const room = placeOnFlow(diagram, into(diagram, 'node:B'), shapeFragment('c', 'task', -500, 900))
    const c = room.fragment.shapes[0]!
    // On A's line, right after it, and B (and End) moved right past it.
    expect([c.x, c.y]).toEqual([a.x + 160 + 56, a.y])
    const moved = room.diagram.shapes.find(shape => shape.id === 'node:B')!
    expect(moved.x).toBe(c.x + 160 + 56)
    expect(moved.x).toBeGreaterThan(b.x)
    expect(room.diagram.shapes.find(shape => shape.id === 'node:A')!.x).toBe(a.x)
  })

  it('refuses a flow that means nothing', () => {
    const { diagram } = diagramFromFlow([step('A')])
    expect(cannotConnect(diagram, 'node:A', 'node:A')).toBe('A shape cannot lead into itself.')
    expect(cannotConnect(diagram, 'end', 'node:A')).toBe('Nothing follows End.')
    expect(cannotConnect(diagram, 'node:A', 'start')).toBe('Nothing leads into Start.')
    expect(cannotConnect(diagram, 'start', 'node:A')).toBe('These two are wired already.')
  })
})

describe('routing a flow', () => {
  const box = (x: number, y: number, w = 100, h = 40) => ({ x, y, w, h })

  it('runs straight between shapes on one line', () => {
    expect(route(box(0, 0), box(200, 0), 'task', 'task').points).toEqual([[100, 20], [200, 20]])
  })

  it('leaves a split from its bottom corner for a branch below', () => {
    expect(route(box(0, 0, 44, 44), box(100, 100), 'and', 'task').points).toEqual([[22, 44], [22, 120], [100, 120]])
  })

  it('runs an empty branch below, from corner to corner', () => {
    expect(route(box(0, 0, 44, 44), box(300, 0, 44, 44), 'xor', 'xor', 112).points).toEqual([[22, 44], [22, 134], [322, 134], [322, 44]])
  })

  it('goes round below when the flow leads back left', () => {
    const { points } = route(box(300, 0), box(0, 0), 'task', 'task')
    expect(points[0]).toEqual([400, 20])
    expect(points.at(-1)).toEqual([0, 20])
    expect(Math.max(...points.map(point => point[1]))).toBeGreaterThan(40)
  })
})
