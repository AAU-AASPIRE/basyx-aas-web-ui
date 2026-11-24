import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { clone, newProduct, submodel } from '../../src/pages/modules/Configurator/model'
import { createOrder, orderDetails, orderError } from '../../src/pages/modules/Configurator/orders'

const product = newProduct('vial', 'Vial', 'urn:product')
const system = { shell: { id: 'urn:line' }, submodels: [{ modelType: 'Submodel', id: 'urn:line:composition', idShort: 'HierarchicalStructures' }] }
const input = { name: 'Vial run', quantity: '100', product, system }
describe('Production orders', () => {
  it('creates the original application order contract with saved model references', () => {
    const order = createOrder(input)
    expect(jsonization.assetAdministrationShellFromJsonable(order.shell as never).error).toBeNull()
    expect(jsonization.submodelFromJsonable(order.submodels[0] as never).error).toBeNull()
    expect(orderDetails(order)).toMatchObject({ name: 'Vial run', quantity: '100', status: 'Created', productId: 'urn:product', systemId: 'urn:line' })
    const info = submodel(order, 'OrderInformation')!
    expect(info.submodelElements.find((node: any) => node.idShort === 'ProductionSequence').value.keys[0].value).toBe(submodel(product, 'ProductionSequence')!.id)
    expect(orderDetails(createOrder({ ...input, quantity: '1e3' })).quantity).toBe('1000')
    expect(createOrder(input).shell.id).not.toBe(order.shell.id)
  })
  it.each(['0', '-1', '1.2', '', 'NaN', 'Infinity', '9007199254740992'])('rejects invalid quantity %s', quantity => {
    expect(() => createOrder({ ...input, quantity })).toThrow('positive whole')
  })
  it('rejects missing references or incomplete recipes', () => {
    expect(orderError({ ...input, product: undefined })).toContain('complete production sequence')
    expect(orderError({ ...input, system: undefined })).toContain('composition')
    const broken = clone(product)
    broken.submodels = broken.submodels.filter(sm => sm.idShort !== 'ProcessParameters')
    expect(orderError({ ...input, product: broken })).toContain('complete production sequence')
    expect(orderError({ ...input, name: ' ' })).toContain('name')
  })
})
