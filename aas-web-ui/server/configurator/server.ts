import type { Element, Storage } from './series.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { axes, coordinateQuery, field, pointLine, withHistory } from './series.js'

export interface Config extends Storage { repository: string, publicRepository: string, influx: string, token: string, enabled: boolean, editing: boolean }
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b))) : item)
const encode = (value: string) => Buffer.from(value).toString('base64url')
const normalize = (value: string) => value.replace(/\/$/, '').replace(/\/shells$/, '')
function fail (message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}
function respond (response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}
async function body (request: IncomingMessage) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (Buffer.byteLength(text) > 1024 * 1024) {
      fail('Request is too large', 413)
    }
  }
  return text
}
export function createCoordinateServer (config: Config) {
  // Serialize snapshots per asset to keep metadata writes from overwriting another save.
  const pending = new Map<string, Promise<unknown>>()
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname.endsWith('/status') && request.method === 'GET') {
        return respond(response, 200, { enabled: config.enabled, repository: config.publicRepository })
      }
      if (!config.enabled) {
        fail('Coordinate history is not configured', 503)
      }
      if (request.headers.origin && request.headers.origin !== new URL(config.publicUrl).origin) {
        fail('Origin is not allowed', 403)
      }
      if (request.method !== 'POST') {
        fail('Method not allowed', 405)
      }
      if (url.pathname.endsWith('/query')) {
        const query = await body(request)
        const asset = url.searchParams.get('asset') ?? '', point = url.searchParams.get('point') ?? ''
        if (!/^[\w-]+$/.test(asset) || !/^[A-Z]\w*$/i.test(point)) {
          fail('Invalid series identifier')
        }
        const selected = /r\["_field"\]\s*==\s*"([A-Za-z]+)"/.exec(query)?.[1]
        const range = /range\(start:\s*([\dT:.Z+-]+),\s*stop:\s*([\dT:.Z+-]+)\)/.exec(query)
        if (!selected || ![...axes, 'RelativeTo', 'Source'].includes(selected) || !range || !Number.isFinite(Date.parse(range[1]!)) || !Number.isFinite(Date.parse(range[2]!)) || Date.parse(range[1]!) >= Date.parse(range[2]!)) {
          fail('Choose a valid field and time range')
        }
        // Never forward arbitrary Flux supplied by the browser.
        const result = await fetch(`${config.influx}/api/v2/query?org=${encodeURIComponent(config.org)}`, { method: 'POST', headers: { 'Authorization': `Token ${config.token}`, 'Content-Type': 'application/vnd.flux', 'Accept': 'application/csv' }, body: coordinateQuery(config.bucket, Buffer.from(asset, 'base64url').toString('utf8'), point, selected, range[1], range[2]), signal: AbortSignal.timeout(20_000) })
        if (!result.ok) {
          fail(`Influx query failed (${result.status})`, 502)
        }
        response.writeHead(200, { 'Content-Type': 'text/csv', 'Cache-Control': 'no-store' })
        response.end(await result.text())
        return
      }
      if (!url.pathname.endsWith('/sync')) {
        fail('Route not found', 404)
      }
      if (!config.editing) {
        fail('Editing is disabled', 403)
      }
      const input = JSON.parse(await body(request))
      if (typeof input.aasId !== 'string' || /[\r\n]/.test(input.aasId) || typeof input.repository !== 'string' || normalize(input.repository) !== normalize(config.publicRepository)) {
        fail('Select the repository configured for coordinate history')
      }
      const previous = pending.get(input.aasId) ?? Promise.resolve()
      const job = previous.catch(() => {}).then(async () => sync(input, request, config))
      pending.set(input.aasId, job)
      try {
        respond(response, 200, await job)
      } finally {
        if (pending.get(input.aasId) === job) {
          pending.delete(input.aasId)
        }
      }
    } catch (error) {
      const failure = error as Error & { status?: number }
      respond(response, failure.status ?? 500, { error: failure.message })
    }
  })
}
async function sync (input: { aasId: string, expected: Element }, request: IncomingMessage, config: Config) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (request.headers.authorization) {
    headers.Authorization = request.headers.authorization
  }
  const read = async (path: string) => {
    const result = await fetch(`${config.repository}${path}`, { headers, signal: AbortSignal.timeout(15_000) })
    if (!result.ok) {
      fail(`Cannot read saved coordinate model (${result.status})`, 502)
    }
    return await result.json() as Element
  }
  const shell = await read(`/shells/${encode(input.aasId)}`)
  let sm: Element | undefined
  for (const ref of shell.submodels ?? []) {
    const candidate = await read(`/submodels/${encode(ref.keys[0].value)}`)
    if (candidate.idShort === 'Variables') {
      sm = candidate; break
    }
  }
  const coordinates = field(field(sm, 'Measurements'), 'Coordinates')
  if (!sm || !coordinates) {
    fail('This asset has no coordinate definitions')
  }
  if (canonical(coordinates) !== canonical(input.expected)) {
    fail('Coordinates changed. Refresh the catalog before recording them.', 409)
  }
  const next = structuredClone(coordinates)
  next.value = next.value.map((point: Element) => withHistory(point, input.aasId, config))
  const path = `/submodels/${encode(sm.id)}/submodel-elements/Measurements.Coordinates`
  if (canonical(next) !== canonical(coordinates)) {
    const result = await fetch(`${config.repository}${path}`, { method: 'PUT', headers, body: JSON.stringify(next), signal: AbortSignal.timeout(15_000) })
    if (!result.ok) {
      fail(`Could not save coordinate time-series definitions (${result.status})`, 502)
    }
  }
  const timestamp = Date.now()
  const result = await fetch(`${config.influx}/api/v2/write?org=${encodeURIComponent(config.org)}&bucket=${encodeURIComponent(config.bucket)}&precision=ms`, { method: 'POST', headers: { 'Authorization': `Token ${config.token}`, 'Content-Type': 'text/plain' }, body: next.value.map((point: Element) => pointLine(point, input.aasId, timestamp)).join('\n'), signal: AbortSignal.timeout(15_000) })
  if (!result.ok) {
    fail(`AAS coordinates are saved, but history failed (${result.status}). Refresh and use Record coordinate history to retry.`, 502)
  }
  return { count: next.value.length, timestamp: new Date(timestamp).toISOString() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config: Config = {
    repository: normalize(process.env.CONFIGURATOR_AAS_URL ?? 'http://aas-environment:8081'),
    publicRepository: normalize(process.env.AAS_REPO_PATH ?? 'http://localhost:8081'),
    influx: process.env.CONFIGURATOR_INFLUX_URL ?? 'http://influxdb:8086',
    org: process.env.CONFIGURATOR_INFLUX_ORG ?? 'ap2030', bucket: process.env.CONFIGURATOR_INFLUX_BUCKET ?? 'ap2030',
    token: process.env.CONFIGURATOR_INFLUX_TOKEN ?? '', publicUrl: process.env.CONFIGURATOR_PUBLIC_URL ?? 'http://localhost:3000',
    enabled: process.env.CONFIGURATOR_COORDINATES_ENABLED === 'true' && Boolean(process.env.CONFIGURATOR_INFLUX_TOKEN), editing: process.env.ALLOW_EDITING !== 'false',
  }
  createCoordinateServer(config).listen(3002, '127.0.0.1')
}
