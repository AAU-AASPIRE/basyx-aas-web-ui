import type { Config } from '../../../server/configurator/server'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axes, coordinateQuery, field, withHistory } from '../../../server/configurator/series'
import { createCoordinateServer } from '../../../server/configurator/server'

const nativeFetch = globalThis.fetch
const config: Config = { repository: 'http://aas', publicRepository: 'http://localhost:8081', influx: 'http://influx', token: 'server-only-secret', org: 'ap2030', bucket: 'ap2030', publicUrl: 'http://localhost:3000', enabled: true, editing: true }
const aasId = 'urn:test:module'
const coordinates = () => ({ modelType: 'SubmodelElementCollection', idShort: 'Coordinates', value: [{ modelType: 'SubmodelElementCollection', idShort: 'ModuleBase', value: axes.map(axis => ({ modelType: 'Property', idShort: axis, valueType: 'xs:double', value: '0', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: `urn:axis:${axis}` }] } })) }] })
afterEach(() => vi.unstubAllGlobals())
async function fixture (run: (post: (path: string, data: any, headers?: Record<string, string>) => Promise<Response>, state: any) => Promise<void>, overrides: Partial<Config> = {}) {
  const state = { coordinates: coordinates(), writes: [] as any[], failInflux: false }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('http://influx')) {
      state.writes.push({ url, ...init })
      return new Response(init.method === 'POST' && url.includes('/query') ? '_time,_value\n' : null, { status: state.failInflux ? 503 : (url.includes('/query') ? 200 : 204) })
    }
    if (init.method === 'PUT') {
      state.writes.push({ url, ...init })
      state.coordinates = JSON.parse(String(init.body))
      return new Response(null, { status: 204 })
    }
    const data = url.includes('/shells/') ? { id: aasId, submodels: [{ keys: [{ value: 'urn:variables' }] }] } : { id: 'urn:variables', idShort: 'Variables', submodelElements: [{ idShort: 'Measurements', value: [state.coordinates] }] }
    return Response.json(data)
  }))
  const server = createCoordinateServer({ ...config, ...overrides })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const post = (path: string, data: any, headers = {}) => nativeFetch(`http://127.0.0.1:${address.port}/api/configurator/coordinates/${path}`, { method: 'POST', headers, body: typeof data === 'string' ? data : JSON.stringify(data) })
  try {
    await run(post, state)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
describe('Coordinate history', () => {
  it('extends the point with valid IDTA time-series metadata and preserves its current pose', () => {
    const original = coordinates().value[0]!
    const next = withHistory(original, aasId, config)
    expect(field(next, 'X')?.value).toBe('0')
    expect(field(original, 'Metadata')).toBeUndefined()
    expect(field(field(next, 'Metadata'), 'Record')?.value).toHaveLength(9)
    expect(jsonization.submodelElementFromJsonable(next as never).error).toBeNull()
    expect(JSON.stringify(next)).not.toContain(config.token)
  })
  it('writes only the coordinate subtree and records an acknowledged six-axis sample', async () => fixture(async (post, state) => {
    const response = await post('sync', { aasId, repository: config.publicRepository, expected: state.coordinates })
    expect(response.status).toBe(200)
    expect((await response.json()).count).toBe(1)
    expect(state.writes[0].url).toContain('/submodel-elements/Measurements.Coordinates')
    expect(state.writes[1].url).toContain('precision=ms')
    expect(state.writes[1].body).toContain('X=0,Y=0,Z=0,Roll=0,Pitch=0,Yaw=0')
    expect(state.writes[1].headers.Authorization).toBe('Token server-only-secret')
  }))
  it('rejects stale snapshots, cross-origin writes and another repository before any mutation', async () => fixture(async (post, state) => {
    expect((await post('sync', { aasId, repository: config.publicRepository, expected: {} })).status).toBe(409)
    expect((await post('sync', { aasId, repository: 'http://other', expected: state.coordinates })).status).toBe(400)
    expect((await post('sync', {}, { Origin: 'http://other' })).status).toBe(403)
    expect(state.writes).toEqual([])
  }))
  it('reports a failed history write and permits retry from the saved AAS snapshot', async () => fixture(async (post, state) => {
    state.failInflux = true
    const failed = await post('sync', { aasId, repository: config.publicRepository, expected: state.coordinates })
    expect(failed.status).toBe(502)
    expect((await failed.json()).error).toContain('AAS coordinates are saved')
    state.failInflux = false
    const saved = await post('sync', { aasId, repository: config.publicRepository, expected: state.coordinates })
    expect(saved.status).toBe(200)
    expect(state.writes.filter((write: any) => write.method === 'PUT')).toHaveLength(1)
  }))
  it('rebuilds a read-only chart query instead of forwarding arbitrary Flux', async () => fixture(async (post, state) => {
    const asset = Buffer.from(aasId).toString('base64url')
    const query = coordinateQuery(config.bucket, aasId, 'ModuleBase', 'X', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
    const response = await post(`query?asset=${asset}&point=ModuleBase`, `${query}\n|> to(bucket: "other")`)
    expect(response.status).toBe(200)
    expect(state.writes[0].body).toBe(query)
    expect(state.writes[0].body).not.toContain('to(bucket')
  }))
  it('enforces disabled editing', async () => fixture(async (post, state) => {
    expect((await post('sync', { aasId, repository: config.publicRepository, expected: state.coordinates })).status).toBe(403)
    expect(state.writes).toEqual([])
  }, { editing: false }))
})
