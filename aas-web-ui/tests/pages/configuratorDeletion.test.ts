import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { canonical, children, entry, field, newPart, newProduct, parts, removePart, resolve, submodel, walk } from '../../src/pages/modules/Configurator/model'

describe('Product component deletion', () => {
  it.each(['vial', 'syringe', 'cartridge'])('removes %s material uses without changing recipe steps or the original model', family => {
    const model = newProduct(family, 'Product', 'urn:test:delete')
    const before = canonical(model)
    const liquid = parts(model).find(part => part.node.idShort === 'Liquid')!
    const sequence = canonical(submodel(model, 'ProductionSequence'))
    const next = removePart(model, liquid.path)
    expect(canonical(model)).toBe(before)
    expect(parts(next).some(part => part.node.idShort === 'Liquid')).toBe(false)
    expect(canonical(submodel(next, 'ProductionSequence'))).toBe(sequence)
    for (const sm of next.submodels) {
      expect(jsonization.submodelFromJsonable(sm as never).error).toBeNull()
    }
    for (const use of walk(submodel(next, 'ProcessParameters'))) {
      const ref = field(use, 'MaterialReference')?.value
      if (ref) {
        expect(resolve(next, ref)).toBeDefined()
      }
    }
    const oldUses = walk(submodel(model, 'ProcessParameters')).filter(node => resolve(model, field(node, 'MaterialReference')?.value) === liquid.node)
    expect(oldUses.length).toBeGreaterThan(0)
    for (const use of oldUses) {
      expect(walk(submodel(next, 'ProcessParameters')).some(node => canonical(node) === canonical(use))).toBe(false)
    }
  })
  it('deletes nested parts as a subtree and leaves siblings intact', () => {
    const model = newProduct('vial', 'Product', 'urn:test:delete')
    const parent = parts(model)[0]!
    children(parent.node).push(newPart('Cap', 'Nested cap', '1', 'piece'))
    const next = removePart(model, parent.path)
    expect(parts(next)).toHaveLength(3)
    expect(parts(next).some(part => part.node.displayName?.[0]?.text === 'Nested cap')).toBe(false)
    expect(parts(model)).toHaveLength(5)
  })
  it('rejects other dependent references atomically', () => {
    const model = newProduct('vial', 'Product', 'urn:test:delete')
    const part = parts(model)[0]!
    children(entry(model)).push({ modelType: 'ReferenceElement', idShort: 'CustomDependency', value: { type: 'ModelReference', keys: [{ type: 'Submodel', value: submodel(model, 'HierarchicalStructures')!.id }, ...part.path.map(value => ({ type: 'Entity', value }))] } })
    const before = canonical(model)
    expect(() => removePart(model, part.path)).toThrow('other AAS references')
    expect(canonical(model)).toBe(before)
    expect(() => removePart(model, ['EntryNode', 'Missing'])).toThrow('no longer exists')
  })
})
