import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { createEditorAssets } from '../lib/editor-assets.js'
import { clearSessionFile, getSessionFile, setSessionFile } from '../lib/session-file.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-editor-document-'))
const originalIndex = '<html><script type="module" src="/assets/official.js"></script></html>'
const originalBundle = '/* original vendor bundle: never patched */'
fs.mkdirSync(path.join(root, 'assets'))
fs.writeFileSync(path.join(root, 'index.html'), originalIndex)
fs.writeFileSync(path.join(root, 'assets', 'official.js'), originalBundle)
const sessionId = 'editor-document-test'
const binding = { key: 'document-binding', sessionId, get currentFile() { return getSessionFile(sessionId) } }
const assets = createEditorAssets({
  bindingOf() { return binding },
  urlOf(req) { return new URL(req.url, 'http://127.0.0.1') },
  editorDirectories: [root],
})

async function serve(url) {
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await assets.serve({ url }, res)
  assert.equal(res.status, 200)
  return res
}

async function boot() {
  const res = await serve('/pen-editor/index.html?binding=document-binding')
  assert.equal(res.headers['Cache-Control'], 'no-store')
  const script = res.body.match(/<script>([\s\S]+?)<\/script>/)[1]
  const messages = []
  const requests = []
  const timers = []
  let reloads = 0
  const document = {
    documentElement: { style: { colorScheme: 'light' }, classList: { add() {}, remove() {} } },
    body: { hasAttribute() { return false } },
  }
  const window = {
    document,
    location: { reload() { reloads += 1 } },
    postMessage(message) { messages.push(message) },
    matchMedia() { return { matches: false, addEventListener() {} } },
  }
  window.parent = window
  const context = vm.createContext({
    window, document, console, ArrayBuffer, Uint8Array,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    MutationObserver: class { observe() {} },
    XMLHttpRequest: class { status = 404; open() {}; send() {} },
    setTimeout(fn) { timers.push(fn) },
    fetch(url, options) { requests.push({ url, options }); return new Promise(() => {}) },
  })
  vm.runInContext(script, context)
  return { context, window, messages, requests, timers, reloads: () => reloads }
}

try {
  const first = setSessionFile(sessionId, path.join(root, '中文 #100%', 'one.pen'))
  const editor = await boot()
  assert.equal(editor.window.PENCIL_INIT_PARAMS.fileURI, first.fileURI)
  assert.equal(editor.window.PENCIL_INIT_PARAMS.fileURI, pathToFileURL(first.filePath).toString())
  assert.match(editor.requests[0].url, /documentRevision=1/)
  const importMessage = { id: 'import', type: 'request', method: 'import-file', payload: { fileContents: new Uint8Array([1, 2, 3]) } }
  editor.window.vscodeapi.postMessage(importMessage)
  const sent = JSON.parse(editor.requests.at(-1).options.body)
  assert.equal(sent.documentURI, first.fileURI)
  assert.equal(sent.documentRevision, first.revision)
  assert.deepEqual(sent.payload.fileContents, { __penBinaryBase64: 'AQID' })
  assert.equal(importMessage.documentRevision, undefined, 'vendor messages must not be mutated')

  const sameFile = { type: 'notification', method: 'file-update', payload: { fileURI: first.fileURI, documentRevision: first.revision, content: '{}' } }
  assert.equal(editor.context.__penDeliver(sameFile), true)
  assert.equal(editor.messages.at(-1), sameFile)
  assert.equal(editor.reloads(), 0, 'content reloads of the same document must not recreate the editor')
  const second = setSessionFile(sessionId, path.join(root, 'variants', 'two.pen'))
  assert.equal(editor.context.__penDeliver({ type: 'notification', method: 'file-update', payload: { fileURI: second.fileURI, documentRevision: second.revision } }), false)
  assert.equal(editor.reloads(), 1)
  const requestCount = editor.requests.length
  const messageCount = editor.messages.length
  editor.window.vscodeapi.postMessage(importMessage)
  editor.context.__penPoll()
  editor.context.__penDeliver(sameFile)
  assert.equal(editor.requests.length, requestCount, 'old editor must stop sending imports/autosaves/polls')
  assert.equal(editor.messages.length, messageCount, 'old editor must not receive late responses')
  assert.equal(editor.reloads(), 1, 'only one reload per retired document')

  const nextEditor = await boot()
  assert.equal(nextEditor.window.PENCIL_INIT_PARAMS.fileURI, second.fileURI)
  assert.equal(nextEditor.context.__penDocumentRevision, second.revision)
  assert.equal(nextEditor.context.__penDeliver({ type: 'notification', method: 'reload-editor' }), false)
  assert.equal(nextEditor.reloads(), 1, 'stale long polls must reload without consuming the new queue')

  const returned = setSessionFile(sessionId, first.filePath)
  const returnedEditor = await boot()
  assert.equal(returnedEditor.window.PENCIL_INIT_PARAMS.fileURI, first.fileURI)
  assert.equal(returnedEditor.context.__penDocumentRevision, returned.revision)
  assert.equal(returnedEditor.context.__penDeliver(sameFile), false, 'A -> B -> A still rejects A\'s old revision')
  assert.equal(returnedEditor.reloads(), 1)

  const bundle = await serve('/pen-editor/assets/official.js')
  assert.equal(bundle.body, originalBundle)
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), originalIndex)
  assert.equal(fs.readFileSync(path.join(root, 'assets', 'official.js'), 'utf8'), originalBundle)
  console.log('official editor bootstrap, document identity, reload boundaries, and unchanged vendor assets: ok')
} finally {
  clearSessionFile(sessionId)
  fs.rmSync(root, { recursive: true, force: true })
}
