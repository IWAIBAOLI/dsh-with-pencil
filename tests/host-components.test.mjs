import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEditorAssets } from '../packages/pen-dev-bridge/lib/editor-assets.js'
import { createSessionStore } from '../packages/pen-dev-bridge/lib/session-store.js'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-host-components-'))
const editorDir = path.join(temporary, 'editor-out')
const stateFile = path.join(temporary, 'state', 'session.json')
fs.mkdirSync(editorDir, { recursive: true })
fs.writeFileSync(path.join(editorDir, 'index.html'), '<html><body><script type="module" src="/assets/app.js"></script></body></html>')
fs.mkdirSync(path.join(editorDir, 'assets'))
fs.writeFileSync(path.join(editorDir, 'assets', 'app.js'), 'window.editorLoaded = true')

process.env.DSH_PEN_EDITOR_DIR = editorDir
process.env.DSH_PEN_STATE_FILE = stateFile

function response() {
  return {
    status: 200,
    headers: {},
    body: undefined,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(body = '') { this.body = body },
  }
}

try {
  const binding = { key: 'binding-token', currentFile: path.join(temporary, 'design.pen') }
  const assets = createEditorAssets({
    bindingOf(req) { return new URL(req.url, 'http://127.0.0.1').searchParams.get('binding') === binding.key ? binding : undefined },
    urlOf(req) { return new URL(req.url, 'http://127.0.0.1') },
  })
  assert.equal(assets.preflight().directory, editorDir)

  const indexResponse = response()
  await assets.serve({ url: '/pen-editor/index.html?binding=binding-token' }, indexResponse)
  assert.equal(indexResponse.status, 200)
  assert.match(String(indexResponse.body), /var __penBinding = "binding-token"/)
  assert.match(String(indexResponse.body), /function __penPoll\(\)/)
  assert.ok(String(indexResponse.body).indexOf('function __penPoll()') < String(indexResponse.body).indexOf('<script type="module"'))

  const assetResponse = response()
  await assets.serve({ url: '/pen-editor/assets/app.js' }, assetResponse)
  assert.equal(assetResponse.status, 200)
  assert.equal(assetResponse.headers['Content-Type'], 'text/javascript')
  assert.equal(assetResponse.body, 'window.editorLoaded = true')

  const sessionStore = createSessionStore()
  assert.equal(sessionStore.set({ email: 'agent@example.com', token: 'secret-token' }), true)
  assert.deepEqual(sessionStore.get(), { email: 'agent@example.com', token: 'secret-token' })
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600)
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).token, 'secret-token')

  console.log('host editor assets and session store: ok')
} finally {
  delete process.env.DSH_PEN_EDITOR_DIR
  delete process.env.DSH_PEN_STATE_FILE
  fs.rmSync(temporary, { recursive: true, force: true })
}
