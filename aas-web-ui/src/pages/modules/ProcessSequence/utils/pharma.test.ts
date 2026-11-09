import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { buildPharmaDemo, PHARMA_RECIPES } from '../demo/pharma'
import { buildDemo } from '../demo/seed'
import template from '../templates/ProductionSequence.json'
import { flattenNodes, parsePlan } from './plan'
import { readPlanProcesses } from './planSources'
import { readSkillCatalog } from './readers'
import { buildSequenceSubmodel, readSequenceSubmodel } from './sequenceModel'

const demo = buildPharmaDemo(id => `${id}/sequence`)

describe('pharma recipes and structured sequence', () => {
  it('creates valid AAS shells and submodels with resolvable submodel references', () => {
    expect(jsonization.submodelFromJsonable(template as never).error).toBeNull()
    expect(template.kind).toBe('Template')
    for (const shell of demo.shells) {
      expect(jsonization.assetAdministrationShellFromJsonable(shell as never).error, shell.id).toBeNull()
      for (const reference of shell.submodels) {
        expect(demo.submodels.some(model => model.id === reference.keys[0].value)).toBe(true)
      }
    }
    for (const model of demo.submodels) {
      expect(jsonization.submodelFromJsonable(model as never).error, model.id).toBeNull()
    }
  })

  it('round trips empty, recipe, subprocess and parallel plans through native AAS elements', () => {
    for (const plan of [...demo.plans, buildDemo().plan, ...buildDemo().plans]) {
      const model = buildSequenceSubmodel(plan, `${plan.productAasId}/sequence`)
      expect(jsonization.submodelFromJsonable(model as never).error).toBeNull()
      const loaded = parsePlan(JSON.stringify(readSequenceSubmodel(model)), plan.productAasId)
      // Live BoM metadata is resolved separately and is not stored in a sequence.
      const definition = structuredClone(plan)
      for (const scope of definition.scopes) {
        if (scope.material) {
          delete scope.material.bulkCount
          delete scope.material.bulkCountWarning
        }
      }
      expect(loaded).toEqual(parsePlan(JSON.stringify(definition), plan.productAasId))
      expect(model.submodelElements.some((element: { modelType: string }) => element.modelType === 'File')).toBe(false)
    }
  })

  it('uses the prescribed cycle order and the same parameters as the IDTA process reader', () => {
    for (const recipe of PHARMA_RECIPES) {
      const plan = demo.plans.find(plan => plan.productAasId.endsWith(`/aas/${recipe.id}`))!
      const steps = flattenNodes(plan.scopes[0].nodes).filter(node => node.kind === 'step')
      expect(steps.map(step => step.id)).toEqual(['Unpacking', 'Loading', ...recipe.volume.flatMap((_, index) => [`Filling_${index + 1}`, `Stoppering_${index + 1}`]), ...(recipe.format === 'vial' ? ['Capping'] : []), 'Inspection', 'Unloading', 'Packing'])
      for (const step of steps) {
        if (step.kind !== 'step') {
          throw new Error('Expected operation')
        }
        const model = demo.submodels.find(model => model.id === step.process!.source.submodelId)!
        expect(readPlanProcesses(model, plan.productAasId).find(process => process.processId === step.id)).toEqual(step.process)
        if (step.executionMode === 'manual') {
          expect(step.resourceAasId).toBe('')
          continue
        }
        const skillModel = demo.submodels.find(model => model.id === step.skillReference!.keys[0].value)!
        expect(readSkillCatalog(skillModel).byIdShort.has(step.skillId)).toBe(true)
      }
    }
  })
})
