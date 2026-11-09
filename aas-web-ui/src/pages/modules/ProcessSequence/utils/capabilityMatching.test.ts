import type { CapabilityRequirement, PlanParameter } from '../types/plan'
import type { Matched } from './capabilityMatching'
import { describe, expect, it } from 'vitest'
import { matchResources } from './capabilityMatching'

const service = 'http://service'
const LAB = 'https://smartproductionlab.aau.dk/semantics'
const product = 'https://smartproductionlab.aau.dk/aas/Vial2mLAAS'
const module = 'https://smartproductionlab.aau.dk/aas/FillingModuleAAS'
const requirement: CapabilityRequirement = { name: 'Filling', reference: { type: 'ModelReference', keys: [
  { type: 'Submodel', value: `${product}/submodels/CapabilityDescription` }, { type: 'SubmodelElementCollection', value: 'RequiredCapabilities' },
  { type: 'SubmodelElementCollection', value: 'Filling' }, { type: 'Capability', value: 'Capability' }] } }
const volume: PlanParameter = { name: 'FillVolume', group: 'ProductParameters', dataType: 'xs:double', value: '3.5', unit: 'mL',
  source: { aasId: product, submodelId: 's', path: [] }, semanticIds: [`${LAB}/FillVolume`] }

/** A fetch that records the request and answers with ``status`` and ``body``. */
function answering (status: number, body: unknown) {
  const sent: { url: string, init: RequestInit }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return Response.json(body, { status })
  }) as unknown as typeof fetch
  return { sent, fetcher }
}

describe('matching on the skill service', () => {
  it('asks the service with the step\'s requirements, the recipe and the resources', async () => {
    const answer: Matched = {
      matches: [{ aasId: module, status: 'match', reasons: ['FillVolume: required 3.5, offered 0.5–10.0 mL'], capabilities: [], availability: 'Now', reconfigure: [] }],
      candidates: [module], requirement: { capability: 'Filling', values: { FillVolume: 3.5, ContainerType: 'vial' } },
    }
    const { sent, fetcher } = answering(200, answer)
    expect(await matchResources([requirement], [volume], [module], service, fetcher)).toEqual(answer)
    expect(sent[0]!.url).toBe(`${service}/match`)
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ requirements: [requirement], aasIds: [module],
      parameters: [{ name: 'FillVolume', semanticIds: [`${LAB}/FillVolume`], value: '3.5', unit: 'mL', dataType: 'xs:double' }] })
  })

  it('asks nothing of a step without requirements', async () => {
    const { sent, fetcher } = answering(200, {})
    expect(await matchResources([], [volume], undefined, service, fetcher)).toEqual({ matches: [], candidates: [], requirement: null })
    expect(sent).toEqual([])
  })

  it('says so when the service is not reached, or refuses', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(matchResources([requirement], [], undefined, service, down)).rejects.toThrow(`The skill service at ${service} was not reached`)
    const refused = answering(400, { error: 'match: requirements: a list', step: 'match', reasons: [] })
    await expect(matchResources([requirement], [], undefined, service, refused.fetcher)).rejects.toThrow('could not match the resources')
  })
})
