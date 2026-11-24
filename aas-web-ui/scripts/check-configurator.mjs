// Read reference models from the local repository; intercept ALL browser repository writes in memory.
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const repository = process.env.CONFIGURATOR_REPOSITORY || 'http://localhost:8081'
const app = process.env.CONFIGURATOR_UI || 'http://127.0.0.1:5180'
const shells = (await (await fetch(`${repository}/shells?limit=100`)).json()).result
const cache = new Map()
const encode = id => Buffer.from(id).toString('base64url')
for (const shell of shells) {
  cache.set(`/shells/${encode(shell.id)}`, shell)
  for (const ref of shell.submodels ?? []) {
    const path = `/submodels/${encode(ref.keys[0].value)}`
    if (!cache.has(path)) {
      cache.set(path, await (await fetch(repository + path)).json())
    }
  }
}
const browser = await chromium.launch({ channel: 'chrome' })
const writes = []
const registryRequests = []
const registry = 'http://localhost:8082'
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.configuratorDropFrames = []
    document.addEventListener('drop', () => {
      const start = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => window.configuratorDropFrames.push(performance.now() - start)))
    }, true)
  })
  await page.route(`${registry}/**`, async route => {
    registryRequests.push(route.request().url())
    const path = new URL(route.request().url()).pathname
    const data = path === '/description' ? { profiles: [] } : (path === '/shell-descriptors' ? { result: [] } : undefined)
    await route.fulfill({ status: data ? 200 : 404, headers: { 'access-control-allow-origin': '*' }, json: data ?? {} })
  })
  await page.route(`${repository}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' }
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers })
    }
    if (request.method() === 'POST') {
      const data = request.postDataJSON()
      const key = `${path}/${encode(data.id)}`
      if (cache.has(key)) {
        return route.fulfill({ status: 409, headers })
      }
      cache.set(key, data)
      if (path === '/shells') {
        shells.push(data)
      }
      writes.push(path)
      return route.fulfill({ status: 201, headers, json: data })
    }
    if (request.method() === 'PUT') {
      const data = request.postDataJSON()
      if (path.includes('/submodel-elements/')) {
        const [base, elementPath] = path.split('/submodel-elements/')
        let parent = cache.get(base)
        const segments = elementPath.split('.').map(segment => decodeURIComponent(segment))
        const name = segments.pop()
        for (const segment of segments) {
          parent = (parent.submodelElements ?? parent.value ?? parent.statements).find(item => item.idShort === segment)
        }
        const members = parent.submodelElements ?? parent.value ?? parent.statements
        members[members.findIndex(item => item.idShort === name)] = data
      } else {
        cache.set(path, data)
      }
      writes.push(path)
      return route.fulfill({ status: 204, headers })
    }
    assert.equal(request.method(), 'GET', 'Unexpected method must not reach the live repository')
    const data = path === '/shells' ? { result: shells } : (path === '/description' ? { profiles: [] } : cache.get(path))
    return route.fulfill({ status: data ? 200 : 404, headers, json: data ?? {} })
  })
  await page.addInitScript(url => localStorage.setItem('basyxInfrastructures', JSON.stringify({ selectedInfrastructureId: 'configurator-test', infrastructures: [{ id: 'configurator-test', name: 'Configurator test', template: 'mono-repo', isDefault: true, auth: { securityType: 'No Authentication' }, components: Object.fromEntries(['AASDiscovery', 'AASRegistry', 'SubmodelRegistry', 'AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo', 'CompanyLookup'].map(key => [key, { url: ['AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo'].includes(key) ? url : (key === 'AASRegistry' ? 'http://localhost:8082' : '') }])) }] })), repository)
  await page.goto(`${app}/modules/configurator`)
  await page.getByRole('button', { name: 'New product', exact: true }).waitFor({ timeout: 90_000 })
  await page.getByRole('button', { name: 'New product', exact: true }).click()
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill('Browser test vial')
  await page.getByRole('button', { name: 'Create draft', exact: true }).click()
  const rows = page.locator('.component-row')
  const initialFigures = page.locator('svg.assembly [role="button"]')
  assert.deepEqual(await initialFigures.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['Edit Crimp cap 13 mm', 'Edit Rubber stopper 13 mm', 'Edit Demo liquid', 'Edit Glass vial 2R'])
  assert.match(await rows.first().textContent(), /Crimp cap/)
  assert.match(await rows.last().textContent(), /Glass vial/)
  await page.getByRole('button', { name: 'Edit Glass vial 2R', exact: true }).click({ trial: true })
  await page.screenshot({ path: join(tmpdir(), 'basyx-product-assembly-order.png'), animations: 'disabled' })

  await rows.filter({ hasText: 'Rubber stopper 13 mm' }).click({ trial: true })
  const sourceRow = await rows.filter({ hasText: 'Rubber stopper 13 mm' }).boundingBox()
  const targetRow = await rows.first().boundingBox()
  await page.mouse.move(sourceRow.x + sourceRow.width / 2, sourceRow.y + sourceRow.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceRow.x + sourceRow.width / 2 + 8, sourceRow.y + sourceRow.height / 2, { steps: 3 })
  await page.mouse.move(targetRow.x + 20, targetRow.y + 5, { steps: 12 })
  await page.mouse.move(targetRow.x + 21, targetRow.y + 5)
  await page.locator('.component-row.insert-before').waitFor({ timeout: 3000 })
  await page.mouse.up()
  assert.match(await rows.first().textContent(), /Rubber stopper/)
  const figures = page.locator('svg.assembly [role="button"]')
  assert.match(await figures.first().getAttribute('aria-label'), /Rubber stopper/)
  const from = await figures.first().boundingBox(), to = await figures.nth(2).boundingBox()
  await page.mouse.move(from.x + from.width / 4, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 4, to.y + to.height * 0.8, { steps: 12 })
  await page.locator('.assembly-insertion').waitFor({ state: 'attached' })
  assert.equal(await page.locator('.assembly-insertion').evaluate(line => getComputedStyle(line).strokeWidth), '3px')
  await page.mouse.up()
  assert.match(await rows.nth(2).textContent(), /Rubber stopper/)
  await page.getByRole('button', { name: 'Edit Demo liquid', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('1.5')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()

  await page.getByRole('button', { name: 'Edit Rubber stopper 13 mm', exact: true }).click()
  await page.getByRole('textbox', { name: 'Component name', exact: true }).fill('Test stopper')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  const originalParts = await rows.count()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true)
  await page.getByRole('textbox', { name: 'Component name', exact: true }).fill('Wizard stopper')
  await page.locator('.v-select').filter({ has: page.getByRole('combobox', { name: 'Component type', exact: true }) }).click()
  await page.getByRole('option', { name: 'Stopper', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('0')
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true)
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('2')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Component name', exact: true }).inputValue(), 'Wizard stopper')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  assert.equal(await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).inputValue(), '2')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('.v-select').filter({ has: page.getByRole('combobox', { name: 'Parent component', exact: true }) }).click()
  await page.getByRole('option', { name: 'Glass vial 2R', exact: true }).click()
  await page.screenshot({ path: join(tmpdir(), 'basyx-component-wizard.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Add to assembly', exact: true }).click()
  assert.equal(await rows.count(), originalParts + 1)
  assert.match(await rows.nth(3).textContent(), /> Wizard stopper/)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Component name', exact: true }).inputValue(), '')
  await page.getByRole('textbox', { name: 'Component name', exact: true }).fill('Discard me')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await rows.count(), originalParts + 1)
  await page.getByRole('button', { name: 'Review and save', exact: true }).click()
  await page.getByRole('button', { name: 'Save and read back', exact: true }).click()
  await page.getByText('Saved and read back from the AAS repository.', { exact: true }).waitFor()
  assert.ok(shells.some(shell => shell.displayName?.some(name => name.text === 'Browser test vial')))
  assert.match(await rows.nth(3).textContent(), /> Wizard stopper/)
  assert.match(await rows.nth(3).textContent(), /2 piece/)
  await page.getByRole('button', { name: 'Delete Glass vial 2R', exact: true }).click()
  await page.getByText(/together with 1 nested component/).waitFor()
  await page.getByRole('button', { name: 'Keep component', exact: true }).click()
  assert.equal(await rows.count(), originalParts + 1)
  await page.getByRole('button', { name: 'Delete Glass vial 2R', exact: true }).click()
  await page.getByRole('button', { name: 'Delete from product', exact: true }).click()
  assert.equal(await rows.count(), originalParts - 1)
  assert.equal(await page.getByRole('button', { name: 'Edit Wizard stopper', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Edit Demo liquid', exact: true }).click()
  await page.getByRole('button', { name: 'Delete component', exact: true }).click()
  await page.getByRole('button', { name: 'Delete from product', exact: true }).click()
  assert.equal(await rows.count(), originalParts - 2)
  await page.getByRole('button', { name: 'Review and save', exact: true }).click()
  await page.getByRole('button', { name: 'Save and read back', exact: true }).click()
  await page.getByRole('button', { name: 'Save and read back', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
  await page.getByRole('button', { name: 'New product', exact: true }).click({ trial: true })
  assert.equal(await rows.count(), originalParts - 2)
  await page.getByRole('tab', { name: 'Production lines', exact: true }).click()
  await page.getByRole('button', { name: 'New production line', exact: true }).click()
  await page.getByRole('textbox', { name: 'Line name', exact: true }).fill('Browser test line')
  await page.getByRole('button', { name: 'Create line draft', exact: true }).click()
  const board = page.getByLabel('Production line layout', { exact: true })
  await board.waitFor()
  const module = page.locator('.catalog-module').filter({ hasText: 'FillingModuleAAS' }).first()
  const targetZone = page.getByRole('button', { name: 'Place selected module in South 1', exact: true })
  await module.click({ trial: true })
  await targetZone.scrollIntoViewIfNeeded()
  const sourceBox = await module.boundingBox(), zoneBox = await targetZone.boundingBox()
  await page.mouse.move(sourceBox.x + 12, sourceBox.y + 12)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + 12 + 8, sourceBox.y + 12, { steps: 3 })
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 12 })
  await page.mouse.move(zoneBox.x + zoneBox.width / 2 + 1, zoneBox.y + zoneBox.height / 2)
  await page.locator('.drop-zone.zone-active').waitFor({ timeout: 5000 })
  const writesBeforeDrop = writes.length
  await page.mouse.up()
  await page.getByText(/Placed FillingModuleAAS at/).waitFor()
  assert.equal(writes.length, writesBeforeDrop, 'Dragging must only update the local draft')
  await page.waitForFunction(() => window.configuratorDropFrames.length >= 2)
  const dropTimes = await page.evaluate(() => window.configuratorDropFrames)
  console.log('Drop to rendered frame (ms):', dropTimes.map(ms => Math.round(ms)))
  assert.ok(dropTimes.every(ms => ms < 1000), `Drops should render within 1 second: ${dropTimes}`)
  assert.equal(await page.locator('.drop-zone').count(), 14)

  await page.getByRole('button', { name: 'Review and save', exact: true }).click()
  await page.getByRole('button', { name: 'Save and read back', exact: true }).click()
  await page.getByRole('button', { name: 'Review and save', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Save and read back', exact: true }).waitFor({ state: 'hidden' })
  await page.getByText('Saved and read back from the AAS repository.', { exact: true }).waitFor()
  assert.ok(writes.some(path => path.endsWith('/submodel-elements/Measurements.Coordinates.ModuleBase')))
  await page.screenshot({ path: join(tmpdir(), 'basyx-configurator-line.png'), animations: 'disabled' })
  await page.getByRole('tab', { name: 'Orders', exact: true }).click()
  await page.getByRole('textbox', { name: 'Order name', exact: true }).fill('Browser order')
  for (const [label, value] of [['Order product', 'Browser test vial'], ['Order production line', 'Browser test line']]) {
    const input = page.getByRole('combobox', { name: label, exact: true })
    await input.fill(value)
    await page.getByRole('option', { name: value, exact: true }).click()
  }
  const quantity = page.getByRole('spinbutton', { name: 'Quantity (units)', exact: true })
  await quantity.fill('0')
  assert.equal(await page.getByRole('button', { name: 'Review order', exact: true }).isDisabled(), true)
  await quantity.fill('250')
  await page.getByRole('button', { name: 'Review order', exact: true }).click()
  await page.getByText('250 units of Browser test vial', { exact: true }).waitFor()
  const orderWrites = writes.length
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(writes.length, orderWrites, 'Canceling review must not publish')
  await page.getByRole('button', { name: 'Review order', exact: true }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).click()
  await page.getByRole('button', { name: 'Place order', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Inspect order Browser order', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Inspect order Browser order', exact: true }).isDisabled(), false)
  assert.ok(shells.some(shell => shell.assetInformation?.assetType === 'ProductionOrder'))
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
  await page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Inspect order Browser order', exact: true }) }).getByRole('cell', { name: 'Created', exact: true }).waitFor()
  await page.screenshot({ path: join(tmpdir(), 'basyx-configurator-orders.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.getByRole('button', { name: 'Review order', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Narrow desktop layout must not overflow the page')
  await page.setViewportSize({ width: 1600, height: 1080 })
  assert.deepEqual(registryRequests.filter(url => new URL(url).pathname.startsWith('/shell-descriptors/')), [], 'Repository configuration must not depend on registry indexing')
  assert.deepEqual(errors, [])
  await page.getByRole('tab', { name: 'Products', exact: true }).click()
  await page.screenshot({ path: join(tmpdir(), 'basyx-configurator-products.png'), animations: 'disabled', timeout: 60_000 })
  console.log('Passed: native module, product and line creation, component wizard validation, nesting, back and cancellation; component deletion with nested parts, cancellation and readback; component popup, list and figure drag ordering, save/readback, zone highlighting and fast catalogue drag/drop and targeted coordinate save; order creation, cancellation, validation, readback and refresh. All writes intercepted; live repository unchanged.')
} finally {
  await browser.close()
}
