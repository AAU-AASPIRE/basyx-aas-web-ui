import type { Requirement } from '../skills/skillService'
import type { SkillDefinition } from '../types'
import type { ProcessPlan, StepNode } from '../types/plan'
import type { CapabilityDescription } from './capabilities'
import type { CapabilityMatch, Matched } from './capabilityMatching'
import type { MatchPlanServices } from './matchAndPlan'
import { describe, expect, it, vi } from 'vitest'
import { matchAndPlan, plannedName } from './matchAndPlan'

const LAB = 'https://smartproductionlab.aau.dk/semantics'
const PRODUCT = 'syringe'
const MODULE = 'filling'
const capRef = (aas: string, name: string) => ({ type: 'ModelReference' as const, keys: [{ type: 'Submodel', value: `${aas}/submodels/CapabilityDescription` }, { type: 'Capability', value: name }] })
const skillRef = (name: string) => ({ type: 'ModelReference' as const, keys: [{ type: 'Submodel', value: `${MODULE}/submodels/Skills` }, { type: 'SubmodelElementCollection', value: name }] })

/** An offered capability as the skill service answers with it, realized by ``skill`` (none: one can be planned). */
function offered (name: string, skill: string | null, availability: CapabilityDescription['availability'] = 'Now'): CapabilityDescription {
  return { name, aasId: MODULE, role: 'Offered', availability, reference: capRef(MODULE, name), semanticIds: [`${LAB}/${name}`],
    realizedBy: skill ? [skillRef(skill)] : [], hasConstraints: false, properties: [] }
}
function match (status: CapabilityMatch['status'], capabilities: CapabilityDescription[] = [], reasons: string[] = []): CapabilityMatch {
  return { aasId: MODULE, status, reasons, capabilities, availability: capabilities.some(item => item.availability !== 'Now') ? 'AfterReconfiguration' : 'Now', reconfigure: [] }
}
const skill = (name: string): SkillDefinition => ({ idShort: name, name, description: '', capabilities: [], parameters: [], reference: skillRef(name) })

function plan (capability: string, outputs: string[] = []): ProcessPlan {
  const step: StepNode = { id: 'step-1', kind: 'step', name: 'Filling', process: null, resourceAasId: '', skillId: '', bindings: [],
    requiredCapabilities: [{ name: capability, reference: capRef(PRODUCT, capability) }],
    outputs: outputs.map(name => ({ id: name, name, type: 'number' as const, unit: 'g' })) }
  return { schema: 'process-sequence-plan/5.0', productAasId: PRODUCT, revision: 0, rootScopeId: 'root',
    scopes: [{ id: 'root', name: 'Syringe', parentId: null, material: null, nodes: [step] }] }
}

/** The skill service's answers and the module's skills; ``after`` its skills once a skill is planned. */
function services (matches: CapabilityMatch[], requirement: Requirement, skills: SkillDefinition[], candidates: string[] = [], after?: SkillDefinition[]) {
  let planned = false
  const calls: MatchPlanServices = {
    match: vi.fn(async (): Promise<Matched> => ({ matches, candidates, requirement })),
    loadSkills: vi.fn(async () => (planned && after ? after : skills)),
    vocabulary: vi.fn(async (name: string) => ({ name, label: name, process: true, lineage: name === 'BottomUpFilling' ? ['BottomUpFilling', 'Filling'] : [name], results: ['FillWeight'] })),
    check: vi.fn(async () => ({ shell: MODULE, skills: {} })),
    plan: vi.fn(async () => {
      planned = true
      return { shell: MODULE, capability: 'x', steps: [] }
    }),
  }
  return calls
}

const resources = [{ id: MODULE, name: 'Filling module' }]
const SYRINGE = { FillVolume: 1, InnerDiameter: 6.35, MinImmersion: -2, MaxImmersion: 3, ContainerType: 'syringe' }

describe('Match and plan', () => {
  it('binds the skill that matches, as Match resources would', async () => {
    const calls = services([match('match', [offered('Filling', 'Dispensing')])], { capability: 'Filling', values: { FillVolume: 2 } }, [skill('Dispensing')])
    const product = plan('Filling')
    const [outcome] = await matchAndPlan(product, 'Syringe', resources, calls, () => [])
    expect([outcome!.kind, outcome!.resource, outcome!.skill]).toEqual(['bound', 'Filling module', 'Dispensing'])
    expect((product.scopes[0]!.nodes[0] as StepNode).resourceAasId).toBe(MODULE)
    expect(calls.match).toHaveBeenCalledWith((product.scopes[0]!.nodes[0] as StepNode).requiredCapabilities, [], [MODULE])
    expect(calls.plan).not.toHaveBeenCalled()
  })

  it('plans a narrower capability on the module the service names: it offers what the capability narrows', async () => {
    const name = plannedName('BottomUpFilling', 'Syringe')
    const calls = services([match('mismatch', [], ['BottomUpFilling: capability not offered'])], { capability: 'BottomUpFilling', values: SYRINGE },
      [skill('Dispensing')], [MODULE], [skill('Dispensing'), skill(name)])
    const product = plan('BottomUpFilling', ['FillWeight'])
    const [outcome] = await matchAndPlan(product, 'Syringe', resources, calls, () => [])
    // The values the service gives; what the module offers then derived by the service's /plan itself.
    expect(calls.plan).toHaveBeenCalledWith(MODULE, { capability: 'BottomUpFilling', name, write: true, results: ['FillWeight'], values: SYRINGE })
    expect([outcome!.kind, outcome!.skill]).toEqual(['planned', name])
    expect((product.scopes[0]!.nodes[0] as StepNode).skillId).toBe(name)
  })

  it('plans where the service says a skill can be planned, and says when what the module offers was not derived', async () => {
    // 15 mL: offered after a reconfiguration by a capability no skill realizes yet.
    const name = plannedName('Filling', 'Syringe')
    const calls = services([match('match', [offered('Filling_planned', null, 'AfterReconfiguration')])], { capability: 'Filling', values: { FillVolume: 15 } },
      [skill('Dispensing')], [MODULE], [skill('Dispensing'), skill(name)])
    calls.plan = vi.fn(async () => ({ shell: MODULE, capability: 'Filling', steps: [], name, derived: { error: 'derive: no module', reasons: ['gone'] } }))
    calls.loadSkills = vi.fn(async () => [skill('Dispensing'), skill(name)])
    const [outcome] = await matchAndPlan(plan('Filling'), 'Syringe', resources, calls, () => [])
    expect(calls.plan).toHaveBeenCalledWith(MODULE, expect.objectContaining({ capability: 'Filling', values: { FillVolume: 15 }, results: [] }))
    expect(outcome!.kind).toBe('planned')
    expect(outcome!.notes).toContain('What the module offers was not derived anew: derive: no module; gone')
  })

  it('checks a skill written for a narrower capability against the requirement before binding it', async () => {
    const requirement = { capability: 'BottomUpFilling', values: { FillVolume: 1, MinImmersion: -2 } }
    const unknown = [match('unknown', [offered('BottomUpFilling', 'BottomUp')], ['Additional constraints need evaluation'])]
    const calls = services(unknown, requirement, [skill('BottomUp')])
    calls.check = vi.fn(async () => ({ shell: MODULE, skills: { BottomUp: [{ step: 'Dispense', what: 'BottomUpFilling keeps OutletImmersion >= -2.0, but it comes to -4.0', fix: [] }] } }))
    // It does not keep it (the station is raised): not bound, and said why.
    const [outcome] = await matchAndPlan(plan('BottomUpFilling'), 'Syringe', resources, calls, () => [])
    expect(calls.check).toHaveBeenCalledWith(MODULE, requirement)
    expect(outcome!.kind).not.toBe('checked')
    expect(outcome!.notes.some(note => note.includes('does not keep what BottomUpFilling requires'))).toBe(true)
    const [ok] = await matchAndPlan(plan('BottomUpFilling'), 'Syringe', resources, services(unknown, requirement, [skill('BottomUp')]), () => [])
    expect([ok!.kind, ok!.skill]).toEqual(['checked', 'BottomUp'])
  })

  it('leaves steps already bound and manual ones as they are', async () => {
    const calls = services([match('match', [offered('Filling', 'Dispensing')])], { capability: 'Filling', values: {} }, [skill('Dispensing')])
    const product = plan('Filling')
    Object.assign(product.scopes[0]!.nodes[0]!, { resourceAasId: MODULE, skillId: 'Dispensing' })
    expect((await matchAndPlan(product, 'Syringe', resources, calls, () => []))[0]!.kind).toBe('kept')
    Object.assign(product.scopes[0]!.nodes[0]!, { resourceAasId: '', skillId: '', executionMode: 'manual' })
    expect((await matchAndPlan(product, 'Syringe', resources, calls, () => []))[0]!.kind).toBe('manual')
    expect(calls.match).not.toHaveBeenCalled()
  })

  it('stops with the service\'s words when it cannot be reached', async () => {
    const calls = services([], { capability: 'Filling', values: {} }, [])
    calls.match = vi.fn(async () => {
      throw new Error('The skill service at http://localhost:8090 was not reached (Failed to fetch).')
    })
    await expect(matchAndPlan(plan('Filling'), 'Syringe', resources, calls, () => [])).rejects.toThrow('was not reached')
  })

  it('names a planned skill after the capability and the product', () => {
    expect(plannedName('BottomUpFilling', 'Prefilled syringe 1 mL')).toBe('BottomUpFillingForPrefilledsyringe1mL')
    expect(plannedName('BottomUpFilling', 'PrefilledSyringe1mLAAS')).toBe('BottomUpFillingForPrefilledSyringe1mL')
  })
})
