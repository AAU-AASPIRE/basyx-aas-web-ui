import type { ResourceSkill } from '../../ProcessSequence/skills/skillFlow'
import type { CapabilityReference, PlanProcess } from '../../ProcessSequence/types/plan'

/** What the catalog offers: a step, a call, or a gateway or a block of two. */
export interface PaletteItem {
  key: string
  title: string
  subtitle?: string
  hint?: string
  glyph: 'task' | 'call' | 'and' | 'xor' | 'and-pair' | 'xor-pair'
}

/** What dropping it makes. */
export type Payload
  = | { kind: 'step', process?: PlanProcess, skill?: ResourceSkill }
    | { kind: 'call', scopeId: string, name: string }
    | { kind: 'block', block: 'parallel' | 'decision' | 'conditional' }
    | { kind: 'gateway', gateway: 'and' | 'xor' }

export interface CatalogItem extends PaletteItem {
  payload: Payload
}

export interface CatalogGroup {
  title: string
  items: CatalogItem[]
}

/** The type of the data a catalog item is dragged with. */
export const PALETTE_MIME = 'application/x-bpmn-palette-item'

const component = (aasId: string): string => aasId.split('/').at(-1)?.replace(/AAS$/, '') ?? ''
const GENERIC = new Set(['Capability', 'CapabilityContainer', 'CapabilitySet', 'Capabilities'])

/** A required capability by what it is named in the reference (a capability container's name), not by its element's idShort. */
function capability (reference: CapabilityReference): string {
  const key = reference.keys.map(item => item.value.split(/[/#]/).at(-1) ?? '').findLast(value => value && !GENERIC.has(value))
  return key ?? ''
}

/** What a process step needs and takes. */
function subtitle (process: PlanProcess): string {
  const needs = [...new Set((process.requiredCapabilities ?? []).map(item => capability(item.reference)).filter(Boolean))]
  const count = process.parameters.length
  return [needs.length > 0 ? `Needs ${needs.join(', ')}` : '', `${count} ${count === 1 ? 'parameter' : 'parameters'}`].filter(Boolean).join(' · ')
}

const GATEWAYS: CatalogItem[] = [
  { key: 'block:parallel', title: 'Parallel block', subtitle: 'Branches that all run', glyph: 'and-pair', payload: { kind: 'block', block: 'parallel' },
    hint: 'A parallel split and its join, with two branches: every branch runs, the flow goes on when all are done.' },
  { key: 'block:decision', title: 'Decision', subtitle: 'One of two branches', glyph: 'xor-pair', payload: { kind: 'block', block: 'decision' },
    hint: 'An exclusive split and its join: the first branch when the condition holds, otherwise the second.' },
  { key: 'block:conditional', title: 'Conditional steps', subtitle: 'Run or skip', glyph: 'xor-pair', payload: { kind: 'block', block: 'conditional' },
    hint: 'An exclusive split and its join: the steps run when the condition holds, otherwise they are skipped.' },
  { key: 'gateway:and', title: 'Parallel gateway', subtitle: 'One gateway, to wire', glyph: 'and', payload: { kind: 'gateway', gateway: 'and' },
    hint: 'A single parallel gateway: it splits when wired to several shapes, it joins when several lead into it.' },
  { key: 'gateway:xor', title: 'Exclusive gateway', subtitle: 'One gateway, to wire', glyph: 'xor', payload: { kind: 'gateway', gateway: 'xor' },
    hint: 'A single exclusive gateway: it splits in two (the condition, otherwise), or joins.' },
]

/**
 * The catalog of the planner (``plan``: the product's process steps, its subprocesses) or of the
 * skill editor (``skill``: the skills of the module's components, by component), then the gateways.
 */
export function catalogGroups (mode: 'skill' | 'plan', sources: { processes?: PlanProcess[], targets?: { id: string, name: string }[], skills?: ResourceSkill[] }): CatalogGroup[] {
  const groups: CatalogGroup[] = []
  if (mode === 'plan') {
    groups.push({
      title: 'Process steps',
      items: (sources.processes ?? []).map(process => ({
        key: `process:${JSON.stringify(process.source)}`, title: process.name, glyph: 'task',
        subtitle: subtitle(process),
        payload: { kind: 'step', process },
      })),
    })
    if ((sources.targets ?? []).length > 0) {
      groups.push({
        title: 'Subprocesses',
        items: sources.targets!.map(target => ({
          key: `call:${target.id}`, title: target.name, subtitle: 'Call: runs the whole subprocess', glyph: 'call',
          payload: { kind: 'call', scopeId: target.id, name: target.name },
        })),
      })
    }
  } else {
    const primitives = (sources.skills ?? []).filter(skill => skill.kind === 'Primitive')
    for (const name of new Set(primitives.map(skill => component(skill.aasId)))) {
      groups.push({
        title: name,
        items: primitives.filter(skill => component(skill.aasId) === name).map(skill => ({
          key: `skill:${skill.aasId}:${skill.idShort}`, title: skill.idShort, glyph: 'task',
          subtitle: skill.inputs.map(input => input.idShort).join(', ') || 'Takes nothing',
          hint: skill.description || undefined,
          payload: { kind: 'step', skill },
        })),
      })
    }
  }
  groups.push({ title: 'Gateways', items: GATEWAYS }, {
    title: 'Other',
    items: [{ key: 'step:empty', title: 'Empty step', subtitle: mode === 'plan' ? 'Choose its process step later' : 'Choose its skill later', glyph: 'task', payload: { kind: 'step' } }],
  })
  return groups.filter(group => group.items.length > 0)
}
