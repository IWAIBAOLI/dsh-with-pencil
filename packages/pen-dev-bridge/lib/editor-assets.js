import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', map: 'application/json', wasm: 'application/wasm',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon', txt: 'text/plain',
  glsl: 'text/plain', pen: 'application/octet-stream',
}
const TEXT_EXTENSIONS = new Set(['html', 'js', 'mjs', 'css', 'json', 'map', 'svg', 'txt', 'glsl'])

/** Locate and serve the official Pencil editor bundle with the Harness IPC bootstrap. */
export function createEditorAssets({ bindingOf, urlOf }) {
  const packageDir = path.dirname(fileURLToPath(import.meta.url))
  let rawIndex
  let resolvedEditorDir

  function editorDirectory() {
    if (resolvedEditorDir) return resolvedEditorDir
    const candidates = []
    if (process.env.DSH_PEN_EDITOR_DIR) candidates.push(path.resolve(process.env.DSH_PEN_EDITOR_DIR))
    candidates.push(path.resolve(packageDir, '../editor/out'))
    candidates.push(path.resolve(packageDir, '../../../../pen-editor/out'))
    let cursor = packageDir
    for (let depth = 0; depth < 5; depth += 1) {
      const manifest = path.join(cursor, 'package.json')
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        const spec = pkg && pkg.dependencies && pkg.dependencies['pen-dev-bridge-bundle']
        if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
          const bundleDir = path.resolve(cursor, spec.slice(spec.indexOf(':') + 1))
          candidates.push(path.resolve(bundleDir, '../../..', 'pen-editor/out'))
        }
      } catch (error) { /* not a profile manifest */ }
      const parent = path.dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
    for (const candidate of candidates) {
      try {
        if (fs.statSync(path.join(candidate, 'index.html')).isFile()) {
          resolvedEditorDir = candidate
          return candidate
        }
      } catch (error) { /* try the next independent resource location */ }
    }
    throw new Error('pen-editor assets unavailable; set DSH_PEN_EDITOR_DIR to pen-editor/out')
  }

  function injectBootstrap(html, binding) {
    const bindingKey = JSON.stringify(binding.key)
    const penFile = JSON.stringify(binding.currentFile)
    const boot = `
<script>
var __penBinding = ${bindingKey};
var __penFile = ${penFile};
function __penHostUrl(path) { return path + '?binding=' + encodeURIComponent(__penBinding); }
function __penDecodeResponse(resp) {
  var encoded = resp && resp.payload && resp.payload.__penBinaryBase64;
  if (typeof encoded !== 'string') return resp;
  var raw = atob(encoded);
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  resp.payload = bytes.buffer;
  return resp;
}
window.vscodeapi = {
  postMessage: function (msg) {
    fetch(__penHostUrl('/pen-host/ipc'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) })
      .then(function (r) { return r.json() })
      .then(__penDecodeResponse)
      .then(function (resp) { window.postMessage(resp, '*') })
      .catch(function (err) { console.error('[penhost] ipc error', err) })
  },
  getState: function () { return {} },
  setState: function () {}
};
var __penToken = null;
try {
  var __xhr = new XMLHttpRequest();
  __xhr.open('GET', __penHostUrl('/pen-session-token'), false);
  __xhr.send();
  if (__xhr.status === 200) { __penToken = JSON.parse(__xhr.responseText).token; }
} catch (e) {}
window.PENCIL_APP_NAME = 'cli';
window.PENCIL_INIT_PARAMS = {
  hostVersion: '0.1.94',
  editorVersion: '0.1.94',
  appName: 'cli',
  apiHostName: 'https://api.pencil.dev',
  displayName: 'DeepSeek Harness',
  sessionToken: __penToken,
  isTemporary: false,
  fileURI: 'file://' + __penFile
};
function __penPoll() {
  fetch(__penHostUrl('/pen-host/pending'), { method: 'GET' })
    .then(function (r) { return r.json() })
    .then(function (d) {
      if (d && Array.isArray(d.messages)) {
        for (var i = 0; i < d.messages.length; i++) window.postMessage(d.messages[i], '*')
      }
      setTimeout(__penPoll, 0);
    })
    .catch(function () { setTimeout(__penPoll, 1000); });
}
__penPoll();
</script>`
    const marker = '<script type="module"'
    const index = html.indexOf(marker)
    if (index === -1) return html
    return html.slice(0, index) + boot + '\n    ' + html.slice(index)
  }

  function editorIndex() {
    if (rawIndex !== undefined) return rawIndex
    rawIndex = fs.readFileSync(path.join(editorDirectory(), 'index.html'), 'utf8')
    return rawIndex
  }

  async function serve(req, res) {
    const pathname = urlOf(req).pathname
    const relative = pathname.slice('/pen-editor'.length) || '/index.html'
    if (relative.includes('..')) { res.writeHead(403); res.end('forbidden'); return }
    if (relative === '/index.html') {
      const binding = bindingOf(req)
      if (!binding) { res.writeHead(401); res.end('bind the canvas to a conversation first'); return }
      let servedIndex
      try { servedIndex = injectBootstrap(editorIndex(), binding) }
      catch (error) { res.writeHead(503); res.end(error.message); return }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(servedIndex)
      return
    }
    let full
    try { full = path.join(editorDirectory(), relative) }
    catch (error) { res.writeHead(503); res.end(error.message); return }
    let stat
    try { stat = await fsp.stat(full) } catch (error) { res.writeHead(404); res.end('not found'); return }
    if (!stat.isFile()) { res.writeHead(404); res.end('not found'); return }
    const dot = relative.lastIndexOf('.')
    const extension = dot >= 0 ? relative.slice(dot + 1).toLowerCase() : ''
    const mediaType = MIME[extension] || 'application/octet-stream'
    try {
      if (TEXT_EXTENSIONS.has(extension)) {
        res.writeHead(200, { 'Content-Type': mediaType })
        res.end(await fsp.readFile(full, 'utf8'))
      } else {
        const buffer = await fsp.readFile(full)
        res.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': String(buffer.byteLength) })
        res.end(buffer)
      }
    } catch (error) {
      res.writeHead(500); res.end('serve error')
    }
  }

  return { serve }
}
