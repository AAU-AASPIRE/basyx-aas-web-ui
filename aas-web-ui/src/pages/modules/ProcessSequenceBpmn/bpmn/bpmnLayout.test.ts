import type { PlanNode, StepNode } from '../../ProcessSequence/types/plan'
import type { AasElement } from '../../ProcessSequence/utils/sequenceModel'
import { describe, expect, it } from 'vitest'
import fixture from '../../ProcessSequence/skills/fixtures/fillingModule.json'
import { readFlow } from '../../ProcessSequence/skills/skillFlow'
import { flattenNodes, newBranch, newNode } from '../../ProcessSequence/utils/plan'
import { conditionalLaneId } from '../../ProcessSequence/utils/planGraph'
import { laneNodes, layoutBpmn } from './bpmnLayout'

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

describe('a flow in BPMN notation', () => {
  it('draws the Dispensing skill of the filling module as start, its four steps in order, end', () => {
    const flow = readFlow(skills, 'Dispensing', 'Start')
    const { shapes, flows } = layoutBpmn(flow)
    expect(shapes.map(shape => shape.kind)).toEqual(['start', 'task', 'task', 'task', 'task', 'end'])
    const tasks = shapes.filter(shape => shape.kind === 'task')
    expect(tasks.map(shape => shape.planId)).toEqual(flow.map(node => node.id))
    expect(tasks.every((shape, index) => index === 0 || shape.x > tasks[index - 1]!.x)).toBe(true)
    // One chain: each shape flows into the next, and every flow is a place to insert.
    expect(flows.map(item => [item.source, item.target])).toEqual(shapes.slice(0, -1).map((shape, index) => [shape.id, shapes[index + 1]!.id]))
    expect(flows.map(item => item.insert)).toEqual(flow.map((_, index) => ({ lane: 'root', index })).concat([{ lane: 'root', index: flow.length }]))
  })

  it('pairs every split with its join, right of it, and keeps branches on their own rows', () => {
    const sequence = nested()
    const { shapes } = layoutBpmn(sequence)
    const splits = shapes.filter(shape => shape.kind.endsWith('split'))
    expect(splits.map(shape => `${shape.kind}:${shape.planId}`)).toEqual(['and-split:Both', 'xor-split:Check', 'xor-split:Sometimes'])
    for (const split of splits) {
      const join = shapes.find(shape => shape.kind === split.kind.replace('split', 'join') && shape.planId === split.planId)!
      expect(join.x).toBeGreaterThan(split.x)
      expect(join.y).toBe(split.y)
    }
    // Every step is a task, and no two tasks overlap.
    const tasks = shapes.filter(shape => shape.kind === 'task')
    expect(tasks.map(shape => shape.planId).toSorted()).toEqual(flattenNodes(sequence).filter(node => node.kind === 'step').map(node => node.id).toSorted())
    for (const [index, a] of tasks.entries()) {
      for (const b of tasks.slice(index + 1)) {
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
      }
    }
  })

  it('labels the branches of an XOR split: the condition, and otherwise', () => {
    const { flows } = layoutBpmn(nested())
    const out = (id: string) => flows.filter(item => item.source === id)
    expect(out('split:Check').map(item => [item.label, !!item.otherwise])).toEqual([['Tare.Weight > 0.5 g', false], ['otherwise', true]])
    expect(out('split:Sometimes').map(item => [item.label, !!item.otherwise])).toEqual([['every 5th product', false], ['otherwise', true]])
    expect(out('split:Both').every(item => !item.label)).toBe(true)
  })

  it('inserts on a flow into the lane it is in, also into an empty branch; the skip of a conditional takes nothing', () => {
    const sequence = nested()
    const { flows, shapes } = layoutBpmn(sequence)
    const no = flows.find(item => item.source === 'split:Check' && item.otherwise)!
    expect(shapes.find(shape => shape.id === no.target)?.kind).toBe('point')
    expect(no.insert).toEqual({ lane: 'no', index: 0 })
    laneNodes(sequence, no.insert!.lane)!.splice(no.insert!.index, 0, step('Reject'))
    const decision = flattenNodes(sequence).find(node => node.id === 'Check')!
    expect(decision.kind === 'decision' && decision.branches[1].nodes.map(node => node.id)).toEqual(['Reject'])

    const skip = flows.find(item => item.source === 'split:Sometimes' && item.otherwise)!
    expect(skip.insert).toBeUndefined()
    const run = flows.find(item => item.source === 'split:Sometimes' && !item.otherwise)!
    expect(run.insert).toEqual({ lane: conditionalLaneId('Sometimes'), index: 0 })
    expect(laneNodes(sequence, run.insert!.lane)?.map(node => node.id)).toEqual(['Weigh'])
    expect(laneNodes(sequence, 'unknown')).toBeUndefined()
  })
})
