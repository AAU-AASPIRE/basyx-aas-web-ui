import type { PlanNode } from '../../ProcessSequence/types/plan'
import type { BpmnFlow, BpmnShape } from './bpmnLayout'
import { flattenNodes } from '../../ProcessSequence/utils/plan'
import { layoutBpmn, SIZE } from './bpmnLayout'

/**
 * A flow as a BPMN 2.0 file (OMG BPMN 2.0.2 XML with its diagram), for other BPMN tools (bpmn.io,
 * Camunda Modeler) to show. It describes; it is not for an engine to run (isExecutable false): a
 * module's skill runs in its control program and a plan is carried out by the line's agents.
 *
 * A step is a service task, a call a call activity; a parallel block an AND gateway pair, a decision
 * or a conditional flow an XOR gateway pair whose "otherwise" branch is the split's default flow.
 * What the flow states beyond BPMN (the skill a step runs, what it is handed) is in each task's
 * extension elements, in the namespace ``SP``.
 */
export const SP = 'https://smartproductionlab.aau.dk/bpmn/1/0'

/** What a step says beyond its name: shown as extension properties, and as its documentation. */
export type TaskDetails = (node: PlanNode) => { documentation?: string, properties?: Record<string, string> }

function escape (text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

/** An XML id (an NCName) for an id of the layout. */
const xmlId = (id: string): string => id.replaceAll(/[^\w.-]/g, '_')

const ELEMENT: Record<Exclude<BpmnShape['kind'], 'point'>, string> = {
  'start': 'startEvent', 'end': 'endEvent', 'task': 'serviceTask', 'call': 'callActivity',
  'and-split': 'parallelGateway', 'and-join': 'parallelGateway', 'xor-split': 'exclusiveGateway', 'xor-join': 'exclusiveGateway',
}

type Point = { x: number, y: number }

export function bpmnXml (sequence: PlanNode[], name: string, details: TaskDetails = () => ({})): string {
  const layout = layoutBpmn(sequence)
  const byId = new Map(layout.shapes.map(shape => [shape.id, shape]))
  const nodes = new Map(flattenNodes(sequence).map(node => [node.id, node]))
  // In a diagram nothing lies left of or above the origin.
  const dx = 40 - Math.min(...layout.shapes.map(shape => shape.x))
  const dy = 40 - Math.min(...layout.shapes.map(shape => shape.y))

  // A flow through an empty branch's point is one sequence flow with a bend there.
  type Edge = { id: string, source: BpmnShape, target: BpmnShape, via?: BpmnShape, flow: BpmnFlow }
  const edges: Edge[] = []
  for (const flow of layout.flows) {
    const source = byId.get(flow.source)!
    const target = byId.get(flow.target)!
    if (source.kind === 'point') {
      continue
    }
    if (target.kind === 'point') {
      const onward = layout.flows.find(item => item.source === target.id)!
      edges.push({ id: `Flow_${edges.length + 1}`, source, target: byId.get(onward.target)!, via: target, flow })
    } else {
      edges.push({ id: `Flow_${edges.length + 1}`, source, target, flow })
    }
  }

  const shapes = layout.shapes.filter(shape => shape.kind !== 'point')
  const elements = shapes.map(shape => {
    const tag = ELEMENT[shape.kind as keyof typeof ELEMENT]
    const out = edges.filter(edge => edge.source.id === shape.id)
    const attributes = [`id="${xmlId(shape.id)}"`, `name="${escape(shape.title)}"`]
    if (shape.kind.endsWith('-split')) {
      attributes.push('gatewayDirection="Diverging"')
      const otherwise = out.find(edge => edge.flow.otherwise)
      if (otherwise) {
        attributes.push(`default="${otherwise.id}"`)
      }
    } else if (shape.kind.endsWith('-join')) {
      attributes.push('gatewayDirection="Converging"')
    }
    const node = shape.planId ? nodes.get(shape.planId) : undefined
    if (shape.kind === 'call' && node?.kind === 'call') {
      attributes.push(`calledElement="${escape(node.scopeId)}"`)
    }
    const body: string[] = []
    if ((shape.kind === 'task' || shape.kind === 'call') && node) {
      const { documentation, properties } = details(node)
      if (documentation) {
        body.push(`<bpmn:documentation>${escape(documentation)}</bpmn:documentation>`)
      }
      const entries = Object.entries(properties ?? {}).filter(([, value]) => value !== '')
      if (entries.length > 0) {
        body.push('<bpmn:extensionElements>', ...entries.map(([key, value]) => `  <sp:property name="${escape(key)}" value="${escape(value)}"/>`), '</bpmn:extensionElements>')
      }
    }
    body.push(
      ...edges.filter(edge => edge.target.id === shape.id).map(edge => `<bpmn:incoming>${edge.id}</bpmn:incoming>`),
      ...out.map(edge => `<bpmn:outgoing>${edge.id}</bpmn:outgoing>`),
    )
    return [`    <bpmn:${tag} ${attributes.join(' ')}>`, ...body.map(line => `      ${line}`), `    </bpmn:${tag}>`].join('\n')
  })
  const flows = edges.map(edge => {
    const label = edge.flow.label ? ` name="${escape(edge.flow.label)}"` : ''
    const head = `    <bpmn:sequenceFlow id="${edge.id}" sourceRef="${xmlId(edge.source.id)}" targetRef="${xmlId(edge.target.id)}"${label}`
    if (edge.flow.label && !edge.flow.otherwise) {
      return `${head}>\n      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escape(edge.flow.label)}</bpmn:conditionExpression>\n    </bpmn:sequenceFlow>`
    }
    return `${head}/>`
  })

  const round = (value: number) => Math.round(value)
  const bounds = (shape: BpmnShape) => `<dc:Bounds x="${round(shape.x + dx)}" y="${round(shape.y + dy)}" width="${shape.w}" height="${shape.h}"/>`
  const right = (shape: BpmnShape): Point => ({ x: shape.x + shape.w + dx, y: shape.y + shape.h / 2 + dy })
  const left = (shape: BpmnShape): Point => ({ x: shape.x + dx, y: shape.y + shape.h / 2 + dy })
  /** Out of the source's right side, into the target's left, bending once in the gap between them. */
  function waypoints (edge: Edge): Point[] {
    const from = right(edge.source)
    const to = left(edge.target)
    if (edge.via) {
      const y = edge.via.y + edge.via.h / 2 + dy
      return [from, { x: from.x + SIZE.gap / 2, y: from.y }, { x: from.x + SIZE.gap / 2, y }, { x: to.x - SIZE.gap / 2, y }, { x: to.x - SIZE.gap / 2, y: to.y }, to]
    }
    if (from.y === to.y) {
      return [from, to]
    }
    // Into a branch the bend is next to the split; out of one, next to the join.
    const x = edge.source.kind.endsWith('-split') ? from.x + SIZE.gap / 2 : to.x - SIZE.gap / 2
    return [from, { x, y: from.y }, { x, y: to.y }, to]
  }
  const diagram = [
    ...shapes.map(shape => `      <bpmndi:BPMNShape id="${xmlId(shape.id)}_di" bpmnElement="${xmlId(shape.id)}"${shape.kind.startsWith('xor') ? ' isMarkerVisible="true"' : ''}>\n        ${bounds(shape)}\n      </bpmndi:BPMNShape>`),
    ...edges.map(edge => [
      `      <bpmndi:BPMNEdge id="${edge.id}_di" bpmnElement="${edge.id}">`,
      ...waypoints(edge).map(point => `        <di:waypoint x="${round(point.x)}" y="${round(point.y)}"/>`),
      '      </bpmndi:BPMNEdge>',
    ].join('\n')),
  ]

  const id = xmlId(name || 'Flow') || 'Flow'
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:sp="${SP}" id="Definitions_${id}" targetNamespace="${SP}" exporter="AAS Web UI, Process Sequence (BPMN)" exporterVersion="1.0">`,
    `  <bpmn:process id="Process_${id}" name="${escape(name)}" isExecutable="false">`,
    ...elements,
    ...flows,
    '  </bpmn:process>',
    `  <bpmndi:BPMNDiagram id="Diagram_${id}">`,
    `    <bpmndi:BPMNPlane id="Plane_${id}" bpmnElement="Process_${id}">`,
    ...diagram,
    '    </bpmndi:BPMNPlane>',
    '  </bpmndi:BPMNDiagram>',
    '</bpmn:definitions>',
    '',
  ].join('\n')
}
