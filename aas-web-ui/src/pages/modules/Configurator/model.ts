import type { AasElement } from '../ProcessSequence/utils/sequenceModel'
import { readCapabilities } from '../ProcessSequence/utils/capabilities'
import cartridge from './templates/Cartridge3mLAAS.json'
import syringe from './templates/PrefilledSyringe1mLAAS.json'
import vial from './templates/Vial2mLAAS.json'

export type Element = AasElement
export interface Model { shell: Element, submodels: Element[] }
// JSON cloning also unwraps nested Vue proxies in AAS JSON documents.
// eslint-disable-next-line unicorn/prefer-structured-clone
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export const children = (node?: Element): Element[] => node?.submodelElements ?? node?.statements ?? (Array.isArray(node?.value) ? node.value : [])
export const semantic = (node?: Element): string => node?.semanticId?.keys?.[0]?.value ?? ''
export const label = (node?: Element): string => node?.displayName?.find((item: Element) => item.language === 'en')?.text ?? node?.idShort ?? node?.id ?? ''
export const field = (node: Element | undefined, name: string): Element | undefined => children(node).find(item => item.idShort === name)
export const walk = (node?: Element): Element[] => node ? [node, ...children(node).flatMap(item => walk(item))] : []
export const submodel = (model: Model, name: string): Element | undefined => model.submodels.find(item => semantic(item).includes(`/${name}/`)) ?? model.submodels.find(item => item.idShort === name)
export const entry = (model: Model): Element | undefined => children(submodel(model, 'HierarchicalStructures')).find(item => item.modelType === 'Entity')
export const kind = (model: Model): string => String(model.shell.assetInformation?.assetType ?? '').split('/Resource/').at(-1) ?? ''
export const asset = (model: Model): string => model.shell.assetInformation?.globalAssetId ?? ''
export const isProduct = (model: Model): boolean => Boolean(submodel(model, 'ProcessParameters'))
export const meanings = (node: Element): string[] => (node.supplementalSemanticIds ?? []).flatMap((ref: Element) => ref.keys?.map((key: Element) => key.value) ?? [])
export const hasMeaning = (node: Element, name: string): boolean => meanings(node).some(id => id.endsWith(`/${name}`))
export const offers = (model: Model) => model.submodels.flatMap(sm => readCapabilities(sm, model.shell.id)).filter(cap => cap.role === 'Offered')
export const families = [{ id: 'vial', name: 'Vial 2 mL' }, { id: 'syringe', name: 'Prefilled syringe 1 mL' }, { id: 'cartridge', name: 'Cartridge 3 mL' }]
const templates: Record<string, Element> = { vial, syringe, cartridge }
export function newProduct (family: string, name: string, id: string, reference?: Model): Model {
  if (!name.trim() || !id.trim() || !templates[family]) {
    throw new Error('Choose a family and enter a name and unique AAS identifier.')
  }
  const template = reference ? { assetAdministrationShells: [reference.shell], submodels: reference.submodels } : templates[family]!
  const shell = template.assetAdministrationShells[0]
  const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(id))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const ids = new Map<string, string>([[shell.id, id], [shell.assetInformation.globalAssetId, `${id}/asset`]])
  for (const sm of template.submodels) {
    ids.set(sm.id, semantic(sm).includes('/ProductionSequence/') ? `https://smartproductionlab.aau.dk/sm/process-plan/${encoded}` : `${id}/submodels/${sm.idShort}`)
  }
  function remap (value: any): any {
    if (typeof value === 'string') {
      return ids.get(value) ?? value
    }
    if (Array.isArray(value)) {
      return value.map(item => remap(item))
    }
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)])) : value
  }
  const model: Model = { shell: remap(shell), submodels: remap(template.submodels) }
  model.shell.idShort = `Product_${crypto.randomUUID().replaceAll('-', '')}`
  model.shell.displayName = [{ language: 'en', text: name.trim() }]
  const root = entry(model)
  if (root) {
    root.displayName = clone(model.shell.displayName)
  }
  const designation = field(submodel(model, 'Nameplate'), 'ManufacturerProductDesignation')
  if (designation) {
    designation.value = clone(model.shell.displayName)
  }
  return model
}

export function newPart (type: string, name: string, quantity: string, unit: string): Element {
  if (!name.trim() || !quantity.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) < 0 || !unit.trim()) {
    throw new Error('Enter a name, a non-negative quantity and a unit.')
  }
  const ref = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
  return {
    modelType: 'Entity', entityType: 'CoManagedEntity',
    idShort: `${type.replaceAll(/\W/g, '') || 'Component'}_${crypto.randomUUID().replaceAll('-', '')}`,
    displayName: [{ language: 'en', text: name.trim() }],
    semanticId: ref('https://admin-shell.io/idta/HierarchicalStructures/Node/1/0'),
    statements: [
      { modelType: 'Property', idShort: 'Quantity', value: quantity, valueType: 'xs:double', semanticId: ref('https://smartproductionlab.aau.dk/semantics/Quantity') },
      { modelType: 'Property', idShort: 'QuantityUnit', value: unit.trim(), valueType: 'xs:string', semanticId: ref('https://smartproductionlab.aau.dk/semantics/QuantityUnit') },
    ],
  }
}

export function newSystem (name: string, id: string, table: Model): Model {
  if (!name.trim() || !id.trim() || !coordinate(table, 'TableBase') || !asset(table)) {
    throw new Error('Enter a name and identifier and select a planar table.')
  }
  const ref = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
  const hierarchyId = `${id}/submodels/HierarchicalStructures`
  const model: Model = {
    shell: { modelType: 'AssetAdministrationShell', id, idShort: `Line_${crypto.randomUUID().replaceAll('-', '')}`, displayName: [{ language: 'en', text: name.trim() }], assetInformation: { assetKind: 'Instance', assetType: 'https://smartproductionlab.aau.dk/Resource/System', globalAssetId: `${id}/asset` }, submodels: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: hierarchyId }] }] },
    submodels: [{ modelType: 'Submodel', id: hierarchyId, idShort: 'HierarchicalStructures', kind: 'Instance', semanticId: ref('https://admin-shell.io/idta/HierarchicalStructures/1/1/Submodel'), submodelElements: [
      { modelType: 'Entity', idShort: 'EntryNode', entityType: 'SelfManagedEntity', globalAssetId: `${id}/asset`, semanticId: ref('https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0'), statements: [] },
      { modelType: 'Property', idShort: 'ArcheType', valueType: 'xs:string', value: 'OneDown', semanticId: ref('https://admin-shell.io/idta/HierarchicalStructures/ArcheType/1/0') },
    ] }],
  }
  addMember(model, table)
  return model
}

export interface Part { node: Element, path: string[], depth: number }
export function parts (model: Model): Part[] {
  function visit (node: Element, path: string[], depth: number): Part[] {
    return children(node).filter(item => item.modelType === 'Entity').flatMap(item => {
      const next = [...path, item.idShort]
      return [{ node: item, path: next, depth }, ...visit(item, next, depth + 1)]
    })
  }
  const root = entry(model)
  return root ? visit(root, [root.idShort], 0) : []
}
// Stored component order follows assembly from base to closure. Render top-to-bottom
// in reverse, without rewriting the bill of material or production recipe.
export const assemblyParts = (model: Model): Part[] => parts(model).toReversed()

/** Remove a component subtree and its known material uses, without leaving dangling references. */
export function removePart (model: Model, path: string[]): Model {
  const next = clone(model)
  const hierarchy = submodel(next, 'HierarchicalStructures')
  const target = parts(next).find(part => canonical(part.path) === canonical(path))
  if (!target || !hierarchy) {
    throw new Error('The component no longer exists. Reopen the product.')
  }
  const removed = new Set(walk(target.node))
  const pointsToRemoved = (ref?: Element) => removed.has(resolve(next, ref)!)
  // Only process material uses and hierarchy relationships are safe to remove automatically.
  for (const bom of walk(submodel(next, 'ProcessParameters')).filter(node => node.idShort === 'ProcessBoM')) {
    for (const use of children(bom)) {
      if (use.modelType === 'SubmodelElementCollection' && pointsToRemoved(field(use, 'MaterialReference')?.value)) {
        for (const node of walk(use)) {
          removed.add(node)
        }
      }
    }
  }
  for (const node of walk(hierarchy)) {
    if (node.modelType === 'RelationshipElement' && (pointsToRemoved(node.first) || pointsToRemoved(node.second))) {
      removed.add(node)
    }
  }
  const references: { ref: Element, target: Element }[] = []
  function inspect (value: any) {
    if (!value || typeof value !== 'object' || removed.has(value)) {
      return
    }
    if (value.type === 'ModelReference') {
      const target = resolve(next, value)
      if (target) {
        references.push({ ref: value, target })
      }
    }
    for (const child of Object.values(value)) {
      inspect(child)
    }
  }
  inspect(next)
  if (references.some(reference => removed.has(reference.target))) {
    throw new Error('This component has other AAS references. Update those references before deleting it.')
  }
  function prune (node: Element) {
    const members = children(node)
    for (let i = members.length - 1; i >= 0; i--) {
      if (removed.has(members[i]!)) {
        members.splice(i, 1)
      } else {
        prune(members[i]!)
      }
    }
  }
  for (const sm of next.submodels) {
    prune(sm)
  }
  return next
}

export function shape (part: Part, _model: Model): string {
  const name = `${part.node.idShort} ${label(part.node)}`.toLowerCase()
  if (/liquid/.test(name)) {
    return 'liquid'
  }
  if (/stopper|piston/.test(name)) {
    return 'stopper'
  }
  if (/cap/.test(name)) {
    return 'cap'
  }
  if (/barrel|syringe/.test(name)) {
    return 'syringe'
  }
  if (/cartridge/.test(name)) {
    return 'cartridge'
  }
  if (/vial/.test(name)) {
    return 'vial'
  }
  return 'generic'
}
export const properties = (model: Model): Element[] => walk(submodel(model, 'ProcessParameters')).filter(node => node.modelType === 'Property' && node.value !== undefined)
export function resolve (model: Model, reference?: Element): Element | undefined {
  const keys = reference?.keys ?? []
  let node = model.submodels.find(sm => sm.id === keys[0]?.value)
  for (const key of keys.slice(1)) {
    node = field(node, key.value)
  }
  return node
}
export function setParameter (model: Model, node: Element, next: string): void {
  const meaning = semantic(node)
  if (/double|float|decimal|integer|int$/.test(node.valueType ?? '') && (!next.trim() || !Number.isFinite(Number(next)))) {
    throw new Error('Enter a finite numeric value.')
  }
  node.value = next
  // The same product fact can be used by multiple processes and required capabilities.
  if (meaning.startsWith('https://smartproductionlab.aau.dk/semantics/')) {
    for (const item of [...properties(model), ...walk(submodel(model, 'CapabilityDescription'))]) {
      if (item.modelType === 'Property' && (semantic(item) === meaning || meanings(item).includes(meaning))) {
        item.value = next
      }
    }
    for (const use of walk(submodel(model, 'ProcessParameters'))) {
      const parameter = resolve(model, field(use, 'QuantityParameterReference')?.value)
      const material = resolve(model, field(use, 'MaterialReference')?.value)
      const quantity = field(material, 'Quantity')
      if (parameter && semantic(parameter) === meaning && quantity) {
        quantity.value = next
      }
    }
  }
}

export function coordinate (model: Model, meaning: string): { sm: Element, node: Element, path: string[] } | undefined {
  function find (node: Element, path: string[]): { node: Element, path: string[] } | undefined {
    if (hasMeaning(node, meaning)) {
      return { node, path }
    }
    for (const child of children(node)) {
      const found = find(child, [...path, child.idShort])
      if (found) {
        return found
      }
    }
  }
  const sm = submodel(model, 'Variables')
  const measurements = field(sm, 'Measurements')
  const coordinates = field(measurements, 'Coordinates')
  if (sm && measurements && coordinates) {
    const found = find(coordinates, [measurements.idShort, coordinates.idShort])
    if (found) {
      return { sm, ...found }
    }
  }
}
export function coordinateRef (model: Model, meaning: string): Element {
  const found = coordinate(model, meaning)
  if (!found) {
    throw new Error(`${label(model.shell)} has no ${meaning} coordinate.`)
  }
  return { type: 'ModelReference', keys: [{ type: 'Submodel', value: found.sm.id }, ...found.path.map(value => ({ type: 'SubmodelElementCollection', value }))] }
}
export interface Pose { x: number, y: number, yaw: number }
export function pose (model: Model, table: Model): Pose | undefined {
  const found = coordinate(model, 'ModuleBase')
  if (!found) {
    return
  }
  const relative = field(found.node, 'RelativeTo')?.value
  const target = coordinateRef(table, 'TableBase')
  if (canonical(relative?.keys) !== canonical(target.keys)) {
    return
  }
  const values = ['X', 'Y', 'Yaw'].map(name => Number(field(found.node, name)?.value))
  if (!values.every(value => Number.isFinite(value))) {
    return
  }
  return { x: values[0]!, y: values[1]!, yaw: values[2]! }
}
export function place (model: Model, table: Model, next: Pose): void {
  const found = coordinate(model, 'ModuleBase')
  if (!found || !Object.values(next).every(value => Number.isFinite(value))) {
    throw new Error('This resource needs a valid ModuleBase coordinate before it can be placed.')
  }
  const reference = coordinateRef(table, 'TableBase')
  const updates = Object.entries({ X: next.x, Y: next.y, Yaw: next.yaw }).map(([name, value]) => {
    const property = field(found.node, name)
    if (!property) {
      throw new Error(`ModuleBase is missing ${name}.`)
    }
    return { property, value: String(value) }
  })
  for (const update of updates) {
    update.property.value = update.value
  }
  const relative = field(found.node, 'RelativeTo')
  if (relative) {
    relative.value = reference
  } else {
    found.node.value.push({ modelType: 'ReferenceElement', idShort: 'RelativeTo', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://smartproductionlab.aau.dk/variables/Coordinate/RelativeTo/1/0' }] }, value: reference })
  }
}
export function addMember (system: Model, module: Model): void {
  const root = entry(system)
  if (!root || !asset(module)) {
    throw new Error('The system needs a hierarchy and the module needs an asset identifier.')
  }
  if (children(root).some(node => node.globalAssetId === asset(module))) {
    return
  }
  const idShort = `Module_${crypto.randomUUID().replaceAll('-', '')}`
  root.statements ??= []
  root.statements.push({ modelType: 'Entity', entityType: 'SelfManagedEntity', idShort, globalAssetId: asset(module), displayName: [{ language: 'en', text: label(module.shell) }], semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/HierarchicalStructures/Node/1/0' }] }, statements: [] })
}
export function canonical (value: any): string {
  return JSON.stringify(value, (_key, item) => {
    if (item?.shell && Array.isArray(item.submodels)) {
      item = { ...item, submodels: item.submodels.toSorted((a: Element, b: Element) => a.id.localeCompare(b.id)) }
    }
    return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b))) : item
  })
}

/** The table's frame as its PMC is set up (the table's Parameters: Columns, Rows, FlywaySize in mm),
 * which the planar side reports; the configurator only reads it. Undefined for a table without it. */
export function tableSize (table: Model): { columns: number, rows: number, flyway: number } | undefined {
  const value = (name: string) => Number(field(field(submodel(table, 'Parameters'), name), 'Value')?.value)
  const [columns, rows, flyway] = [value('Columns'), value('Rows'), value('FlywaySize')]
  return [columns, rows, flyway].every(v => Number.isFinite(v) && v > 0) && Number.isInteger(columns) && Number.isInteger(rows) ? { columns, rows, flyway } : undefined
}
/** The flyways' centres (the table's measured Flyway coordinates) in the table's frame. A position of
 * the frame without a flyway is a hole. Without the frame, it is taken to end at the outermost flyways. */
export function tableGeometry (table: Model) {
  const cells = walk(field(field(submodel(table, 'Variables'), 'Measurements'), 'Coordinates')).filter(node => hasMeaning(node, 'Flyway') && node.modelType === 'SubmodelElementCollection').map(node => ({ x: Number(field(node, 'X')?.value), y: Number(field(node, 'Y')?.value) }))
  if (cells.length === 0 || cells.some(cell => !Number.isFinite(cell.x) || !Number.isFinite(cell.y))) {
    return
  }
  const size = tableSize(table)
  const pitch = size?.flyway ?? Math.min(...cells.flatMap(cell => [cell.x, cell.y]).filter(value => value > 0)) * 2
  if (!(pitch > 0) || cells.some(cell => [cell.x, cell.y].some(value => Math.abs(value / pitch - 0.5 - Math.round(value / pitch - 0.5)) > 0.001))) {
    return
  }
  const columns = size?.columns ?? Math.round(Math.max(...cells.map(cell => cell.x)) / pitch + 0.5)
  const rows = size?.rows ?? Math.round(Math.max(...cells.map(cell => cell.y)) / pitch + 0.5)
  if (cells.some(cell => cell.x > columns * pitch || cell.y > rows * pitch)) {
    return
  }
  return { cells, pitch, columns, rows, width: columns * pitch, height: rows * pitch, measured: Boolean(size) }
}
/** The table for routing: its frame, the slots one xbot wide (two by two per flyway) and which positions hold a flyway. */
export function tableFrame (table: Model) {
  const g = tableGeometry(table)
  return g && { columns: g.columns, rows: g.rows, flyway: g.pitch, slot: g.pitch / 2, flyways: new Set(g.cells.map(cell => `${Math.floor(cell.x / g.pitch)},${Math.floor(cell.y / g.pitch)}`)) }
}
export function perimeterPose (x: number, y: number, width: number, height: number, pitch: number): Pose | undefined {
  if (x > 0 && x < width && y > 0 && y < height) {
    return
  }
  if (x < -pitch || x > width + pitch || y < -pitch || y > height + pitch) {
    return
  }
  const snap = (value: number, max: number) => Math.max(pitch / 2, Math.min(max - pitch / 2, Math.round(value / (pitch / 4)) * pitch / 4))
  if (y >= height && x >= 0 && x <= width) {
    return { x: snap(x, width), y: height, yaw: 180 }
  }
  if (y <= 0 && x >= 0 && x <= width) {
    return { x: snap(x, width), y: 0, yaw: 0 }
  }
  if (x <= 0 && y >= 0 && y <= height) {
    return { x: 0, y: snap(y, height), yaw: -90 }
  }
  if (x >= width && y >= 0 && y <= height) {
    return { x: width, y: snap(y, height), yaw: 90 }
  }
}
export function moduleCenter (p: Pose, pitch: number): { x: number, y: number } {
  const radians = p.yaw * Math.PI / 180
  return { x: p.x + Math.sin(radians) * pitch / 2, y: p.y - Math.cos(radians) * pitch / 2 }
}
