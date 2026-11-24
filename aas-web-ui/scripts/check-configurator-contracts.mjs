import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { newProduct, newPart, entry } = await server.ssrLoadModule('/src/pages/modules/Configurator/model.ts')
  const base = 'http://localhost:8081'
  const shells = (await (await fetch(`${base}/shells?limit=100`)).json()).result
  const products = []
  for (const [family, name] of Object.entries({ vial: 'Vial2mLAAS', syringe: 'PrefilledSyringe1mLAAS', cartridge: 'Cartridge3mLAAS' })) {
    const shell = shells.find(shell => shell.idShort === name)
    if (!shell) {
      throw new Error(`Missing live reference ${name}`)
    }
    const submodels = await Promise.all(shell.submodels.map(async ref => (await fetch(`${base}/submodels/${Buffer.from(ref.keys[0].value).toString('base64url')}`)).json()))
    const model = newProduct(family, `Contract test ${family}`, `urn:contract-test:${family}`, { shell, submodels })
    const part = newPart('Stopper', 'Additional stopper', '1', 'piece')
    part.statements.push(newPart('Liquid', 'Nested liquid', '0.1', 'mL'))
    entry(model).statements.push(part)
    products.push(model)
  }
  const output = join(tmpdir(), 'configurator-product-contracts.json')
  await writeFile(output, JSON.stringify(products))
  console.log(`Created 3 frontend product contracts from live references: ${output}`)
} finally {
  await server.close()
}
