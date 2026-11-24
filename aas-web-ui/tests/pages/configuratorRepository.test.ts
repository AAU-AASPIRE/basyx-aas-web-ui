import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonical, clone, newProduct, properties, setParameter } from '../../src/pages/modules/Configurator/model'
import { createOrder } from '../../src/pages/modules/Configurator/orders'
import { useRepository } from '../../src/pages/modules/Configurator/useRepository'

const state = vi.hoisted(() => ({ documents: new Map<string, any>(), writes: [] as string[], failAfter: Infinity, editing: true }))
vi.mock('@/composables/AAS/AASHandling', () => ({ useAASHandling: () => ({ fetchAasList: async () => [], getAasEndpointById: async () => {
  throw new Error('Registry descriptor not available')
} }) }))
vi.mock('@/store/EnvironmentStore', () => ({ useEnvStore: () => ({ get getAllowEditing () {
  return state.editing
}, getAllowUploading: true }) }))
vi.mock('@/store/InfrastructureStore', () => ({ useInfrastructureStore: () => ({ getSelectedInfrastructure: { id: 'one', template: 'mono-repo' }, getAASRepoURL: 'shell', getSubmodelRepoURL: 'sm' }) }))
vi.mock('@/composables/RequestHandling', () => ({ useRequestHandling: () => ({ getRequest: async (path: string) => state.documents.has(path) ? { success: true, data: clone(state.documents.get(path)), status: 200 } : { success: false, status: 404 } }) }))
vi.mock('@/composables/Client/AASRepositoryClient', () => ({ useAASRepositoryClient: () => ({ getAasEndpointById: (id: string) => `shell/${id}`, postAas: async (shell: any) => write(`shell/${shell.id}`, shell), putAas: async (shell: any) => write(`shell/${shell.id}`, shell) }) }))
vi.mock('@/composables/Client/SMRepositoryClient', () => ({ useSMRepositoryClient: () => ({ getSmEndpointById: (id: string) => `sm/${id}`, postSubmodel: async (sm: any) => write(`sm/${sm.id}`, sm), putSubmodel: async (sm: any) => write(`sm/${sm.id}`, sm) }) }))
function write (path: string, value: any) {
  if (state.writes.length >= state.failAfter) {
    return false
  }
  state.writes.push(path)
  state.documents.set(path, jsonization.toJsonable(value))
  return true
}
function seed () {
  const model = newProduct('vial', 'Reference', 'urn:reference')
  state.documents.set(`shell/${model.shell.id}`, clone(model.shell))
  for (const sm of model.submodels) {
    state.documents.set(`sm/${sm.id}`, clone(sm))
  }
  return model
}
beforeEach(() => {
  state.documents.clear()
  state.writes = []
  state.failAfter = Infinity
  state.editing = true
})
describe('Configurator repository writes', () => {
  it('writes only changed documents and reads the saved model back', async () => {
    const before = seed(), draft = clone(before)
    setParameter(draft, properties(draft).find(node => node.idShort === 'FillVolume')!, '1.5')
    const saved = await useRepository().save([draft], [before])
    expect(state.writes).toHaveLength(3)
    expect(state.writes.some(path => path.includes('process-plan'))).toBe(false)
    expect(canonical(saved[0]) === canonical(draft)).toBe(true)
  })
  it('preflights a mixed creation and update batch without recreating existing documents', async () => {
    const before = seed(), draft = clone(before)
    draft.shell.displayName = [{ language: 'en', text: 'Edited reference' }]
    const fresh = newProduct('syringe', 'New syringe', 'urn:new:syringe')
    const result = await useRepository().save([draft, fresh], [before], true)
    expect(result).toHaveLength(2)
    expect(state.writes.filter(path => path === `shell/${before.shell.id}`)).toHaveLength(1)
    expect(state.writes.filter(path => path.startsWith('sm/urn:reference'))).toHaveLength(0)
  })
  it('refuses stale drafts before making any writes', async () => {
    const before = seed(), draft = clone(before)
    draft.shell.displayName = [{ language: 'en', text: 'Draft' }]
    state.documents.get(`shell/${before.shell.id}`).description = [{ language: 'en', text: 'External change' }]
    await expect(useRepository().save([draft], [before])).rejects.toThrow('changed in the repository')
    expect(state.writes).toHaveLength(0)
  })
  it('creates a product without replacing an existing identifier', async () => {
    const model = newProduct('cartridge', 'New cartridge', 'urn:new')
    const saved = await useRepository().save([model], [], true)
    expect(canonical(saved[0]) === canonical(model)).toBe(true)
    const count = state.writes.length
    await expect(useRepository().save([model], [], true)).rejects.toThrow('already exists')
    expect(state.writes).toHaveLength(count)
  })
  it('reports partial writes and never presents them as success', async () => {
    state.failAfter = 1
    await expect(useRepository().save([newProduct('vial', 'New', 'urn:new')], [], true)).rejects.toThrow('1 document(s) were saved')
    expect(state.documents.has('shell/urn:new')).toBe(false)
  })
  it('honors read-only feature control before writing', async () => {
    state.editing = false
    await expect(useRepository().save([newProduct('vial', 'New', 'urn:new')], [], true)).rejects.toThrow('disabled')
    expect(state.writes).toHaveLength(0)
  })
})

it('publishes and reads back without registry descriptors, only while its referenced models still match the reviewed versions', async () => {
  const product = seed()
  const system = clone(product)
  system.shell.id = 'urn:line'
  state.documents.set(`shell/${system.shell.id}`, clone(system.shell))
  const order = createOrder({ name: 'Test run', quantity: '10', product, system })
  const saved = await useRepository().save([order], [product, system], true)
  expect(saved[0]!.shell.id).toBe(order.shell.id)
  expect(state.writes).toHaveLength(2)
  state.writes = []
  state.documents.get(`shell/${product.shell.id}`).idShort = 'Changed'
  const second = createOrder({ name: 'Second run', quantity: '20', product, system })
  await expect(useRepository().save([second], [product, system], true)).rejects.toThrow('changed in the repository')
  expect(state.writes).toHaveLength(0)
})
