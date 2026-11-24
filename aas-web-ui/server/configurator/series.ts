export type Element = Record<string, any>
export const lab = 'https://smartproductionlab.aau.dk'
export const idta = 'https://admin-shell.io/idta/TimeSeries'
export const axes = ['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw']
export const field = (node: Element | undefined, name: string): Element | undefined => (node?.value ?? node?.submodelElements ?? []).find((item: Element) => item.idShort === name)
const ref = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const property = (idShort: string, semantic: string, value?: string, valueType = 'xs:string') => ({ modelType: 'Property', idShort, semanticId: ref(semantic), valueType, ...(value === undefined ? {} : { value }) })
const collection = (idShort: string, semantic: string, value: Element[]) => ({ modelType: 'SubmodelElementCollection', idShort, semanticId: ref(semantic), value })
export interface Storage { bucket: string, org: string, publicUrl: string }
export function coordinateQuery (bucket: string, asset: string, point: string, selected = '{{y-value}}', start = 'v.timeRangeStart', stop = 'v.timeRangeStop'): string {
  return `from(bucket: ${JSON.stringify(bucket)})\n  |> range(start: ${start}, stop: ${stop})\n  |> filter(fn: (r) => r["_measurement"] == "coordinates")\n  |> filter(fn: (r) => r["asset_id"] == ${JSON.stringify(asset)} and r["coordinate"] == ${JSON.stringify(point)})\n  |> filter(fn: (r) => r["_field"] == ${JSON.stringify(selected)})`
}
export function withHistory (coordinate: Element, aasId: string, config: Storage): Element {
  const copy = structuredClone(coordinate)
  const asset = Buffer.from(aasId).toString('base64url')
  const point = coordinate.idShort
  if (!/^[A-Z]\w*$/i.test(point)) {
    throw new Error('Invalid coordinate name')
  }
  for (const axis of axes) {
    const value = field(copy, axis)?.value
    if (value === undefined || value === '' || !Number.isFinite(Number(value))) {
      throw new Error(`${point}.${axis} must be a finite number`)
    }
  }
  const target = `${lab}/timeseries/InfluxDb2Target`
  const tags = { asset_id: aasId, coordinate: point }
  const metadata = collection('Metadata', `${idta}/Metadata/1/1`, [
    { modelType: 'MultiLanguageProperty', idShort: 'Name', semanticId: ref(`${idta}/Metadata/Name/1/1`), value: [{ language: 'en', text: `${point} coordinates` }] },
    collection('Record', `${idta}/Record/1/1`, [property('Time', `${idta}/UtcTime/1/1`, undefined, 'xs:dateTime'),
      ...axes.map(axis => ({ ...property(axis, `${lab}/timeseries/RecordField/1/0`, undefined, 'xs:double'), supplementalSemanticIds: field(copy, axis)!.semanticId ? [field(copy, axis)!.semanticId] : [], qualifiers: field(copy, axis)!.qualifiers ?? [] })),
      property('RelativeTo', `${lab}/timeseries/RecordField/1/0`), property('Source', `${lab}/timeseries/RecordField/1/0`),
    ]),
  ])
  const segments = collection('Segments', `${idta}/Segments/1/1`, [collection('Live', `${idta}/Segments/LinkedSegment/1/1`, [
    property('State', `${idta}/Segment/State/1/1`, 'InProgress'),
    property('Endpoint', `${idta}/Endpoint/1/1`, `${config.publicUrl}/api/configurator/coordinates/query?asset=${asset}&point=${point}`),
    property('Query', `${idta}/Query/1/1`, coordinateQuery(config.bucket, aasId, point)),
    collection('InfluxDb2Target', `${target}/1/0`, [property('Bucket', `${target}/Bucket/1/0`, config.bucket), property('Measurement', `${target}/Measurement/1/0`, 'coordinates'),
      collection('Tags', `${target}/Tags/1/0`, Object.entries(tags).map(([key, value]) => property(key, `${target}/Tag/1/0`, value))),
      property('WriteMode', `${target}/WriteMode/1/0`, 'Synchronous'),
    ]),
  ])])
  copy.semanticId = ref(`${lab}/variables/TimeSeries/1/0`)
  const semantics = new Set((copy.supplementalSemanticIds ?? []).map((item: Element) => item.keys?.[0]?.value))
  for (const meaning of [`${idta}/1/1`, `${lab}/variables/Coordinate/1/0`]) {
    if (!semantics.has(meaning)) {
      (copy.supplementalSemanticIds ??= []).push(ref(meaning))
    }
  }
  copy.value = copy.value.filter((item: Element) => !['Metadata', 'Segments'].includes(item.idShort))
  copy.value.push(metadata, segments)
  return copy
}
const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`).replaceAll('\n', String.raw`\n`).replaceAll('\r', String.raw`\r`)}"`
export function pointLine (coordinate: Element, aasId: string, timestamp: number): string {
  const numbers = axes.map(axis => `${axis}=${Number(field(coordinate, axis)?.value)}`)
  const parent = JSON.stringify(field(coordinate, 'RelativeTo')?.value ?? null)
  return `coordinates,asset_id=${aasId.replaceAll(/([ ,=])/g, String.raw`\$1`)},coordinate=${coordinate.idShort} ${[...numbers, `RelativeTo=${quote(parent)}`, 'Source="configurator"'].join(',')} ${timestamp}`
}
