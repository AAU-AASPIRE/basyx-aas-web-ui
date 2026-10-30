import type { PlanNode, StepNode } from '../../ProcessSequence/types/plan'
import type { AasElement } from '../../ProcessSequence/utils/sequenceModel'
import type { Diagram } from './bpmnDiagram'
import { describe, expect, it } from 'vitest'
import fixture from '../../ProcessSequence/skills/fixtures/fillingModule.json'
import { readFlow } from '../../ProcessSequence/skills/skillFlow'
import { newBranch, newNode } from '../../ProcessSequence/utils/plan'
import { diagramFromFlow, flowFromDiagram, laidOut, structureKey } from './bpmnDiagram'
import { layoutBpmn } from './bpmnLayout'

const skills = (fixture.submodels as AasElement[]).find(model => model.id === 'https://smartproductionlab.aau.dk/aas/FillingModuleAAS/submodels/Skills')!

function step (name: string): StepNode {
  return { ...(newNode('step') as StepNode), id: name, name }
}

/** A parallel block whose second branch holds a decision with an empty No, then a conditional flow. */
function nested (): PlanNode[] {
  return [
    step('NeedleDown'),
    {
      id: 'Both', kind: 'parallel', name: 'Both', branches: [
        { ...newBranch('Pump'), id: 'pump', nodes: [step('Dispense')] },
        { ...newBranch('Scale'), id: 'scale', nodes: [step('Tare'), {
          id: 'Check', kind: 'decision', name: 'Check',
          condition: { kind: 'comparison', operand: { kind: 'output', stepId: 'Tare', outputId: 'Weight' }, operator: 'gt', expected: { type: 'number', value: 0.5 }, unit: 'g' },
          branches: [{ ...newBranch('Yes'), id: 'yes', nodes: [step('Retare')] }, { ...newBranch('No'), id: 'no', nodes: [] }],
        }] },
      ],
    },
    { id: 'Sometimes', kind: 'conditional', name: 'Sometimes', condition: { kind: 'everyNthProduct', every: 5 }, nodes: [step('Weigh')] },
  ]
}

const flowBetween = (diagram: Diagram, source: string, target: string) => diagram.flows.find(flow => flow.source === source && flow.target === target)!

describe('a flow drawn and read back', () => {
  it('reads the Dispensing skill of the filling module back as it was', () => {
    const flow = readFlow(skills, 'Dispensing', 'Start')
    const { diagram, registry } = diagramFromFlow(flow)
    const parsed = flowFromDiagram(diagram, registry)
    expect(parsed.issues).toEqual([])
    expect(parsed.nodes).toEqual(flow)
    // The steps are the same objects: what the inspector edits is what is drawn.
    expect(parsed.nodes![0]).toBe(flow[0])
  })

  it('reads nested blocks back with their names, conditions and branch ids', () => {
    const flow = nested()
    const { diagram, registry } = diagramFromFlow(flow)
    const parsed = flowFromDiagram(diagram, registry)
    expect(parsed.issues).toEqual([])
    expect(parsed.nodes).toEqual(flow)
    expect(structureKey(parsed.nodes!)).not.toBe('')
  })

  it('draws a block as a split, its join, and an empty branch straight between them a row below', () => {
    const { diagram } = diagramFromFlow(nested())
    expect(diagram.shapes.filter(shape => shape.kind === 'and')).toHaveLength(2)
    const empty = flowBetween(diagram, 'split:Check', 'join:Check')
    expect(empty).toMatchObject({ otherwise: true, branch: { id: 'no', name: 'No' } })
    expect(empty.drop).toBeGreaterThan(0)
    expect(flowBetween(diagram, 'split:Sometimes', 'join:Sometimes').otherwise).toBe(true)
  })

  it('lays the drawing out as the flow is laid out', () => {
    const flow = nested()
    const { diagram, registry } = diagramFromFlow(flow)
    const moved: Diagram = { ...diagram, shapes: diagram.shapes.map(shape => ({ ...shape, x: shape.x + 37, y: shape.y - 11 })) }
    const laid = laidOut(moved, registry, flowFromDiagram(moved, registry))
    const at = new Map(layoutBpmn(flow).shapes.map(shape => [shape.id, shape]))
    for (const shape of laid.shapes) {
      expect([shape.x, shape.y]).toEqual([at.get(shape.id)!.x, at.get(shape.id)!.y])
    }
  })

  it('keeps the structure key of a renamed step, not of a moved one', () => {
    const flow = nested()
    const key = structureKey(flow)
    flow[0]!.name = 'Lower'
    expect(structureKey(flow)).toBe(key)
    expect(structureKey(flow.toReversed())).not.toBe(key)
  })
})

describe('the validator', () => {
  const drawn = () => diagramFromFlow([step('A'), step('B')])

  it('names a shape that is not wired', () => {
    const { diagram, registry } = drawn()
    registry.set('loose', step('C'))
    const parsed = flowFromDiagram({ ...diagram, shapes: [...diagram.shapes, { id: 'loose', kind: 'task', x: 0, y: 200 }] }, registry)
    expect(parsed.nodes).toBeUndefined()
    expect(parsed.issues).toEqual([{ text: 'C is not connected: drop it onto an arrow, or wire it.', shapes: ['loose'] }])
  })

  it('wants a gateway to split a task\'s second way out', () => {
    const { diagram, registry } = drawn()
    const parsed = flowFromDiagram({ ...diagram, flows: [...diagram.flows, { id: 'extra', source: 'node:A', target: 'end' }] }, registry)
    expect(parsed.issues.map(issue => issue.text)).toEqual(['A has 2 ways out: split with a gateway.', '2 flows end in End: join them with a gateway first.'])
  })

  it('finds a loop', () => {
    const { diagram, registry } = diagramFromFlow([step('A'), step('B'), step('C')])
    registry.set('g1', newNode('parallel'))
    registry.set('g2', newNode('parallel'))
    // Start -> join g1 -> A -> B -> split g2 -> (C -> End, back to g1)
    const looped: Diagram = {
      shapes: [...diagram.shapes, { id: 'g1', kind: 'and', x: 0, y: 0 }, { id: 'g2', kind: 'and', x: 0, y: 0 }],
      flows: [
        { id: 'f1', source: 'start', target: 'g1' }, { id: 'f2', source: 'g1', target: 'node:A' }, { id: 'f3', source: 'node:A', target: 'node:B' },
        { id: 'f4', source: 'node:B', target: 'g2' }, { id: 'f5', source: 'g2', target: 'node:C' }, { id: 'f6', source: 'node:C', target: 'end' },
        { id: 'f7', source: 'g2', target: 'g1' },
      ],
    }
    const parsed = flowFromDiagram(looped, registry)
    expect(parsed.nodes).toBeUndefined()
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]!.shapes).toContain('g1')
  })

  it('wants the branches of a split to meet at one join of its kind', () => {
    const { diagram, registry } = diagramFromFlow(nested())
    const crossed: Diagram = { ...diagram, shapes: diagram.shapes.map(shape => shape.id === 'join:Both' ? { ...shape, kind: 'xor' } : shape) }
    expect(flowFromDiagram(crossed, registry).issues[0]!.text).toMatch(/joined by a gateway of the other kind/)
  })

  it('wants one of an exclusive split\'s two flows marked otherwise', () => {
    const { diagram, registry } = diagramFromFlow(nested())
    const unmarked: Diagram = { ...diagram, flows: diagram.flows.map(flow => flow.source === 'split:Check' ? { ...flow, otherwise: false } : flow) }
    expect(flowFromDiagram(unmarked, registry).issues[0]!.text).toBe('Mark one of the two flows out of the exclusive gateway Check as otherwise.')
  })

  it('turns a conditional flow with steps on its otherwise into a decision, its condition kept', () => {
    const flow = nested()
    const { diagram, registry } = diagramFromFlow(flow)
    registry.set('else', step('Else'))
    const skip = flowBetween(diagram, 'split:Sometimes', 'join:Sometimes')
    const withElse: Diagram = {
      shapes: [...diagram.shapes, { id: 'else', kind: 'task', x: 0, y: 0 }],
      flows: [...diagram.flows.filter(item => item !== skip), { ...skip, target: 'else' }, { id: 'back', source: 'else', target: 'join:Sometimes' }],
    }
    const parsed = flowFromDiagram(withElse, registry)
    expect(parsed.issues).toEqual([])
    const made = parsed.nodes!.at(-1)!
    expect(made).toMatchObject({ id: 'Sometimes', kind: 'decision', condition: { kind: 'everyNthProduct', every: 5 } })
    expect(made.kind === 'decision' && made.branches.map(branch => branch.nodes.map(node => node.id))).toEqual([['Weigh'], ['Else']])
  })
})
