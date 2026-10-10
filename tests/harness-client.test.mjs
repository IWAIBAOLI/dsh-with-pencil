import assert from 'node:assert/strict'

const { Config, default: host } = await import('../lib/index.js')
assert.equal(host.Config, Config)
assert.equal(Config.dict.visionMode.meta.default, 'multimodal')
assert.equal(Config.dict.visionMode.meta.volatile, true)

const state = []
let hook = 0
let effects = []
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) { return { type, props: { ...props, children } } },
  useState(initial) {
    const index = hook++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  },
  useRef(initial) { return { current: initial } },
  useEffect(effect) { effects.push(effect) },
  useCallback(callback) { return callback },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
}
let client
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.equal(id, 'dsh-with-pencil')
      client = factory((name) => {
        assert.equal(name, 'react')
        return React
      })
    },
  },
}
try {
  await import('../lib/client.js')
} finally {
  delete globalThis.window
}
assert.deepEqual(client.inject, ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'])

const entries = new Map()
const locale = { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }
const opened = []
const fetches = []
const requests = []
let failSave = false
let mounted = 'one'
let tabs = []
let closeHandler
let tabDefinition
const sidebarRight = {
  mounted: { getSnapshot: () => mounted, subscribe: () => () => {} },
  openTabs: { getSnapshot: () => tabs, subscribe: () => () => {} },
  openTab(kind) { opened.push(kind) },
  focus() {},
  registerCloseHandler(kind, handler) { assert.equal(kind, 'dsh-with-pencil'); closeHandler = handler; return () => { closeHandler = undefined } },
}
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  fetches.push(url)
  requests.push({ url, options })
  if (failSave && url.startsWith('/pen-host/save?')) return { ok: false, async text() { return 'disk full' } }
  if (url.startsWith('/pen-host/file?')) return { ok: true, async json() { return { file: '/project/designs/new.pen' } } }
  return { ok: true, async json() { return { binding: 'binding-one', workspace: '/project', file: '/project/design.pen' } }, async text() { return '' } }
}
const dispose = client.apply({
  locale,
  sidebarRight,
  sidebarRightTabs: { register(definition) { tabDefinition = definition; return () => { tabDefinition = undefined } } },
  slots: {
    inject(_name, mount) { return mount() },
    register(options, render) {
      entries.set(options.name, { options, render })
      return () => entries.delete(options.name)
    },
  },
})

const row = entries.get('plugins.row.config')
assert.equal(row.options.key, 'dsh-with-pencil#dsh-with-pencil')
assert.equal(row.render({ view: 'summary' }), 'Screenshot vision mode')
const writes = []
const form = {
  state: { status: 'ready', value: { visionMode: 'multimodal' }, user: {}, revision: 7, writable: true },
  async mutate(ops, revision) { writes.push({ ops, revision }); return true },
}
const element = row.render({ view: 'page', form })
assert.equal(typeof element.type, 'function')
function render() { hook = 0; return element.type(element.props) }
function find(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean)
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  return find(node.props?.children, predicate)
}
let tree = render()
const multimodal = find(tree, (node) => node.type === 'input' && node.props.value === 'multimodal')
assert.equal(multimodal.props.checked, true)
const textMode = find(tree, (node) => node.type === 'input' && node.props.value === 'text')
assert.equal(textMode.props.checked, false)
textMode.props.onChange()
tree = render()
const save = find(tree, (node) => node.type === 'button' && node.props.className?.includes('settings-btn-save'))
assert.equal(save.props.disabled, false)
await save.props.onClick()
assert.deepEqual(writes[0], { ops: [{ op: 'set', path: ['visionMode'], value: 'text' }], revision: 7 })

form.state = { ...form.state, value: { visionMode: 'text' }, user: { visionMode: 'text' }, revision: 8 }
tree = render()
const reset = find(tree, (node) => node.type === 'button' && node.props.className?.includes('settings-btn-reset'))
assert.equal(reset.props.disabled, false)
await reset.props.onClick()
assert.deepEqual(writes[1], { ops: [{ op: 'unset', path: ['visionMode'] }], revision: 8 })

const sessions = {
  byId: {
    one: { id: 'one', cwd: '/project', blank: false },
    two: { id: 'two', cwd: '/other', blank: true },
  },
}
const useSessions = (select) => select(sessions)
assert.deepEqual(Object.keys(tabDefinition).sort(), ['id', 'keepMounted', 'kind', 'title'])
assert.equal(tabDefinition.kind, 'dsh-with-pencil')
assert.equal(tabDefinition.keepMounted, true)
assert.equal(entries.has('shell.overlay'), false)
assert.equal(entries.get('sidebar.right.pane.tab').options.key, tabDefinition.id)
assert.equal(entries.get('sidebar.right.pane.tab.title').options.key, tabDefinition.id)
const title = entries.get('sidebar.right.pane.tab.title').render({})
assert.equal(title.type(title.props), 'pen.dev Canvas')
const header = entries.get('conversation.session.header.actions').render({ sessionId: 'one', useSessions })
const store = header.props.store
const headerButton = header.type(header.props)
assert.equal(headerButton.props.disabled, false)
headerButton.props.onClick()
assert.deepEqual(opened, ['dsh-with-pencil'])
mounted = 'two'
const blank = entries.get('conversation.input.right').render({ sessionId: 'two', useSessions })
blank.type(blank.props).props.onClick()
assert.deepEqual(opened, ['dsh-with-pencil', 'dsh-with-pencil'])

mounted = 'one'
tabs = [{ sessionId: 'one', tabId: 'tab-one', kind: 'dsh-with-pencil' }]
store.patch('one', { binding: 'binding-one', workspace: '/project', file: '/project/design.pen' })
const controller = new AbortController()
const record = { id: 'tab-one', signal: controller.signal, actions: {
  close() { closeHandler('one', { id: 'tab-one' }); tabs = []; controller.abort() },
} }
effects = []
const body = entries.get('sidebar.right.pane.tab').render({ sessionId: 'one', useSessions, useTabInfo: () => ({ tab: record }) })
const canvas = body.type(body.props)
assert.equal(canvas.type.name, 'PenCanvas')
for (const effect of effects) effect()
assert.throws(() => closeHandler('one', { id: 'tab-one' }), /saving before the tab closes/)
await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(fetches, ['/pen-host/save?binding=binding-one', '/pen-host/unbind?binding=binding-one'])
assert.equal(store.getSnapshot().sessions.one, undefined)

tabs = [{ sessionId: 'one', tabId: 'tab-a', kind: 'dsh-with-pencil' }, { sessionId: 'one', tabId: 'tab-b', kind: 'dsh-with-pencil' }]
const duplicate = entries.get('sidebar.right.pane.tab').render({ sessionId: 'one', useSessions, useTabInfo: () => ({ tab: { id: 'tab-b', signal: new AbortController().signal, actions: {} } }) })
assert.equal(duplicate.type(duplicate.props).props.children[0], 'Canvas is open in another tab')

tabs = [{ sessionId: 'two', tabId: 'restored-two', kind: 'dsh-with-pencil' }]
effects = []
const restored = entries.get('sidebar.right.pane.tab').render({ sessionId: 'two', useSessions, useTabInfo: () => ({ tab: { id: 'restored-two', signal: new AbortController().signal, actions: {} } }) })
assert.equal(restored.type(restored.props).props.role, 'status')
for (const effect of effects) effect()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(fetches.at(-1), '/pen-host/bind')
assert.equal(store.getSnapshot().sessions.two.binding, 'binding-one')
failSave = true
assert.throws(() => closeHandler('two', { id: 'restored-two' }), /saving before the tab closes/)
await new Promise((resolve) => setImmediate(resolve))
assert.equal(tabs[0].tabId, 'restored-two')
assert.equal(store.getSnapshot().sessions.two.saveError, 'disk full')

state.length = 0
hook = 0
let panel = canvas.type(canvas.props)
const fileMenu = find(panel, (node) => node.type === 'button' && node.props.className === 'dsh-penhost-menu-btn' && node.props.children[0] === 'design.pen')
fileMenu.props.onClick()
hook = 0
panel = canvas.type(canvas.props)
const newFile = find(panel, (node) => node.type === 'button' && node.props.children[0] === 'New .pen file…')
newFile.props.onClick()
hook = 0
panel = canvas.type(canvas.props)
let dialog = find(panel, (node) => node.type === 'form' && node.props.role === 'dialog')
assert.equal(dialog.props['aria-label'], 'New .pen file (relative to this workspace)')
assert.equal(find(dialog, (node) => node.type === 'input').props.value, 'designs/untitled.pen')
find(dialog, (node) => node.type === 'input').props.onChange({ target: { value: 'designs/new' } })
hook = 0
panel = canvas.type(canvas.props)
dialog = find(panel, (node) => node.type === 'form' && node.props.role === 'dialog')
await dialog.props.onSubmit({ preventDefault() {} })
assert.equal(requests.at(-1).url, '/pen-host/file?binding=binding-one')
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { file: 'designs/new.pen', create: true })
assert.equal(store.getSnapshot().sessions.one.file, '/project/designs/new.pen')
hook = 0
panel = canvas.type(canvas.props)
assert.equal(find(panel, (node) => node.type === 'form' && node.props.role === 'dialog'), undefined)

dispose()
assert.equal(entries.size, 0)
assert.equal(tabDefinition, undefined)
globalThis.fetch = originalFetch
console.log('Client config form and native Sidebar tab (contract fixtures): ok')
