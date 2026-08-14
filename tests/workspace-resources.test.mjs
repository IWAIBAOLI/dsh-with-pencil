import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodeIpcBinary, encodeIpcBinary } from '../packages/pen-dev-bridge/lib/ipc-binary.js'
import { createWorkspaceResources } from '../packages/pen-dev-bridge/lib/workspace-resources.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-workspace-resources-'))
const workspace = path.join(root, 'workspace')
const out = path.join(root, 'cli', 'dist', 'out')
const data = path.join(out, 'data')
const mcpBin = path.join(out, 'mcp-server-test')
fs.mkdirSync(path.join(workspace, 'designs'), { recursive: true })
fs.mkdirSync(data, { recursive: true })

const currentFile = path.join(workspace, 'designs', 'screen.pen')
const scriptFile = path.join(workspace, 'designs', 'effect.js')
const sourceFile = path.join(workspace, 'source.svg')
const workspaceLibrary = path.join(workspace, 'design-system.lib.pen')
const builtInLibrary = path.join(data, 'wireframe.lib.pen')
fs.writeFileSync(scriptFile, 'export default 1\n')
fs.writeFileSync(sourceFile, '<svg/>')
fs.writeFileSync(workspaceLibrary, '{"version":"2.14","children":[]}')
fs.writeFileSync(builtInLibrary, '{"version":"2.14","children":[]}')

const notifications = []
const resources = createWorkspaceResources({
  mcpBin,
  transport: { notify(binding, method, payload) { notifications.push({ binding, method, payload }) } },
})
const binding = {
  workspace,
  currentFile,
  documentWatcher: null,
  documentFingerprint: '',
  resourceWatchers: new Map(),
}

async function waitFor(test, timeoutMs = 3000) {
  const started = Date.now()
  while (!test()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for file watcher')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

try {
  const binary = { file: Buffer.from('asset'), nested: [new Uint8Array([1, 2, 3])] }
  const roundTrip = decodeIpcBinary(encodeIpcBinary(binary))
  assert.equal(roundTrip.file.toString(), 'asset')
  assert.deepEqual([...roundTrip.nested[0]], [1, 2, 3])

  const png = Buffer.from('test-png')
  const imported = await resources.importFile(binding, { fileName: 'hero.png', fileContents: png })
  assert.equal(imported.filePath, './images/hero.png')
  assert.deepEqual(fs.readFileSync(path.join(workspace, 'designs', 'images', 'hero.png')), png)

  const duplicate = await resources.importFile(binding, { fileName: 'hero.png', fileContents: png })
  assert.equal(duplicate.filePath, './images/hero.png')
  const second = await resources.importFile(binding, { fileName: 'hero.png', fileContents: Buffer.from('other') })
  assert.equal(second.filePath, './images/hero-1.png')

  const importedMany = await resources.importFiles(binding, [
    { fileName: 'logo.svg', fileContents: Buffer.from('<svg id="logo"/>') },
    { fileName: 'figma.png', fileContents: Buffer.from('figma-export') },
  ])
  assert.deepEqual(importedMany.map((item) => item.filePath), ['./images/logo.svg', './images/figma.png'])

  const importedUri = await resources.importUri(binding, { uri: pathToFileURL(sourceFile).toString() })
  assert.equal(importedUri.filePath, '../source.svg')
  assert.equal(importedUri.fileContents.toString(), '<svg/>')
  await assert.rejects(() => resources.importUri(binding, { uri: pathToFileURL(path.join(root, 'outside.svg')).toString() }), /escapes/)

  const generated = await resources.saveGeneratedImage(binding, { image: 'data:image/png;base64,' + Buffer.from('generated').toString('base64') })
  assert.match(generated.relativePath, /^\.\/images\/generated-.+\.png$/)
  assert.equal(fs.readFileSync(path.resolve(path.dirname(currentFile), generated.relativePath)).toString(), 'generated')

  const libraries = await resources.findLibraries(binding)
  assert.ok(libraries.includes(pathToFileURL(workspaceLibrary).toString()))
  assert.ok(libraries.includes(pathToFileURL(builtInLibrary).toString()))
  assert.equal((await resources.readFile(binding, pathToFileURL(builtInLibrary).toString())).toString().includes('2.14'), true)
  assert.deepEqual(await resources.statFile(binding, pathToFileURL(builtInLibrary).toString()), { exists: true, isFile: true })
  assert.equal(await resources.nextLibraryPath(binding), path.join(workspace, 'designs', 'screen.lib.pen'))

  resources.watchFile(binding, pathToFileURL(scriptFile).toString())
  await new Promise((resolve) => setTimeout(resolve, 550))
  fs.writeFileSync(scriptFile, 'export default 2\n')
  await waitFor(() => notifications.some((entry) => entry.method === 'file-changed' && entry.payload === pathToFileURL(scriptFile).toString()))
  resources.unwatchFile(binding, pathToFileURL(scriptFile).toString())
  assert.equal(binding.resourceWatchers.size, 0)

  console.log('workspace imports, libraries, binary IPC, and watchers: ok')
} finally {
  resources.cleanup(binding)
  fs.rmSync(root, { recursive: true, force: true })
}
