import type { Element, Model } from '../../src/pages/modules/Configurator/model'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { addMember, assemblyParts, asset, canonical, children, clone, coordinate, coordinateRef, entry, field, moduleCenter, newPart, newProduct, newSystem, parts, perimeterPose, place, pose, properties, setParameter, tableGeometry } from '../../src/pages/modules/Configurator/model'

const property = (idShort: string, value: unknown) => ({ modelType: 'Property', idShort, value })
function point (name: string, x: number, y: number): Element {
  return { modelType: 'SubmodelElementCollection', idShort: name, supplementalSemanticIds: [{ keys: [{ value: `https://smartproductionlab.aau.dk/semantics/${name.startsWith('Flyway') ? 'Flyway' : name}` }] }], value: [property('X', String(x)), property('Y', String(y)), property('Yaw', '0'), { modelType: 'ReferenceElement', idShort: 'RelativeTo', value: { type: 'ModelReference', keys: [] } }] }
}
function resource (id: string, points: Element[]): Model {
  return { shell: { id, assetInformation: { assetType: 'https://smartproductionlab.aau.dk/Resource/Module', globalAssetId: `${id}/asset` } }, submodels: [{ id: `${id}/Variables`, idShort: 'Variables', submodelElements: [{ idShort: 'Measurements', value: [{ idShort: 'Coordinates', value: points }] }] }] }
}
const table = () => resource('table', [point('TableBase', 0, 0), ...Array.from({ length: 12 }, (_, i) => point(`Flyway_${i}`, (i % 4 + 0.5) * 240, (Math.floor(i / 4) + 0.5) * 240))])

describe('Configurator reference models and physical placement', () => {
  for (const family of ['vial', 'syringe', 'cartridge']) {
    it(`creates a valid independent ${family} AAS with internally remapped references`, () => {
      const id = `urn:test:${family}`
      const model = newProduct(family, 'My product', id)
      expect(jsonization.assetAdministrationShellFromJsonable(model.shell as never).error).toBeNull()
      for (const sm of model.submodels) {
        expect(jsonization.submodelFromJsonable(sm as never).error).toBeNull()
      }
      expect(model.shell.id).toBe(id)
      expect(asset(model)).toBe(`${id}/asset`)
      expect(parts(model).length).toBe(family === 'vial' ? 4 : 3)
      const ids = new Set([id, ...model.submodels.map(sm => sm.id)])
      function check (node: any) {
        if (!node || typeof node !== 'object') {
          return
        }
        if (node.type === 'ModelReference' && ['Submodel', 'AssetAdministrationShell'].includes(node.keys?.[0]?.type)) {
          expect(ids.has(node.keys[0].value)).toBe(true)
        }
        for (const item of Object.values(node)) {
          check(item)
        }
      }
      check(model)
    })
  }
  it('preserves the current server contract when creating an independent product', () => {
    const reference = newProduct('vial', 'Server reference', 'urn:server:vial')
    const volume = properties(reference).find(node => node.idShort === 'FillVolume')!
    setParameter(reference, volume, '1.8')
    const draft = newProduct('vial', 'New product', 'urn:new:vial', reference)
    expect(properties(draft).find(node => node.idShort === 'FillVolume')?.value).toBe('1.8')
    expect(JSON.stringify(draft)).not.toContain('urn:server:vial')
    const part = newPart('Stopper', 'Extra stopper', '1', 'piece')
    children(entry(draft)).push(part)
    expect(part.semanticId.keys[0].value).toContain('/HierarchicalStructures/Node/1/0')
    expect(jsonization.submodelFromJsonable(draft.submodels.find(sm => sm.idShort === 'HierarchicalStructures') as never).error).toBeNull()
    expect(parts(reference)).toHaveLength(4)
    expect(() => newPart('Liquid', 'Liquid', 'NaN', 'mL')).toThrow()
  })
  it('renders the assembly from cap to base without changing stored component or recipe order', () => {
    const model = newProduct('vial', 'Vial', 'urn:assembly')
    const before = canonical(model)
    expect(assemblyParts(model).map(part => part.node.idShort)).toEqual(['Cap', 'Stopper', 'Liquid', 'Vial'])
    expect(parts(model).map(part => part.node.idShort)).toEqual(['Vial', 'Liquid', 'Stopper', 'Cap'])
    expect(canonical(model)).toBe(before)
    children(parts(model)[0]!.node).push(newPart('Stopper', 'Nested', '1', 'piece'))
    const display = assemblyParts(model)
    expect(display.at(-1)?.node.idShort).toBe('Vial')
    expect(display.at(-2)?.depth).toBe(1)
    expect(display.at(-2)?.path.slice(0, -1)).toEqual(display.at(-1)?.path)
  })
  it('creates a line that references the existing table without copying resource identities', () => {
    const t = table()
    const before = canonical(t)
    const system = newSystem('New line', 'urn:new:line', t)
    expect(jsonization.assetAdministrationShellFromJsonable(system.shell as never).error).toBeNull()
    expect(jsonization.submodelFromJsonable(system.submodels[0] as never).error).toBeNull()
    expect(children(entry(system)).map(node => node.globalAssetId)).toEqual([asset(t)])
    expect(canonical(t)).toBe(before)
    expect(asset(system)).not.toBe(asset(t))
  })
  it('keeps fill volume consistent with process parameters, capabilities and liquid quantity', () => {
    const model = newProduct('vial', 'Vial', 'urn:test:vial')
    const volume = properties(model).find(node => node.idShort === 'FillVolume')!
    setParameter(model, volume, '1.5')
    expect(field(parts(model).find(part => part.node.idShort === 'Liquid')!.node, 'Quantity')?.value).toBe('1.5')
    expect(properties(model).filter(node => node.idShort === 'FillVolume').every(node => node.value === '1.5')).toBe(true)
    expect(() => setParameter(model, volume, 'not a number')).toThrow()
  })
  it('reads table dimensions from flyways and round-trips module coordinates without changing other points', () => {
    const t = table()
    expect(tableGeometry(t)).toMatchObject({ width: 960, height: 720, pitch: 240 })
    const m = resource('module', [point('ModuleBase', 0, 0), point('TransferPoint', 0, 60)])
    const transfer = canonical(coordinate(m, 'TransferPoint')?.node)
    expect(pose(m, t)).toBeUndefined()
    place(m, t, { x: 600, y: 720, yaw: 180 })
    expect(pose(m, t)).toEqual({ x: 600, y: 720, yaw: 180 })
    expect(field(coordinate(m, 'ModuleBase')!.node, 'RelativeTo')?.value).toEqual(coordinateRef(t, 'TableBase'))
    expect(canonical(coordinate(m, 'TransferPoint')?.node)).toBe(transfer)
    expect(pose(m, resource('other-table', [point('TableBase', 0, 0)]))).toBeUndefined()
  })
  it('rejects drops on the magnet surface and aligns square module footprints outside its edges', () => {
    expect(perimeterPose(400, 300, 960, 720, 240)).toBeUndefined()
    expect(perimeterPose(-1000, 300, 960, 720, 240)).toBeUndefined()
    expect(perimeterPose(610, 800, 960, 720, 240)).toEqual({ x: 600, y: 720, yaw: 180 })
    expect(moduleCenter({ x: 960, y: 360, yaw: 90 }, 240)).toEqual({ x: 1080, y: 360 })
  })
  it('attaches a previously unplaced module by adding its optional RelativeTo reference', () => {
    const base = point('ModuleBase', 0, 0)
    base.value = base.value.filter((node: Element) => node.idShort !== 'RelativeTo')
    const module = resource('unplaced', [base])
    place(module, table(), { x: 120, y: 720, yaw: 180 })
    expect(pose(module, table())).toEqual({ x: 120, y: 720, yaw: 180 })
    expect(field(base, 'RelativeTo')?.semanticId.keys[0].value).toContain('/Coordinate/RelativeTo/1/0')
  })
  it('leaves the draft untouched if a placement is invalid', () => {
    const base = point('ModuleBase', 0, 0)
    base.value = base.value.filter((node: Element) => node.idShort !== 'Yaw')
    const module = resource('incomplete', [base])
    const before = canonical(module)
    expect(() => place(module, table(), { x: 600, y: 720, yaw: 180 })).toThrow('missing Yaw')
    expect(canonical(module)).toBe(before)
  })
  it('preserves unresolved line members and does not add a resource twice', () => {
    const system = newProduct('vial', 'Line fixture', 'urn:test:line')
    const before = clone(children(entry(system)))
    const module = resource('module', [])
    addMember(system, module)
    addMember(system, module)
    expect(children(entry(system)).slice(0, before.length)).toEqual(before)
    expect(children(entry(system)).filter(node => node.globalAssetId === asset(module))).toHaveLength(1)
  })
})
