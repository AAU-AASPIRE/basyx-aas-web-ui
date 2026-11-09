import type { StepNode } from '../types/plan'
import type { Matched } from '../utils/capabilityMatching'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createVuetify } from 'vuetify'
import PlanCapabilities from './PlanCapabilities.vue'

const module = 'https://smartproductionlab.aau.dk/aas/FillingModuleAAS'
const requirement = { name: 'Filling', reference: { type: 'ExternalReference' as const, keys: [{ type: 'GlobalReference', value: 'https://smartproductionlab.aau.dk/semantics/Filling' }] } }
const answer: Matched = {
  matches: [{ aasId: module, status: 'match', reasons: [], capabilities: [], availability: 'Now', reconfigure: [] }],
  candidates: [], requirement: { capability: 'Filling', values: {} },
}
const asked = vi.fn(async (..._: unknown[]): Promise<Matched> => answer)

vi.mock('@/store/AASDataStore', () => ({ useAASStore: () => ({ getSelectedAAS: { id: 'product' } }) }))
vi.mock('../composables/usePlanSources', () => ({ usePlanSources: () => ({ loadCapabilities: async () => [], loadSkills: async () => [] }) }))
vi.mock('../utils/capabilityMatching', () => ({ matchResources: (...args: unknown[]) => asked(...args) }))

beforeAll(() => {
  // What Vuetify's dialogs ask of the browser.
  vi.stubGlobal('ResizeObserver', class {
    disconnect () {}
    observe () {}
    unobserve () {}
  })
  vi.stubGlobal('visualViewport', { addEventListener: vi.fn(), height: 768, offsetLeft: 0, offsetTop: 0, removeEventListener: vi.fn(), width: 1024 })
})

describe('Match resources', () => {
  it('asks the skill service when the matches are shown, and says when it cannot be reached', async () => {
    const node = reactive<StepNode>({ id: 'step', kind: 'step', name: 'Filling', process: null, resourceAasId: '', skillId: '', bindings: [], requiredCapabilities: [requirement] })
    const wrapper = mount(PlanCapabilities, {
      props: { modelValue: node, resources: [{ id: module, name: 'Filling module' }], inherited: [] },
      global: { plugins: [createVuetify()] },
    })
    await flushPromises()
    const state = wrapper.vm as any
    expect(asked).not.toHaveBeenCalled()
    state.showMatches = true
    await flushPromises()
    expect(asked).toHaveBeenCalledWith([requirement], [], [module])
    expect(state.matches).toEqual(answer.matches)

    asked.mockRejectedValueOnce(new Error('The skill service at http://localhost:8090 was not reached (Failed to fetch).'))
    // The step's requirements change while the matches are shown: asked again.
    node.requiredCapabilities = [{ ...requirement, name: 'Filling again' }]
    await flushPromises()
    expect(state.matches).toEqual([])
    expect(state.matchError).toBe('Matching needs the skill service. The skill service at http://localhost:8090 was not reached (Failed to fetch).')
    wrapper.unmount()
  })
})
