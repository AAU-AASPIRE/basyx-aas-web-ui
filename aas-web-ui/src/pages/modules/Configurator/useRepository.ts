import type { Element, Model } from './model'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { useAASHandling } from '@/composables/AAS/AASHandling'
import { useAASRepositoryClient } from '@/composables/Client/AASRepositoryClient'
import { useSMRepositoryClient } from '@/composables/Client/SMRepositoryClient'
import { useRequestHandling } from '@/composables/RequestHandling'
import { useEnvStore } from '@/store/EnvironmentStore'
import { useInfrastructureStore } from '@/store/InfrastructureStore'
import { usesSubmodelSuperpath } from '@/utils/InfrastructureUtils'
import { canonical, coordinate, field, label, submodel } from './model'

/** Keep raw repository documents: viewer-enriched objects must never be written back. */
export function useRepository () {
  const infrastructure = useInfrastructureStore()
  const environment = useEnvStore()
  const { fetchAasList } = useAASHandling()
  // The catalog and writes target the selected repository. New shells cannot have
  // registry descriptors yet, and indexing may still be pending during readback.
  const { postAas, putAas, getAasEndpointById } = useAASRepositoryClient()
  const { getSmEndpointById, putSubmodel, postSubmodel, putSubmodelElement } = useSMRepositoryClient()
  const { getRequest, postRequest } = useRequestHandling()
  const identity = () => JSON.stringify([infrastructure.getSelectedInfrastructure?.id, infrastructure.getAASRepoURL, infrastructure.getSubmodelRepoURL])
  async function read (endpoint: string): Promise<Element> {
    if (!endpoint) {
      throw new Error('Configure the AAS and submodel repositories in Infrastructure settings.')
    }
    const result = await getRequest(endpoint, 'loading configurator models', true)
    if (!result.success || !result.data) {
      throw new Error(`Could not load ${endpoint}.`)
    }
    return result.data as Element
  }
  async function load (id: string): Promise<Model> {
    const shell = await read(await getAasEndpointById(id))
    const ids: string[] = (shell.submodels ?? []).map((ref: Element) => ref.keys?.find((key: Element) => key.type === 'Submodel')?.value).filter(Boolean)
    return { shell, submodels: await Promise.all(ids.map(sm => read(getSmEndpointById(sm, id)))) }
  }
  async function catalog (): Promise<{ models: Model[], failures: string[] }> {
    const shells = await fetchAasList()
    const results = await Promise.allSettled(shells.map(shell => load(shell.id)))
    return {
      models: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
      failures: results.flatMap((result, i) => result.status === 'rejected' ? [label(shells[i])] : []),
    }
  }
  async function checkOrderReferences (model: Model, baselines: Model[]) {
    const order = submodel(model, 'OrderInformation')
    if (order) {
      for (const name of ['Product', 'ProductionSystem']) {
        const id = field(order, name)?.value?.keys?.[0]?.value
        const baseline = baselines.find(model => model.shell.id === id)
        if (!baseline || canonical(await load(id)) !== canonical(baseline)) {
          throw new Error('The order product or line changed in the repository. Reload and review before placing the order.')
        }
      }
    }
  }
  const historyEndpoint = `${import.meta.env.BASE_URL}api/configurator/coordinates`
  async function historyEnabled (): Promise<boolean> {
    const result = await getRequest(`${historyEndpoint}/status`, 'checking coordinate history', true, undefined, { suppressStatuses: [404] })
    return result.success && result.data?.enabled === true
  }
  async function recordCoordinates (models: Model[]): Promise<number> {
    if (!environment.getAllowEditing) {
      throw new Error('Editing is disabled.')
    }
    if (!await historyEnabled()) {
      throw new Error('Coordinate history is not configured for this Web UI.')
    }
    let count = 0
    for (const model of models) {
      const expected = field(field(submodel(model, 'Variables'), 'Measurements'), 'Coordinates')
      if (!expected) {
        continue
      }
      const result = await postRequest(`${historyEndpoint}/sync`, JSON.stringify({ aasId: model.shell.id, repository: infrastructure.getAASRepoURL, expected }), new Headers({ 'Content-Type': 'application/json' }), 'recording coordinate history', true)
      if (!result.success) {
        throw new Error(result.data?.error ?? 'Coordinate history failed. Refresh and use Record coordinate history to retry; AAS changes may already be saved.')
      }
      count += result.data?.count ?? 0
    }
    return count
  }
  async function writeSubmodel (model: Model, sm: Parameters<typeof putSubmodel>[0], created: boolean, baseline?: Model): Promise<boolean> {
    // Coordinates share Variables with live data. Never replace that entire submodel.
    const base = !created && coordinate(model, 'ModuleBase')
    if (base && base.sm.id === sm.id) {
      const element = jsonization.submodelElementFromJsonable(base.node as never)
      const endpoint = `${getSmEndpointById(sm.id, model.shell.id)}/submodel-elements/${base.path.map(segment => encodeURIComponent(segment)).join('.')}`
      return await putSubmodelElement(element.mustValue(), endpoint, true)
    }
    // A submodel new to an existing model (a line's first Parameters) is created; the shell's
    // reference to it is written with the shell.
    const fresh = created || !baseline?.submodels.some(old => old.id === sm.id)
    return fresh ? await postSubmodel(sm, true, model.shell.id) : await putSubmodel(sm, true, model.shell.id)
  }
  async function save (drafts: Model[], baselines: Model[], created = false): Promise<Model[]> {
    if (!environment.getAllowEditing || (created && !environment.getAllowUploading)) {
      throw new Error('Editing or creation is disabled for this account.')
    }
    const start = identity()
    const guard = () => {
      if (identity() !== start || !environment.getAllowEditing) {
        throw new Error('Infrastructure or editing permissions changed. Reload before saving.')
      }
    }
    const parsed = drafts.map(model => {
      const shell = jsonization.assetAdministrationShellFromJsonable(model.shell as never)
      if (shell.error) {
        throw new Error(`Invalid AAS: ${shell.error.message}`)
      }
      const submodels = model.submodels.map(sm => {
        const parsed = jsonization.submodelFromJsonable(sm as never)
        if (parsed.error) {
          throw new Error(`${label(sm)}: ${parsed.error.message}`)
        }
        return parsed.mustValue()
      })
      const baseline = baselines.find(old => old.shell.id === model.shell.id)
      return { model, shell: shell.mustValue(), submodels, baseline, created: created && !baseline }
    })
    // Preflight the entire change set before the first write. AAS repositories are not transactional.
    for (const item of parsed) {
      if (item.created) {
        if (usesSubmodelSuperpath(infrastructure.getSelectedInfrastructure)) {
          throw new Error('Creating AASs currently requires a separate submodel repository endpoint.')
        }
        await checkOrderReferences(item.model, baselines)
        const endpoints = [await getAasEndpointById(item.model.shell.id), ...item.model.submodels.map(sm => getSmEndpointById(sm.id, item.model.shell.id))]
        for (const endpoint of endpoints) {
          const result = await getRequest(endpoint, 'checking new identifiers', true, undefined, { suppressStatuses: [404] })
          if (result.success) {
            throw new Error('This identifier already exists. Choose another identifier.')
          }
          if (result.status !== 404) {
            throw new Error('Could not verify that the new identifiers are unused.')
          }
        }
      } else if (!item.baseline || canonical(await load(item.model.shell.id)) !== canonical(item.baseline)) {
        throw new Error(`${label(item.model.shell)} changed in the repository. Reload before saving.`)
      }
    }
    let writes = 0
    try {
      for (const item of parsed) {
        const baseline = baselines.find(model => model.shell.id === item.model.shell.id)
        for (const [index, sm] of item.submodels.entries()) {
          if (!item.created && canonical(item.model.submodels[index]) === canonical(baseline?.submodels.find(old => old.id === sm.id))) {
            continue
          }
          guard()
          if (!await writeSubmodel(item.model, sm, item.created, baseline)) {
            throw new Error(`Could not save ${sm.idShort}.`)
          }
          writes++
        }
        if (item.created || canonical(item.model.shell) !== canonical(baseline?.shell)) {
          guard()
          if (!(item.created ? await postAas(item.shell, true) : await putAas(item.shell, true))) {
            throw new Error('Could not save the AAS shell.')
          }
          writes++
        }
      }
      guard()
      const saved = await Promise.all(drafts.map(model => load(model.shell.id)))
      const coordinates = saved.filter(model => {
        const current = field(field(submodel(model, 'Variables'), 'Measurements'), 'Coordinates')
        const baseline = baselines.find(old => old.shell.id === model.shell.id)
        return current && canonical(current) !== canonical(baseline && field(field(submodel(baseline, 'Variables'), 'Measurements'), 'Coordinates'))
      })
      if (coordinates.length > 0 && await historyEnabled()) {
        await recordCoordinates(coordinates)
        return await Promise.all(drafts.map(model => load(model.shell.id)))
      }
      return saved
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}${writes ? ` ${writes} document(s) were saved; reload and review the partial result before retrying.` : ''}`, { cause: error })
    }
  }
  return { catalog, load, save, recordCoordinates, getAasEndpointById, identity }
}
