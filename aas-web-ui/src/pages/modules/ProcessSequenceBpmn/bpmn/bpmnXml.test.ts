import type { PlanNode, StepNode } from '../../ProcessSequence/types/plan'
import { describe, expect, it } from 'vitest'
import { newBranch, newNode } from '../../ProcessSequence/utils/plan'
import { bpmnXml, SP } from './bpmnXml'

// The namespaces of BPMN 2.0 are names, not addresses: http is part of them.
// eslint-disable-next-line unicorn/prefer-https
const MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
// eslint-disable-next-line unicorn/prefer-https
const DI = 'http://www.omg.org/spec/BPMN/20100524/DI'
// eslint-disable-next-line unicorn/prefer-https
const DD = 'http://www.omg.org/spec/DD/20100524/DI'

function step (name: string, skillId = ''): StepNode {
  return { ...(newNode('step') as StepNode), id: name, name, skillId }
}

const flow: PlanNode[] = [
  step('NeedleDown', 'MoveAxis'),
  {
    id: 'Both', kind: 'parallel', name: 'Both', branches: [
      { ...newBranch('Pump'), nodes: [step('Dispense', 'Dispense')] },
      { ...newBranch('Scale'), nodes: [step('Tare', 'Tare')] },
    ],
  },
  {
    id: 'Check', kind: 'decision', name: 'Check & <weigh>',
    condition: { kind: 'comparison', operand: { kind: 'output', stepId: 'Tare', outputId: 'Weight' }, operator: 'lt', expected: { type: 'number', value: 2 }, unit: '' },
    branches: [{ ...newBranch('Yes'), nodes: [step('TopUp', 'Dispense')] }, { ...newBranch('No'), nodes: [] }],
  },
  { id: 'call-1', kind: 'call', name: 'Inspect', scopeId: 'inspection' },
]

function parse (xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  expect(document.querySelectorAll('parsererror')).toHaveLength(0)
  return document
}
const all = (document: Document, namespace: string, name: string) => [...document.getElementsByTagNameNS(namespace, name)]

describe('a flow as a BPMN 2.0 file', () => {
  const xml = bpmnXml(flow, 'Dispensing', node => ({ properties: { skill: node.kind === 'step' ? node.skillId : '' } }))
  const document = parse(xml)

  it('is a process that describes, with BPMN elements for steps, blocks and calls', () => {
    const process = all(document, MODEL, 'process')
    expect(process).toHaveLength(1)
    expect(process[0]!.getAttribute('isExecutable')).toBe('false')
    expect(process[0]!.getAttribute('name')).toBe('Dispensing')
    expect(all(document, MODEL, 'startEvent')).toHaveLength(1)
    expect(all(document, MODEL, 'endEvent')).toHaveLength(1)
    expect(all(document, MODEL, 'serviceTask').map(task => task.getAttribute('name'))).toEqual(['NeedleDown', 'Dispense', 'Tare', 'TopUp'])
    expect(all(document, MODEL, 'parallelGateway').map(gateway => gateway.getAttribute('gatewayDirection'))).toEqual(['Diverging', 'Converging'])
    expect(all(document, MODEL, 'exclusiveGateway')).toHaveLength(2)
    expect(all(document, MODEL, 'callActivity')[0]?.getAttribute('calledElement')).toBe('inspection')
    // The skill a step runs, in our namespace.
    expect(all(document, SP, 'property').map(item => `${item.getAttribute('name')}=${item.getAttribute('value')}`)).toContain('skill=MoveAxis')
  })

  it('makes a decision\'s otherwise its default flow, and its condition a condition expression', () => {
    const split = all(document, MODEL, 'exclusiveGateway').find(gateway => gateway.getAttribute('gatewayDirection') === 'Diverging')!
    const flows = all(document, MODEL, 'sequenceFlow').filter(item => item.getAttribute('sourceRef') === split.getAttribute('id'))
    expect(flows).toHaveLength(2)
    const otherwise = flows.find(item => item.getAttribute('name') === 'otherwise')!
    expect(split.getAttribute('default')).toBe(otherwise.getAttribute('id'))
    // The empty No branch goes straight to the join: the drawing's point is not a BPMN element.
    expect(otherwise.getAttribute('targetRef')).toBe(all(document, MODEL, 'exclusiveGateway').find(gateway => gateway.getAttribute('gatewayDirection') === 'Converging')!.getAttribute('id'))
    const condition = flows.find(item => item !== otherwise)!
    expect(condition.getElementsByTagNameNS(MODEL, 'conditionExpression')[0]?.textContent).toBe('Tare.Weight < 2')
  })

  it('refers only to elements it has, with unique ids, and draws every element and flow', () => {
    const ids = [...document.querySelectorAll('[id]')].map(element => element.getAttribute('id')!)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => /^[A-Z_][\w.-]*$/i.test(id))).toBe(true)
    const nodes = new Set(['startEvent', 'endEvent', 'serviceTask', 'callActivity', 'parallelGateway', 'exclusiveGateway']
      .flatMap(name => all(document, MODEL, name).map(element => element.getAttribute('id'))))
    const flows = all(document, MODEL, 'sequenceFlow')
    for (const item of flows) {
      expect(nodes.has(item.getAttribute('sourceRef'))).toBe(true)
      expect(nodes.has(item.getAttribute('targetRef'))).toBe(true)
    }
    const drawn = new Set(all(document, DI, 'BPMNShape').map(shape => shape.getAttribute('bpmnElement')))
    expect([...nodes].every(id => drawn.has(id))).toBe(true)
    const edges = all(document, DI, 'BPMNEdge')
    expect(edges.map(edge => edge.getAttribute('bpmnElement')).toSorted()).toEqual(flows.map(item => item.getAttribute('id')).toSorted())
    expect(edges.every(edge => edge.getElementsByTagNameNS(DD, 'waypoint').length >= 2)).toBe(true)
  })

  it('escapes names', () => {
    expect(xml).toContain('name="Check &amp; &lt;weigh&gt;"')
  })
})
