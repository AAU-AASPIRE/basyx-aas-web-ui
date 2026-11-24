import type { Element, Model } from '../../src/pages/modules/Configurator/model'
import type { Routing } from '../../src/pages/modules/Configurator/routing'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonical, clone, field, newSystem, submodel, tableFrame, tableGeometry } from '../../src/pages/modules/Configurator/model'
import { problems, readRouting, ROUTING, routingUrl, spotOf, spotSlots, trace, writeRouting } from '../../src/pages/modules/Configurator/routing'
import { useRepository } from '../../src/pages/modules/Configurator/useRepository'

const state = vi.hoisted(() => ({ documents: new Map<string, any>(), writes: [] as string[] }))
vi.mock('@/composables/AAS/AASHandling', () => ({ useAASHandling: () => ({ fetchAasList: async () => [] }) }))
vi.mock('@/store/EnvironmentStore', () => ({ useEnvStore: () => ({ getAllowEditing: true, getAllowUploading: true }) }))
vi.mock('@/store/InfrastructureStore', () => ({ useInfrastructureStore: () => ({ getSelectedInfrastructure: { id: 'one', template: 'mono-repo' }, getAASRepoURL: 'shell', getSubmodelRepoURL: 'sm' }) }))
vi.mock('@/composables/RequestHandling', () => ({ useRequestHandling: () => ({ getRequest: async (path: string) => state.documents.has(path) ? { success: true, data: clone(state.documents.get(path)), status: 200 } : { success: false, status: 404 } }) }))
vi.mock('@/composables/Client/AASRepositoryClient', () => ({ useAASRepositoryClient: () => ({ getAasEndpointById: (id: string) => `shell/${id}`, postAas: async (shell: any) => write('POST', `shell/${shell.id}`, shell), putAas: async (shell: any) => write('PUT', `shell/${shell.id}`, shell) }) }))
vi.mock('@/composables/Client/SMRepositoryClient', () => ({ useSMRepositoryClient: () => ({ getSmEndpointById: (id: string) => `sm/${id}`, postSubmodel: async (sm: any) => write('POST', `sm/${sm.id}`, sm), putSubmodel: async (sm: any) => write('PUT', `sm/${sm.id}`, sm) }) }))
function write (method: string, path: string, value: any) {
  state.writes.push(`${method} ${path}`)
  state.documents.set(path, jsonization.toJsonable(value))
  return true
}
beforeEach(() => {
  state.documents.clear()
  state.writes = []
})

const property = (idShort: string, value: unknown) => ({ modelType: 'Property', idShort, value })
const flyway = (c: number, r: number): Element => ({ modelType: 'SubmodelElementCollection', idShort: `Flyway_${c}_${r}`, supplementalSemanticIds: [{ keys: [{ value: 'https://smartproductionlab.aau.dk/semantics/Flyway' }] }], value: [property('X', String((c + 0.5) * 240)), property('Y', String((r + 0.5) * 240))] })
const entry = (name: string, value: string) => ({ modelType: 'SubmodelElementCollection', idShort: name, value: [property('Value', value)] })
/** A 4 x 3 table as modreg describes it from the controller: the frame in Parameters, a coordinate per flyway there. */
function table (holes: string[] = ['2,1'], frame = true): Model {
  const flyways = Array.from({ length: 12 }, (_, i) => [i % 4, Math.floor(i / 4)] as const).filter(([c, r]) => !holes.includes(`${c},${r}`))
  const base = { modelType: 'SubmodelElementCollection', idShort: 'TableBase', supplementalSemanticIds: [{ keys: [{ value: 'https://smartproductionlab.aau.dk/semantics/TableBase' }] }], value: [property('X', '0'), property('Y', '0')] }
  return {
    shell: { id: 'urn:table', assetInformation: { assetType: 'https://smartproductionlab.aau.dk/Resource/Module', globalAssetId: 'urn:table/asset' } },
    submodels: [
      { id: 'urn:table/Variables', idShort: 'Variables', submodelElements: [{ idShort: 'Measurements', value: [{ idShort: 'Coordinates', value: [base, ...flyways.map(([c, r]) => flyway(c, r))] }] }] },
      ...(frame ? [{ id: 'urn:table/Parameters', idShort: 'Parameters', semanticId: { keys: [{ value: 'https://smartproductionlab.aau.dk/ARSO/Parameters/1/0/Submodel' }] }, submodelElements: [entry('Columns', '4'), entry('Rows', '3'), entry('FlywaySize', '240.0')] }] : []),
    ],
  }
}
// The planar controller's example (config/line-layout.example.json): a one-way loop, a two-way shortcut.
const LOOP: Routing = {
  lanes: [{ name: 'loop', points: [[180, 180], [780, 180], [780, 540], [180, 540], [180, 180]], oneWay: true }, { name: 'shortcut', points: [[420, 180], [420, 540]], oneWay: false }],
  turnSpots: [[840, 360]],
  idleArea: [[60, 180], [60, 540]],
}

describe('The planar table as its AAS reports it', () => {
  it('takes the frame from the table\'s Parameters, so a column without flyways still counts', () => {
    const t = table(['3,0', '3,1', '3,2'])
    expect(tableGeometry(t)).toMatchObject({ columns: 4, rows: 3, width: 960, height: 720, pitch: 240, measured: true })
    expect(tableGeometry(table(['3,0', '3,1', '3,2'], false))).toMatchObject({ columns: 3, width: 720, measured: false })
    expect([...tableFrame(table())!.flyways].toSorted()).not.toContain('2,1')
    expect(tableFrame(table())).toMatchObject({ columns: 4, rows: 3, flyway: 240, slot: 120 })
  })
})

describe('Shuttle routing for the controller\'s line mode', () => {
  const frame = tableFrame(table([]))!
  it('keeps the routing in the line\'s Parameters as the collection whose value the controller reads, and takes it back', () => {
    const line = newSystem('Line', 'urn:line', table())
    writeRouting(line, { ...LOOP, idleArea: [] })
    const parameters = submodel(line, 'Parameters')!
    const parsed = jsonization.submodelFromJsonable(parameters as never)
    expect(parsed.error).toBeNull()
    // Every constraint but the ID-short pattern's two characters: a point's X and Y are as in the
    // lab's coordinates and IDTA 02045 (Asset Location).
    const findings = [...verification.verify(parsed.mustValue())].map(e => `${e.path}: ${e.message}`)
    expect(findings.filter(text => !/value\[[01]\]\.idShort: ID-short/.test(text))).toEqual([])
    expect(findings.length).toBe(2 * (5 + 2 + 1))
    expect(line.shell.submodels.map((ref: Element) => ref.keys[0].value)).toContain(parameters.id)
    // What the repository gives as the collection's $value (planar-controller/planar/lines.py reads it).
    const valueOnly = (node: Element): unknown => node.modelType === 'Property'
      ? node.value
      : (node.modelType === 'SubmodelElementList' ? (node.value ?? []).map((e: Element) => valueOnly(e)) : Object.fromEntries((node.value ?? []).map((e: Element) => [e.idShort, valueOnly(e)])))
    const xy = (x: number, y: number) => ({ X: String(x), Y: String(y) })
    expect(valueOnly(field(parameters, ROUTING)!)).toEqual({
      Lanes: [{ Name: 'loop', OneWay: 'true', Points: [xy(180, 180), xy(780, 180), xy(780, 540), xy(180, 540), xy(180, 180)] }, { Name: 'shortcut', OneWay: 'false', Points: [xy(420, 180), xy(420, 540)] }],
      TurnSpots: [xy(840, 360)],
      IdleArea: [],
    })
    writeRouting(line, LOOP)
    expect(readRouting(line).routing).toEqual(LOOP)
    expect(routingUrl(line, 'http://localhost:8081/')).toBe(`http://localhost:8081/submodels/${btoa('urn:line/submodels/Parameters').replace(/=+$/, '')}/submodel-elements/${ROUTING}/$value`)
    writeRouting(line, undefined)
    expect(readRouting(line)).toEqual({})
    expect(routingUrl(line, 'http://localhost:8081')).toBeUndefined()
  })
  it('takes back the first form, the controller\'s JSON in a Value', () => {
    const line = newSystem('Line', 'urn:line', table())
    writeRouting(line, LOOP)
    field(submodel(line, 'Parameters'), ROUTING)!.value = [property('Value', JSON.stringify({ lanes: [{ name: 'loop', points: LOOP.lanes[0]!.points, oneWay: true }], turnSpots: [[840, 360]] }))]
    expect(readRouting(line).routing).toEqual({ lanes: [LOOP.lanes[0]], turnSpots: [[840, 360]], idleArea: [] })
  })
  it('says what it holds when that is no routing', () => {
    const line = newSystem('Line', 'urn:line', table())
    writeRouting(line, LOOP)
    field(field(submodel(line, 'Parameters'), ROUTING), 'TurnSpots')!.value[0].value[0].value = 'east'
    expect(readRouting(line).error).toContain('"east" is not a number')
    field(submodel(line, 'Parameters'), ROUTING)!.value = [property('Value', '{"lanes": 3')]
    expect(readRouting(line).error).toContain('not a routing')
  })
  it('traces lanes along rows and columns over slots on flyways only', () => {
    expect(trace(frame, [[60, 60], [420, 60], [420, 300]]).slots).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2]])
    expect(trace(frame, [[60, 60], [180, 180]]).error).toContain('not along a row or a column')
    expect(trace(frame, [[60, 60], [100, 60]]).error).toContain('not a slot centre')
    expect(trace(tableFrame(table())!, [[60, 300], [900, 300]]).error).toContain('missing flyway')
  })
  it('turns on a flyway\'s centre or where four flyways meet', () => {
    const holed = tableFrame(table())!
    expect(spotOf(frame, [720, 480])).toEqual([720, 480])
    expect(spotOf(frame, [820, 400])).toEqual([840, 360])
    expect(spotOf(holed, [480, 240])).toBeUndefined() // the hole at (2, 1) is one of its four
    expect(spotOf(frame, [0, 240])).toBeUndefined()
    expect(spotSlots(frame, [720, 480])).toEqual([[5, 3], [5, 4], [6, 3], [6, 4]])
    expect(spotSlots(frame, [840, 360])).toEqual([[6, 2], [6, 3], [7, 2], [7, 3]])
  })
  it('checks a routing as the controller does at its Reset', () => {
    expect(problems(LOOP, frame)).toEqual([])
    expect(problems({ ...LOOP, lanes: [{ name: 'dead end', points: [[60, 60], [900, 60]], oneWay: true }], turnSpots: [] }, frame)[0]).toContain('do not lead from every lane slot to every other')
    expect(problems({ ...LOOP, lanes: [] }, frame)).toContain('Draw at least one lane.')
    expect(problems({ ...LOOP, turnSpots: [[1200, 60]] }, frame)[0]).toContain('neither a flyway\'s centre nor where four flyways meet')
    expect(problems({ ...LOOP, turnSpots: [[240, 120]] }, frame)[0]).toContain('neither')
    expect(problems({ ...LOOP, turnSpots: [[720, 480]] }, frame)).toEqual([])
    expect(problems({ ...LOOP, turnSpots: [[600, 360]] }, frame)[0]).toContain('no lane slot under it')
    expect(problems({ ...LOOP, idleArea: [[60, 180], [60, 300], [60, 180]] }, frame)[0]).toContain('passes a slot twice')
    expect(problems(LOOP, frame, 6)[0]).toContain('4 slots for 6 shuttles')
  })
  it('creates a line\'s first Parameters and writes the shell\'s reference to it', async () => {
    const before = newSystem('Line', 'urn:line', table())
    state.documents.set(`shell/${before.shell.id}`, clone(before.shell))
    for (const sm of before.submodels) {
      state.documents.set(`sm/${sm.id}`, clone(sm))
    }
    const draft = clone(before)
    writeRouting(draft, LOOP)
    const saved = await useRepository().save([draft], [before])
    expect(state.writes).toEqual(['POST sm/urn:line/submodels/Parameters', 'PUT shell/urn:line'])
    expect(canonical(saved[0]) === canonical(draft)).toBe(true)
    writeRouting(draft, { ...LOOP, turnSpots: [] })
    state.writes = []
    await useRepository().save([draft], saved)
    expect(state.writes).toEqual(['PUT sm/urn:line/submodels/Parameters'])
  })
})
