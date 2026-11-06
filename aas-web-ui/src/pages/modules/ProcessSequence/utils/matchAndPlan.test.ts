import type { SkillDefinition } from '../types'
import type { ProcessPlan, StepNode } from '../types/plan'
import type { CapabilityDescription } from './capabilities'
import type { MatchPlanServices } from './matchAndPlan'
import { describe, expect, it, vi } from 'vitest'
import { matchAndPlan, plannedName, requirementValues } from './matchAndPlan'

const LAB = 'https://smartproductionlab.aau.dk/semantics'
const PRODUCT = 'syringe'
const MODULE = 'filling'
const capRef = (aas: string, name: string) => ({ type: 'ModelReference' as const, keys: [{ type: 'Submodel', value: `${aas}/submodels/CapabilityDescription` }, { type: 'Capability', value: name }] })
const skillRef = (name: string) => ({ type: 'ModelReference' as const, keys: [{ type: 'Submodel', value: `${MODULE}/submodels/Skills` }, { type: 'SubmodelElementCollection', value: name }] })
const value = (name: string, v: string, unit = 'mm') => ({ name, semanticId: `${LAB}/${name}`, unit, dataType: 'xs:double', kind: 'value' as const, value: v, min: '', max: '' })
const range = (name: string, min: string, max: string, unit = 'mL') => ({ name, semanticId: `${LAB}/${name}`, unit, dataType: 'xs:double', kind: 'range' as const, value: '', min, max })

function offered (name: string, meaning: string, skill: string | null, availability: CapabilityDescription['availability'], max = '10.0'): CapabilityDescription {
  return { name, aasId: MODULE, role: 'Offered', availability, reference: capRef(MODULE, name), semanticIds: [`${LAB}/${meaning}`],
    realizedBy: skill ? [skillRef(skill)] : [], hasConstraints: meaning === 'BottomUpFilling', properties: [range('FillVolume', '0.5', max)] }
}
function required (meaning: string, properties: CapabilityDescription['properties']): CapabilityDescription {
  return { name: meaning, aasId: PRODUCT, role: 'Required', availability: 'Now', reference: capRef(PRODUCT, meaning), semanticIds: [`${LAB}/${meaning}`],
    realizedBy: [], hasConstraints: false, properties }
}
const skill = (name: string): SkillDefinition => ({ idShort: name, name, description: '', capabilities: [], parameters: [], reference: skillRef(name) })

function plan (requirement: CapabilityDescription, outputs: string[] = []): ProcessPlan {
  const step: StepNode = { id: 'step-1', kind: 'step', name: 'Filling', process: null, resourceAasId: '', skillId: '', bindings: [],
    requiredCapabilities: [{ name: requirement.name, reference: requirement.reference }],
    outputs: outputs.map(name => ({ id: name, name, type: 'number' as const, unit: 'g' })) }
  return { schema: 'process-sequence-plan/5.0', productAasId: PRODUCT, revision: 0, rootScopeId: 'root',
    scopes: [{ id: 'root', name: 'Syringe', parentId: null, material: null, nodes: [step] }] }
}

/** The module and the product as the services give them; ``after`` what the module offers once a skill is planned. */
function services (offers: CapabilityDescription[], need: CapabilityDescription, skills: SkillDefinition[], after?: { offers: CapabilityDescription[], skills: SkillDefinition[] }) {
  let planned = false
  const calls: MatchPlanServices = {
    loadCapabilities: vi.fn(async (id: string) => id === PRODUCT ? [need] : (planned && after ? after.offers : offers)),
    loadSkills: vi.fn(async () => (planned && after ? after.skills : skills)),
    vocabulary: vi.fn(async (name: string) => ({ name, label: name, process: true, lineage: name === 'BottomUpFilling' ? ['BottomUpFilling', 'Filling'] : [name], results: ['FillWeight'] })),
    check: vi.fn(async () => ({ shell: MODULE, skills: {} })),
    plan: vi.fn(async () => {
      planned = true
      return { shell: MODULE, capability: 'x', steps: [] }
    }),
    derive: vi.fn(async () => ({})),
  }
  return calls
}

const resources = [{ id: MODULE, name: 'Filling module' }]

describe('Match and plan', () => {
  it('binds the skill that matches, as Match resources would', async () => {
    const need = required('Filling', [value('FillVolume', '2.0', 'mL')])
    const calls = services([offered('Filling', 'Filling', 'Dispensing', 'Now')], need, [skill('Dispensing')])
    const product = plan(need)
    const [outcome] = await matchAndPlan(product, 'Syringe', resources, calls, () => [])
    expect([outcome!.kind, outcome!.resource, outcome!.skill]).toEqual(['bound', 'Filling module', 'Dispensing'])
    expect((product.scopes[0]!.nodes[0] as StepNode).resourceAasId).toBe(MODULE)
    expect(calls.plan).not.toHaveBeenCalled()
  })

  it('plans a narrower capability on the module that offers what it narrows', async () => {
    // BottomUpFilling: no module offers it; the filling module offers Filling, which it narrows.
    const need = required('BottomUpFilling', [value('FillVolume', '1.0', 'mL'), value('InnerDiameter', '6.35'), value('MinImmersion', '-2.0'), value('MaxImmersion', '3.0')])
    const name = plannedName('BottomUpFilling', 'Syringe')
    const after = { offers: [offered('Filling', 'Filling', 'Dispensing', 'Now'), offered('BottomUpFilling', 'BottomUpFilling', name, 'AfterReconfiguration', '1.0')],
      skills: [skill('Dispensing'), skill(name)] }
    const calls = services([offered('Filling', 'Filling', 'Dispensing', 'Now')], need, [skill('Dispensing')], after)
    const product = plan(need, ['FillWeight'])
    const [outcome] = await matchAndPlan(product, 'Syringe', resources, calls, () => [])
    expect(calls.plan).toHaveBeenCalledWith(MODULE, { capability: 'BottomUpFilling', name, write: true, results: ['FillWeight'],
      values: { FillVolume: 1, InnerDiameter: 6.35, MinImmersion: -2, MaxImmersion: 3 } })
    expect(calls.derive).toHaveBeenCalledWith(MODULE)
    expect([outcome!.kind, outcome!.skill]).toEqual(['planned', name])
    expect((product.scopes[0]!.nodes[0] as StepNode).skillId).toBe(name)
  })

  it('plans where the matching says a skill can be planned (offered after a reconfiguration, by no skill)', async () => {
    const need = required('Filling', [value('FillVolume', '15.0', 'mL')])
    const name = plannedName('Filling', 'Syringe')
    const offers = [offered('Filling', 'Filling', 'Dispensing', 'Now'), offered('Filling_planned', 'Filling', null, 'AfterReconfiguration', '20.0')]
    const after = { offers: [...offers, offered('Filling_FillingForSyringe', 'Filling', name, 'AfterReconfiguration', '20.0')], skills: [skill('Dispensing'), skill(name)] }
    const calls = services(offers, need, [skill('Dispensing')], after)
    const [outcome] = await matchAndPlan(plan(need), 'Syringe', resources, calls, () => [])
    expect(calls.plan).toHaveBeenCalledWith(MODULE, expect.objectContaining({ capability: 'Filling', values: { FillVolume: 15 }, results: [] }))
    expect(outcome!.kind).toBe('planned')
  })

  it('checks a skill written for a narrower capability against the requirement before binding it', async () => {
    const need = required('BottomUpFilling', [value('FillVolume', '1.0', 'mL'), value('MinImmersion', '-2.0')])
    const calls = services([offered('BottomUpFilling', 'BottomUpFilling', 'BottomUp', 'Now')], need, [skill('BottomUp')])
    calls.check = vi.fn(async () => ({ shell: MODULE, skills: { BottomUp: [{ step: 'Dispense', what: 'BottomUpFilling keeps OutletImmersion >= -2.0, but it comes to -4.0', fix: [] }] } }))
    // It does not keep it (the station is raised): not bound, and said why.
    const [outcome] = await matchAndPlan(plan(need), 'Syringe', resources, calls, () => [])
    expect(outcome!.kind).not.toBe('checked')
    expect(outcome!.notes.some(note => note.includes('does not keep what BottomUpFilling requires'))).toBe(true)
    const kept = services([offered('BottomUpFilling', 'BottomUpFilling', 'BottomUp', 'Now')], need, [skill('BottomUp')])
    const [ok] = await matchAndPlan(plan(need), 'Syringe', resources, kept, () => [])
    expect([ok!.kind, ok!.skill]).toEqual(['checked', 'BottomUp'])
  })

  it('leaves steps already bound and manual ones as they are', async () => {
    const need = required('Filling', [value('FillVolume', '2.0', 'mL')])
    const calls = services([offered('Filling', 'Filling', 'Dispensing', 'Now')], need, [skill('Dispensing')])
    const product = plan(need)
    Object.assign(product.scopes[0]!.nodes[0]!, { resourceAasId: MODULE, skillId: 'Dispensing' })
    expect((await matchAndPlan(product, 'Syringe', resources, calls, () => []))[0]!.kind).toBe('kept')
    Object.assign(product.scopes[0]!.nodes[0]!, { resourceAasId: '', skillId: '', executionMode: 'manual' })
    expect((await matchAndPlan(product, 'Syringe', resources, calls, () => []))[0]!.kind).toBe('manual')
  })

  it('takes a recipe value in place of the required one, as the matching does', () => {
    const need = required('Filling', [value('FillVolume', '2.0', 'mL')])
    const recipe = [{ name: 'FillVolume', group: 'ProductParameters' as const, dataType: 'xs:double', value: '3.5', unit: 'mL',
      source: { aasId: PRODUCT, submodelId: 's', path: [] }, semanticIds: [`${LAB}/FillVolume`] }]
    expect(requirementValues(need, recipe)).toEqual({ FillVolume: 3.5 })
    expect(plannedName('BottomUpFilling', 'Prefilled syringe 1 mL')).toBe('BottomUpFillingForPrefilledsyringe1mL')
  })
})
