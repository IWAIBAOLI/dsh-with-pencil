import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installOfficialEditor } from './editor-installer.js'

const MIME = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', map: 'application/json', wasm: 'application/wasm',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon', txt: 'text/plain',
  glsl: 'text/plain', pen: 'application/octet-stream',
}
const TEXT_EXTENSIONS = new Set(['html', 'js', 'mjs', 'css', 'json', 'map', 'svg', 'txt', 'glsl'])

/** Locate and serve the official Pencil editor bundle with the Harness IPC bootstrap. */
export function createEditorAssets({
  bindingOf, urlOf, editorInstaller = installOfficialEditor, editorCacheRoot, editorFetch,
  editorDirectories,
}) {
  const packageDir = path.dirname(fileURLToPath(import.meta.url))
  let rawIndex
  let resolvedEditorDir

  async function editorDirectory() {
    if (resolvedEditorDir) return resolvedEditorDir
    const candidates = editorDirectories === undefined ? [] : editorDirectories.map(directory => path.resolve(directory))
    if (editorDirectories === undefined) {
      if (process.env.DSH_PEN_EDITOR_DIR) candidates.push(path.resolve(process.env.DSH_PEN_EDITOR_DIR))
      candidates.push(path.resolve(packageDir, '../editor/out'))
      candidates.push(path.resolve(packageDir, '../../pen-editor/out'))
      let cursor = packageDir
      for (let depth = 0; depth < 5; depth += 1) {
        const manifest = path.join(cursor, 'package.json')
        try {
          const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
          const spec = pkg && pkg.dependencies && (pkg.dependencies['dsh-with-pencil'] || pkg.dependencies['pen-dev-bridge'])
          if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
            const integrationDir = path.resolve(cursor, spec.slice(spec.indexOf(':') + 1))
            candidates.push(path.resolve(integrationDir, '../pen-editor/out'))
          }
        } catch (error) { /* not a profile manifest */ }
        const parent = path.dirname(cursor)
        if (parent === cursor) break
        cursor = parent
      }
    }
    for (const candidate of candidates) {
      try {
        if (fs.statSync(path.join(candidate, 'index.html')).isFile()) {
          resolvedEditorDir = candidate
          return candidate
        }
      } catch (error) { /* try the next independent resource location */ }
    }
    try {
      resolvedEditorDir = await editorInstaller({ cacheRoot: editorCacheRoot, fetchImpl: editorFetch })
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      throw new Error(`${message}; retry the canvas open or set DSH_PEN_EDITOR_DIR for offline use`)
    }
    return resolvedEditorDir
  }

  function injectBootstrap(html, binding) {
    const bindingKey = JSON.stringify(binding.key)
    const penFile = JSON.stringify(binding.currentFile)
    const boot = `
<script>
var __penBinding = ${bindingKey};
var __penFile = ${penFile};
function __penHostUrl(path) { return path + '?binding=' + encodeURIComponent(__penBinding); }
function __penBytesToBase64(bytes) {
  var chunks = [];
  for (var offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768)));
  }
  return btoa(chunks.join(''));
}
function __penEncodeValue(value) {
  if (value instanceof ArrayBuffer) return { __penBinaryBase64: __penBytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { __penBinaryBase64: __penBytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map(__penEncodeValue);
  if (value && typeof value === 'object') {
    var encoded = {};
    for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) encoded[key] = __penEncodeValue(value[key]);
    return encoded;
  }
  return value;
}
function __penDecodeValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.__penBinaryBase64 === 'string') {
    var raw = atob(value.__penBinaryBase64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }
  if (Array.isArray(value)) return value.map(__penDecodeValue);
  for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) value[key] = __penDecodeValue(value[key]);
  return value;
}
function __penDecodeResponse(resp) {
  if (!resp || typeof resp !== 'object') return resp;
  resp.payload = __penDecodeValue(resp.payload);
  return resp;
}
var __penLastTheme = null;
function __penResolvedTheme() {
  try {
    var parentRoot = window.parent.document.documentElement;
    var parentScheme = parentRoot.style.colorScheme || window.parent.getComputedStyle(parentRoot).colorScheme;
    if (String(parentScheme).indexOf('dark') !== -1) return 'dark';
    if (String(parentScheme).indexOf('light') !== -1) return 'light';
    if (window.parent.document.body.hasAttribute('data-ds-dark-theme')) return 'dark';
  } catch (e) {}
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function __penSyncTheme(force) {
  var theme = __penResolvedTheme();
  if (!force && theme === __penLastTheme) return;
  __penLastTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.classList.add(theme);
  window.postMessage({
    id: 'penhost-theme-' + Date.now(), type: 'notification',
    method: 'color-theme-changed', payload: { theme: theme }
  }, '*');
}
function __penWatchTheme() {
  try {
    var parentDocument = window.parent.document;
    var observer = new MutationObserver(function () { __penSyncTheme(false); });
    observer.observe(parentDocument.documentElement, { attributes: true, attributeFilter: ['style'] });
    observer.observe(parentDocument.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme'] });
  } catch (e) {}
  if (window.matchMedia) {
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    if (media.addEventListener) media.addEventListener('change', function () { __penSyncTheme(false); });
    else if (media.addListener) media.addListener(function () { __penSyncTheme(false); });
  }
}
__penSyncTheme(true);
__penWatchTheme();
window.vscodeapi = {
  postMessage: function (msg) {
    if (msg && msg.method === 'initialized') setTimeout(function () { __penSyncTheme(true); }, 0);
    fetch(__penHostUrl('/pen-host/ipc'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(__penEncodeValue(msg)) })
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

  async function editorIndex() {
    if (rawIndex !== undefined) return rawIndex
    rawIndex = await fsp.readFile(path.join(await editorDirectory(), 'index.html'), 'utf8')
    return rawIndex
  }

  async function preflight() {
    const directory = await editorDirectory()
    const html = await editorIndex()
    if (!html.includes('<script type="module"')) {
      throw new Error('pen-editor index.html is incompatible: module entrypoint not found')
    }
    return { directory }
  }

  async function serve(req, res) {
    const pathname = urlOf(req).pathname
    const relative = pathname.slice('/pen-editor'.length) || '/index.html'
    if (relative.includes('..')) { res.writeHead(403); res.end('forbidden'); return }
    if (relative === '/index.html') {
      const binding = bindingOf(req)
      if (!binding) { res.writeHead(401); res.end('bind the canvas to a conversation first'); return }
      let servedIndex
      try { servedIndex = injectBootstrap(await editorIndex(), binding) }
      catch (error) { res.writeHead(503); res.end(error.message); return }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(servedIndex)
      return
    }
    let full
    try { full = path.join(await editorDirectory(), relative) }
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

  return { preflight, serve }
}
