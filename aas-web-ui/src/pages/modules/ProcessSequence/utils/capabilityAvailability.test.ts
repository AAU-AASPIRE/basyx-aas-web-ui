import { describe, expect, it } from 'vitest'
import { readCapabilities } from './capabilities'

const FILLING = 'https://smartproductionlab.aau.dk/semantics/Filling'

describe('capabilities offered after a reconfiguration', () => {
  it('reads Availability from the capability', () => {
    const qualifiers = (availability?: string) => [
      { type: 'CapabilityRoleQualifier/Offered', valueType: 'xs:boolean', value: 'true', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Offered/1/0' }] } },
      ...(availability ? [{ type: 'Availability', valueType: 'xs:string', value: availability }] : []),
    ]
    const sem = (name: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: `https://admin-shell.io/idta/CapabilityDescription/${name}/1/0` }] })
    const container = (idShort: string, availability?: string) => ({
      modelType: 'SubmodelElementCollection', idShort, semanticId: sem('CapabilityContainer'),
      value: [{ modelType: 'Capability', idShort: 'Capability', semanticId: sem('Capability'), qualifiers: qualifiers(availability), supplementalSemanticIds: [{ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: FILLING }] }] }],
    })
    const submodel = {
      modelType: 'Submodel', id: 'module/submodels/CapabilityDescription',
      semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0' }] },
      submodelElements: [{ modelType: 'SubmodelElementCollection', idShort: 'OfferedCapabilities', semanticId: sem('CapabilitySet'), value: [container('Filling'), container('Filling_DoubleDose', 'AfterReconfiguration')] }],
    }
    expect(readCapabilities(submodel, 'module').map(item => [item.name, item.availability])).toEqual([['Filling', 'Now'], ['Filling_DoubleDose', 'AfterReconfiguration']])
  })
})
