import type { Model } from './model'
import { children, field, resolve, submodel } from './model'
const reference = (type: string, value: string) => ({ type: 'ModelReference', keys: [{ type, value }] })
const value = (node: any, name: string) => field(node, name)?.value
export interface OrderInput { name: string, quantity: string, product?: Model, system?: Model }
export function orderError ({ name, quantity, product, system }: OrderInput): string {
  if (!name.trim()) {
    return 'Enter an order name.'
  }
  if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) {
    return 'Quantity must be a positive whole number.'
  }
  const steps = children(field(product && submodel(product, 'ProductionSequence'), 'Steps'))
  if (!product || steps.length === 0 || steps.some(step => !resolve(product, field(step, 'ProcessReference')?.value))) {
    return 'Select a product with a complete production sequence.'
  }
  if (!system || !submodel(system, 'HierarchicalStructures')) {
    return 'Select a line with a saved module composition.'
  }
  return ''
}

// Application-owned contract: a production request, not an execution command.
export const ORDER_SCHEMA = 'production-order/1.0'
const property = (idShort: string, value: string, valueType = 'xs:string') => ({ modelType: 'Property', idShort, value: String(value), valueType })
const link = (idShort: string, type: string, id: string) => ({ modelType: 'ReferenceElement', idShort, value: reference(type, id) })
export function createOrder (input: OrderInput, token = crypto.randomUUID(), timestamp = new Date().toISOString()): Model {
  const error = orderError(input)
  if (error) {
    throw new Error(error)
  }
  const { name, quantity } = input
  const product = input.product!, system = input.system!
  const hierarchy = submodel(system, 'HierarchicalStructures')!
  const aasId = `https://smartproductionlab.aau.dk/aas/orders/${token}`
  const submodelId = `${aasId}/submodels/OrderInformation`
  return {
    shell: {
      modelType: 'AssetAdministrationShell', id: aasId, idShort: `Order_${token.replace(/-/g, '_')}`,
      displayName: [{ language: 'en', text: name.trim() }],
      assetInformation: { assetKind: 'Instance', assetType: 'ProductionOrder', globalAssetId: `https://smartproductionlab.aau.dk/assets/orders/${token}` },
      submodels: [reference('Submodel', submodelId)],
    },
    submodels: [{ modelType: 'Submodel', id: submodelId, idShort: 'OrderInformation', kind: 'Instance',
      submodelElements: [property('Schema', ORDER_SCHEMA), property('OrderId', token), property('Name', name.trim()),
        property('Quantity', String(Number(quantity)), 'xs:positiveInteger'), property('CreatedAt', timestamp, 'xs:dateTime'), property('Status', 'Created'),
        link('Product', 'AssetAdministrationShell', product.shell.id), link('ProductionSystem', 'AssetAdministrationShell', system.shell.id),
        link('ProductionSequence', 'Submodel', submodel(product, 'ProductionSequence')!.id), link('SystemComposition', 'Submodel', hierarchy.id)],
    }],
  }
}
export function orderDetails (model: Model) {
  const sm = submodel(model, 'OrderInformation')
  return { name: value(sm, 'Name'), quantity: value(sm, 'Quantity'), status: value(sm, 'Status'), createdAt: value(sm, 'CreatedAt'),
    productId: value(sm, 'Product')?.keys?.[0]?.value, systemId: value(sm, 'ProductionSystem')?.keys?.[0]?.value }
}
