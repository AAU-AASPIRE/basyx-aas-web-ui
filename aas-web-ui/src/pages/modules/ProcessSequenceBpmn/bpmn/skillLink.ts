import type { PlanNode } from '../../ProcessSequence/types/plan'
import type { RouteLocationRaw } from 'vue-router'
import { useInfrastructureStore } from '@/store/InfrastructureStore'
import { base64Encode } from '@/utils/EncodeDecodeUtils'

/**
 * Where the skill a step runs is shown: the AAS viewer at the skill's element, which opens it in
 * the skill editor (BPMN or classic). A plan's step runs a module's skill; a skill's step runs a
 * component's skill. From a plan to a skill and down to its building blocks, in one notation.
 */
export function useSkillLink (): (node: PlanNode | undefined) => RouteLocationRaw | null {
  const infrastructure = useInfrastructureStore()
  return node => {
    const keys = node?.kind === 'step' ? node.skillReference?.keys : undefined
    if (node?.kind !== 'step' || !keys || keys[0]?.type !== 'Submodel' || keys.length < 2) {
      return null
    }
    // A component's AAS is named in its Skills submodel's id (.../submodels/...) when the step does not say.
    const aasId = node.resourceAasId || keys[0].value.replace(/\/submodels\/.*$/, '')
    const aasRepo = infrastructure.getAASRepoURL
    const submodelRepo = infrastructure.getSubmodelRepoURL
    if (!aasId || !aasRepo || !submodelRepo) {
      return null
    }
    const path = keys.slice(1).map(key => key.value).join('.')
    return {
      name: 'AASViewer',
      query: { aas: `${aasRepo}/${base64Encode(aasId)}`, path: `${submodelRepo}/${base64Encode(keys[0].value)}/submodel-elements/${path}` },
    }
  }
}
