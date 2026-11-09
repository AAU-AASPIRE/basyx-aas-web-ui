/**
 * Match and plan: one press gives every step of the product's sequence a resource and a skill, the way
 * the step's Match resources would, and plans a skill where none is there (iec61499-mgmt-py, 6 Nov).
 *
 * For each step with required capabilities, in this order: first a resource whose skill matches
 * (meaning, values, units; capabilityMatching), offered now before one offered after a
 * reconfiguration, is bound. Then a skill that matches but whose capability states constraints (a
 * narrower one: BottomUpFilling) is checked against the requirement by the skill service, in time,
 * and bound if it keeps it. Otherwise a skill is planned (the skill service's /plan) on a module that
 * can be planned for the capability (the matching says so: offered after a reconfiguration, by no
 * skill yet) or that offers a capability the required one narrows (the vocabulary's lineage: a module
 * offering Filling for BottomUpFilling). The planned skill is described in the module's AAS, its
 * offered capabilities derived anew, and the step bound to it; modsync reconfigure builds it.
 *
 * Nothing in it knows of filling: what a module can do is what its capabilities say, and what a
 * requirement narrows is the vocabulary's.
 */
import type { Checked, Planned, PlanRequest, Requirement, VocabularyClass } from '../skills/skillService'
import type { SkillDefinition } from '../types'
import type { CapabilityRequirement, PlanParameter, ProcessPlan, StepNode } from '../types/plan'
import type { CapabilityDescription } from './capabilities'
import type { CapabilityMatch } from './capabilityMatching'
import { referenceKey } from './capabilities'
import { matchCapabilities } from './capabilityMatching'
import { canonicalMeaning } from './parameterSemantics'
import { flattenNodes } from './plan'
import { assignSkill } from './skillAssignment'

export type Outcome = {
  stepId: string
  step: string
  /** kept: bound before; bound: matched; checked: matched and checked against the requirement; planned; none: nothing found; manual. */
  kind: 'kept' | 'bound' | 'checked' | 'planned' | 'none' | 'manual'
  resource?: string
  skill?: string
  notes: string[]
}

/** What Match and plan reads and asks: the AAS server through the planner's sources, the skill service. */
export type MatchPlanServices = {
  loadCapabilities: (aasId: string) => Promise<CapabilityDescription[]>
  loadSkills: (aasId: string) => Promise<SkillDefinition[]>
  vocabulary: (name: string) => Promise<VocabularyClass>
  check: (shell: string, requirement: Requirement) => Promise<Checked>
  plan: (shell: string, request: PlanRequest) => Promise<Planned>
  derive: (shell: string) => Promise<unknown>
}

const local = (meaning: string): string => canonicalMeaning(meaning).replace(/\/+$/, '').split('/').at(-1) ?? meaning
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** A name for a planned skill: what it is for, and for which product (an idShort, without the AAS it ends in). */
export function plannedName (capability: string, product: string): string {
  const name = `${capability}For${product.replace(/AAS$/, '')}`.replace(/\W/g, '')
  return /^[A-Z]/i.test(name) ? name : `S${name}`
}

/**
 * The values a requirement is planned and checked with, by the local name of what each means: the
 * required capability's properties, a recipe parameter of the same meaning in their place (as the
 * matching takes it).
 */
export function requirementValues (required: CapabilityDescription | undefined, parameters: PlanParameter[] = []): Record<string, number> {
  const values: Record<string, number> = {}
  for (const property of required?.properties ?? []) {
    const value = Number(property.kind === 'value' ? property.value : Number.NaN)
    if (property.semanticId && Number.isFinite(value)) {
      values[local(property.semanticId)] = value
    }
  }
  for (const parameter of parameters) {
    const value = Number(parameter.value)
    for (const id of parameter.semanticIds ?? []) {
      if (Number.isFinite(value) && parameter.value.trim() !== '') {
        values[local(id)] = value
      }
    }
  }
  return values
}

/** The one skill of a resource that realizes every capability it matches with (Match resources binds it too). */
export function realizing (match: CapabilityMatch, skills: SkillDefinition[]): SkillDefinition | undefined {
  return skills.find(skill => skill.reference && match.capabilities.length > 0
    && match.capabilities.every(capability => capability.realizedBy.some(reference => referenceKey(reference) === referenceKey(skill.reference!))))
}

function bind (node: StepNode, resource: string, skill: SkillDefinition): void {
  node.resourceAasId = resource
  assignSkill(node, skill)
  node.executionMode = 'station'
}

/** A step being matched: what it requires, how the resources answer, what came of it. */
type Asked = {
  node: StepNode
  outcome: Outcome
  matches: CapabilityMatch[]
  requirement: Requirement
  vocabulary?: VocabularyClass
}

/** One run of Match and plan over a plan: the capabilities and skills read once, and anew after a plan. */
class Run {
  readonly catalogs = new Map<string, CapabilityDescription[]>()
  readonly skillsOf = new Map<string, Promise<SkillDefinition[]>>()
  readonly planned = new Set<string>() // the names of the skills planned in this run

  constructor (readonly plan: ProcessPlan, readonly product: string, readonly resources: { id: string, name: string }[],
    readonly services: MatchPlanServices) {}

  catalog (): CapabilityDescription[] {
    return [...this.catalogs.values()].flat()
  }

  skills (id: string): Promise<SkillDefinition[]> {
    if (!this.skillsOf.has(id)) {
      this.skillsOf.set(id, this.services.loadSkills(id).catch(() => []))
    }
    return this.skillsOf.get(id)!
  }

  name (id: string): string {
    return this.resources.find(resource => resource.id === id)?.name ?? id
  }

  reasons (matches: CapabilityMatch[]): string[] {
    return matches.flatMap(match => match.reasons.map(reason => `${this.name(match.aasId)}: ${reason}`))
  }

  /** A skill that matches: bound, the one offered now first. */
  async matched (asked: Asked): Promise<boolean> {
    for (const match of asked.matches.filter(item => item.status === 'match')) {
      const skill = realizing(match, await this.skills(match.aasId))
      if (skill) {
        bind(asked.node, match.aasId, skill)
        Object.assign(asked.outcome, { kind: 'bound', resource: this.name(match.aasId), skill: skill.idShort })
        if (match.availability === 'AfterReconfiguration') {
          asked.outcome.notes.push(`${skill.idShort} is described, not built yet: the module offers it after a reconfiguration (modsync reconfigure).`)
        }
        return true
      }
    }
    return false
  }

  /** A skill that matches all but the constraints it states: bound if it keeps the requirement, checked in time. */
  async checked (asked: Asked): Promise<boolean> {
    const { capability } = asked.requirement
    for (const match of asked.matches.filter(item => item.status === 'unknown')) {
      const skill = realizing(match, await this.skills(match.aasId))
      if (!skill) {
        continue
      }
      try {
        const found = (await this.services.check(match.aasId, asked.requirement)).skills[skill.idShort] ?? []
        if (found.length === 0) {
          bind(asked.node, match.aasId, skill)
          Object.assign(asked.outcome, { kind: 'checked', resource: this.name(match.aasId), skill: skill.idShort })
          asked.outcome.notes.push(`${skill.idShort} keeps what ${capability} requires, checked in time against the product.`)
          return true
        }
        asked.outcome.notes.push(`${this.name(match.aasId)}: ${skill.idShort} does not keep what ${capability} requires: ${found.map(f => f.what).join('; ')}`)
      } catch (error) {
        asked.outcome.notes.push(`${this.name(match.aasId)}: ${message(error)}`)
      }
    }
    return false
  }

  /** A skill planned where the matching says one can be, then where a class the required one narrows is offered. */
  async planned_ (asked: Asked): Promise<boolean> {
    const { capability, values } = asked.requirement
    const lineage = new Set(asked.vocabulary?.lineage ?? [capability])
    const plannable = asked.matches.filter(match => match.status !== 'mismatch' && match.capabilities.some(item => item.realizedBy.length === 0))
    const broader = [...this.catalogs.entries()].filter(([id, items]) => id !== this.plan.productAasId
      && items.some(item => item.role === 'Offered' && item.semanticIds.some(meaning => lineage.has(local(meaning)))))
    const candidates = [...new Set([...plannable.map(match => match.aasId), ...broader.map(([id]) => id)])]
    const asks = new Set([...(asked.node.outputs ?? []).map(output => output.name), ...Object.keys(values)])
    const results = (asked.vocabulary?.results ?? []).filter(result => asks.has(result))
    let name = plannedName(capability, this.product)
    for (let n = 2; this.planned.has(name); n++) {
      name = `${plannedName(capability, this.product)}_${n}`
    }
    for (const aasId of candidates) {
      try {
        await this.services.plan(aasId, { capability, values, results, name, write: true })
        await this.services.derive(aasId)
        this.catalogs.set(aasId, await this.services.loadCapabilities(aasId))
        this.skillsOf.delete(aasId)
        const skill = (await this.skills(aasId)).find(item => item.idShort === name)
        if (!skill) {
          asked.outcome.notes.push(`${this.name(aasId)}: ${name} was planned but is not among its skills.`)
          continue
        }
        bind(asked.node, aasId, skill)
        this.planned.add(name)
        Object.assign(asked.outcome, { kind: 'planned', resource: this.name(aasId), skill: name })
        asked.outcome.notes.push(`${name} planned for ${capability}${results.length > 0 ? `, giving ${results.join(', ')}` : ''}: described, built by a reconfiguration (modsync reconfigure).`)
        return true
      } catch (error) {
        asked.outcome.notes.push(`${this.name(aasId)}: ${message(error)}`)
      }
    }
    if (candidates.length === 0) {
      const narrows = lineage.size > 1 ? ` or what it narrows (${[...lineage].slice(1).join(', ')})` : ''
      asked.outcome.notes.push(`No module offers ${capability}${narrows}, nor can one be planned for it.`)
    }
    asked.outcome.notes.push(...this.reasons(asked.matches.filter(match => match.status === 'mismatch')))
    return false
  }

  async step (node: StepNode, requirements: CapabilityRequirement[]): Promise<Outcome> {
    const outcome: Outcome = { stepId: node.id, step: node.name, kind: 'none', notes: [] }
    if (node.executionMode === 'manual') {
      return { ...outcome, kind: 'manual' }
    }
    if (node.resourceAasId && node.skillId) {
      return { ...outcome, kind: 'kept', resource: this.name(node.resourceAasId), skill: node.skillId }
    }
    if (requirements.length === 0) {
      outcome.notes.push('No required capability: nothing to match.')
      return outcome
    }
    const matches = matchCapabilities(requirements, this.catalog(), node.process?.parameters)
      .toSorted((a, b) => Number(a.status !== 'match') - Number(b.status !== 'match') || Number(a.availability !== 'Now') - Number(b.availability !== 'Now'))
    const first = requirements[0]!
    const required = this.catalog().find(item => item.role === 'Required' && referenceKey(item.reference) === referenceKey(first.reference))
    const meaning = required?.semanticIds[0] ?? (first.reference.type === 'ExternalReference' ? first.reference.keys[0]?.value : undefined)
    const asked: Asked = { node, outcome, matches, requirement: { capability: meaning ? local(meaning) : '', values: requirementValues(required, node.process?.parameters) } }
    if (await this.matched(asked)) {
      return outcome
    }
    if (!meaning || requirements.length > 1) {
      outcome.notes.push(...this.reasons(matches), requirements.length > 1 ? 'More than one required capability: planned one at a time only.' : 'The requirement has no meaning to plan for.')
      return outcome
    }
    try {
      asked.vocabulary = await this.services.vocabulary(asked.requirement.capability)
    } catch (error) {
      outcome.notes.push(message(error))
    }
    if (!(await this.checked(asked))) {
      await this.planned_(asked)
    }
    return outcome
  }
}

/**
 * Bind every step of ``plan`` that has no resource yet (see the module's text); ``inherited`` gives a
 * step's requirements when the step does not override its process's. Changes ``plan`` in place.
 */
export async function matchAndPlan (plan: ProcessPlan, product: string, resources: { id: string, name: string }[],
  services: MatchPlanServices, inherited: (node: StepNode) => CapabilityRequirement[]): Promise<Outcome[]> {
  const run = new Run(plan, product, resources, services)
  const steps = plan.scopes.flatMap(scope => flattenNodes(scope.nodes)).filter((node): node is StepNode => node.kind === 'step')
  const owners = [...new Set([plan.productAasId, ...steps.map(node => node.process?.source.aasId ?? ''), ...resources.map(resource => resource.id)])].filter(Boolean)
  for (const result of await Promise.allSettled(owners.map(async id => [id, await services.loadCapabilities(id)] as const))) {
    if (result.status === 'fulfilled') {
      run.catalogs.set(...result.value)
    }
  }
  const outcomes: Outcome[] = []
  for (const node of steps) {
    outcomes.push(await run.step(node, node.requiredCapabilities ?? inherited(node)))
  }
  return outcomes
}
