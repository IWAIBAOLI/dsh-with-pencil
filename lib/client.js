window.__ModuleLoader__.load({
	id: "dsh-with-pencil",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require('react')

		// Browser half. Canvas state is keyed by Harness session id. The root
		// overlay follows useSessions().current, while each header action mutates
		// only its own session entry.
		const STYLE_TAG_ID = 'dsh-with-pencil/canvas.css'
		const CSS = `
.dsh-penhost-panel { display: flex; flex-direction: column; color-scheme: light dark; background: var(--dsw-alias-bg-overlay, Canvas); color: var(--dsw-alias-label-primary, CanvasText); border: 1px solid var(--dsw-alias-border-l2, GrayText); font: 13px/1.5 system-ui, -apple-system, sans-serif; overflow: hidden; }
.dsh-penhost-panel[hidden] { display: none !important; }
.dsh-penhost-panel * { box-sizing: border-box; }
.dsh-penhost-split { position: fixed; top: 0; bottom: 0; right: 0; z-index: 9996; pointer-events: auto; border-radius: 0; border-top: none; border-right: none; border-bottom: none; box-shadow: -8px 0 24px rgba(0,0,0,.25); }
.dsh-penhost-float { position: fixed; z-index: 9998; pointer-events: auto; border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.45); }
.dsh-penhost-resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 3; }
.dsh-penhost-resize::after { content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 4px; height: 44px; border-radius: 3px; background: var(--dsw-alias-border-l2, #3a3d4a); }
.dsh-penhost-resize:hover::after { background: var(--dsw-alias-brand-primary, #4f7cff); }
.dsh-penhost-head { position: relative; display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 6px 8px 6px 10px; cursor: grab; background: var(--dsw-alias-bg-layer-1, #26272e); border-bottom: 1px solid var(--dsw-alias-border-l1, #34353d); user-select: none; }
.dsh-penhost-split .dsh-penhost-head { cursor: default; }
.dsh-penhost-brand { flex: 0 0 auto; margin-right: 2px; font-size: 13px; white-space: nowrap; }
.dsh-penhost-menu-wrap { position: relative; min-width: 0; }
.dsh-penhost-workspace-wrap { max-width: 34%; }
.dsh-penhost-file-wrap { flex: 1 1 auto; }
.dsh-penhost-export-wrap { flex: 0 0 auto; }
.dsh-penhost-export-wrap .dsh-penhost-menu { left: auto; right: 0; min-width: 245px; }
.dsh-penhost-menu-btn { display: block; width: 100%; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #a8adbd); cursor: pointer; font: inherit; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.dsh-penhost-menu-btn:hover, .dsh-penhost-menu-btn[aria-expanded="true"] { color: var(--dsw-alias-label-primary, CanvasText); background: color-mix(in srgb, currentColor 7%, transparent); border-color: var(--dsw-alias-border-l1, GrayText); }
.dsh-penhost-menu { position: absolute; left: 0; top: calc(100% + 5px); z-index: 8; min-width: 230px; max-width: min(420px, 80vw); padding: 4px; border: 1px solid var(--dsw-alias-border-inverted, rgba(15,23,42,.09)); border-radius: 10px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, Canvas)); box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(15,23,42,.12), 0 2px 6px rgba(15,23,42,.06)); }
.dsh-penhost-path { padding: 7px 8px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; user-select: text; }
.dsh-penhost-menu-sep { height: 1px; margin: 4px 3px; background: var(--dsw-alias-border-l1, #34353d); }
.dsh-penhost-menu-item { display: flex; width: 100%; min-height: 30px; align-items: center; gap: 7px; padding: 5px 8px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary, CanvasText); cursor: pointer; font: inherit; font-size: 12px; text-align: left; }
.dsh-penhost-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
.dsh-penhost-menu-item:disabled { cursor: wait; opacity: .55; }
.dsh-penhost-file-choice::before { content: ''; flex: 0 0 12px; }
.dsh-penhost-file-choice[aria-current="true"]::before { content: '✓'; color: var(--dsw-alias-brand-primary, #4f7cff); }
.dsh-penhost-menu-note { padding: 7px 8px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 11px; }
body[data-ds-dark-theme] .dsh-penhost-menu { background: var(--dsw-specific-menu, #202126); box-shadow: var(--dsw-shadow-lv3, 0 10px 28px rgba(0,0,0,.32)); }
.dsh-penhost-control { display: inline-flex; min-height: 28px; align-items: center; justify-content: center; gap: 5px; padding: 3px 9px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font: inherit; font-size: 12px; line-height: 20px; white-space: nowrap; }
.dsh-penhost-control:hover, .dsh-penhost-control[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); color: var(--dsw-alias-label-primary, CanvasText); }
.dsh-penhost-control:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff); outline-offset: 1px; }
.dsh-penhost-control:disabled { cursor: wait; opacity: .55; }
.dsh-penhost-mode { flex: 0 0 auto; }
.dsh-penhost-conflict { color: #ffb454; border-color: #ffb454; white-space: nowrap; }
.dsh-penhost-conflict-menu { left: auto; right: 0; width: 310px; }
.dsh-penhost-save-error { color: #ff8f8f; border-color: #ff8f8f; white-space: nowrap; }
.dsh-penhost-danger { color: #ff8f8f; }
.dsh-penhost-close { margin-left: auto; border: none; background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font-size: 13px; padding: 2px 8px; border-radius: 6px; }
.dsh-penhost-close:hover { background: color-mix(in srgb, currentColor 8%, transparent); color: var(--dsw-alias-label-primary, CanvasText); }
.dsh-penhost-body { flex: 1; min-height: 0; }
.dsh-penhost-frame { width: 100%; height: 100%; border: none; color-scheme: light dark; background: var(--dsw-alias-bg-layer-1, Canvas); }
html[data-penhost-pointer] { user-select: none !important; }
html[data-penhost-pointer] .dsh-penhost-frame { pointer-events: none !important; }
html[data-penhost-pointer="resize"], html[data-penhost-pointer="resize"] * { cursor: col-resize !important; }
html[data-penhost-pointer="drag"], html[data-penhost-pointer="drag"] * { cursor: grabbing !important; }
.dsh-penhost-header-btn { vertical-align: middle; }
.dsh-penhost-header-on { color: var(--dsw-alias-brand-primary, #4f7cff); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 10%, transparent); }
.dsh-penhost-header-error { color: #ef7373; }
.dsh-penhost-input-btn { width: 34px; height: 30px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font-size: 15px; }
.dsh-penhost-input-btn:hover { background: var(--dsw-alias-bg-layer-1, #26272e); color: var(--dsw-alias-label-primary, #eee); }
.dsh-penhost-input-btn:disabled { cursor: wait; opacity: .55; }
[data-penhost-wide] { grid-template-columns: var(--penhost-grid) !important; }
[data-penhost-wide] > div:nth-child(3) { visibility: hidden; }
`

		const DEFAULT_SPLIT_RATIO = 0.42
		const EMPTY_SESSION = Object.freeze({ open: false, mode: 'split', ratio: DEFAULT_SPLIT_RATIO, pos: null, binding: null, workspace: null, file: null, conflict: null, saveError: null, loading: false, error: null })

		function insertStyles() {
			if (typeof document === 'undefined') return () => {}
			if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return () => {}
			const tag = document.createElement('style')
			tag.dataset.plugin = 'dsh-with-pencil'
			tag.dataset.pluginCss = STYLE_TAG_ID
			tag.textContent = CSS
			document.head.appendChild(tag)
			return () => tag.remove()
		}

		function createSessionStore() {
			let snapshot = { sessions: {} }
			const listeners = new Set()
			const emit = () => { for (const listener of listeners) listener() }
			const patch = (sessionId, update) => {
				const previous = snapshot.sessions[sessionId] || EMPTY_SESSION
				const next = typeof update === 'function' ? update(previous) : { ...previous, ...update }
				snapshot = { sessions: { ...snapshot.sessions, [sessionId]: next } }
				emit()
			}
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
				patch,
				remove(sessionId) {
					if (!snapshot.sessions[sessionId]) return
					const sessions = { ...snapshot.sessions }
					delete sessions[sessionId]
					snapshot = { sessions }
					emit()
				},
				clear() { snapshot = { sessions: {} }; listeners.clear() },
			}
		}

		function useBridgeSnapshot(store) {
			return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
		}

		function languageFromLocale(locale) {
			const snapshot = locale.getSnapshot()
			return String(snapshot && snapshot.active || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
		}

		function useHarnessLanguage(locale) {
			const subscribe = React.useCallback((listener) => locale.subscribe(listener), [locale])
			const getSnapshot = React.useCallback(() => locale.getSnapshot(), [locale])
			const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
			return String(snapshot && snapshot.active || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
		}

		const LOCALIZED_CANVAS_LABELS = {
			zh: {
				canvas: 'pen.dev 画布', canvasLoading: '正在绑定…', canvasError: '画布出错', openCanvas: '在当前会话工作区打开 pen.dev 画布', noWorkspace: '当前会话没有工作区',
				workspace: '工作区', openWorkspace: '打开工作区文件夹',
				chooseFile: '选择 .pen 文件', newFile: '新建 .pen 文件…', newFilePrompt: '新建 .pen 文件（相对于当前工作区）',
				saveAs: '另存为…', saveAsPrompt: '另存为（相对于当前工作区，不会覆盖已有文件）',
				findingFiles: '正在查找 .pen 文件…', noFiles: '工作区内没有 .pen 文件',
				export: '导出', exportHint: '有选区时导出选区，否则导出全部顶层元素。',
				exportPng: '导出 PNG（2×）', exportingPng: '正在导出 PNG…', exportPdf: '导出 PDF', exportingPdf: '正在导出 PDF…',
				exportedSelection: '已导出选区', exportedDocument: '已导出当前文档', files: '个文件', openExports: '打开导出文件夹',
				float: '浮窗', split: '分屏', switchToFloat: '切换为浮动窗口', switchToSplit: '切换为右侧分屏', close: '关闭', resize: '拖动调整宽度', editorTitle: 'pen.dev 画布编辑器',
				diskConflict: '磁盘冲突', reloadDisk: '重新加载磁盘版本', overwriteDisk: '保留画布并覆盖磁盘', saveFailed: '保存失败', retrySave: '重试保存',
			},
			en: {
				canvas: 'pen.dev Canvas', canvasLoading: 'Connecting…', canvasError: 'Canvas error', openCanvas: 'Open the pen.dev canvas in this conversation workspace', noWorkspace: 'This conversation has no workspace',
				workspace: 'Workspace', openWorkspace: 'Open workspace folder',
				chooseFile: 'Choose a .pen file', newFile: 'New .pen file…', newFilePrompt: 'New .pen file (relative to this workspace)',
				saveAs: 'Save As…', saveAsPrompt: 'Save As (relative to this workspace; existing files are not overwritten)',
				findingFiles: 'Finding .pen files…', noFiles: 'No .pen files in this workspace',
				export: 'Export', exportHint: 'Exports the selection, or all top-level elements when nothing is selected.',
				exportPng: 'Export PNG (2×)', exportingPng: 'Exporting PNG…', exportPdf: 'Export PDF', exportingPdf: 'Exporting PDF…',
				exportedSelection: 'Selection exported', exportedDocument: 'Document exported', files: 'files', openExports: 'Open export folder',
				float: 'Float', split: 'Split', switchToFloat: 'Switch to floating window', switchToSplit: 'Switch to right split', close: 'Close', resize: 'Drag to resize', editorTitle: 'pen.dev canvas editor',
				diskConflict: 'Disk conflict', reloadDisk: 'Reload disk version', overwriteDisk: 'Keep canvas and overwrite disk', saveFailed: 'Save failed', retrySave: 'Retry save',
			},
		}

		async function openForSession(store, sessionId, workspace) {
			const current = store.getSnapshot().sessions[sessionId] || EMPTY_SESSION
			if (current.binding) { store.patch(sessionId, { open: true, error: null }); return }
			if (current.loading) return
			store.patch(sessionId, { loading: true, error: null })
			try {
				const response = await fetch('/pen-host/bind', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sessionId, workspace }),
				})
				if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
				const result = await response.json()
				store.patch(sessionId, {
					binding: result.binding,
					workspace: result.workspace,
					file: result.file,
					conflict: null,
					saveError: null,
					loading: false,
					open: true,
					error: null,
				})
			} catch (error) {
				store.patch(sessionId, { loading: false, open: false, error: error && error.message ? error.message : String(error) })
			}
		}

		function frameOf() {
			try {
				const overlay = document.querySelector('[data-shell-overlay]')
				return overlay ? overlay.parentElement : null
			} catch (error) { return null }
		}

		function pathName(value, fallback) {
			const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean)
			return parts[parts.length - 1] || fallback || 'Workspace'
		}

		function workspaceRelative(workspace, file) {
			const root = String(workspace || '').replace(/\\/g, '/').replace(/\/$/, '')
			const target = String(file || '').replace(/\\/g, '/')
			return root && target.startsWith(root + '/') ? target.slice(root.length + 1) : pathName(target)
		}

		function trackPointer(event, mode, ref, onMove) {
			const target = event.currentTarget
			const pointerId = event.pointerId
			let finished = false
			document.documentElement.dataset.penhostPointer = mode
			try { target.setPointerCapture(pointerId) } catch (error) { /* iframe shield remains as fallback */ }
			const finish = () => {
				if (finished) return
				finished = true
				window.removeEventListener('pointermove', onMove, true)
				window.removeEventListener('pointerup', finish, true)
				window.removeEventListener('pointercancel', finish, true)
				window.removeEventListener('blur', finish)
				target.removeEventListener('lostpointercapture', finish)
				if (document.documentElement.dataset.penhostPointer === mode) delete document.documentElement.dataset.penhostPointer
				try {
					if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
				} catch (error) { /* capture may already be gone */ }
				ref.current = null
			}
			ref.current = { finish }
			window.addEventListener('pointermove', onMove, true)
			window.addEventListener('pointerup', finish, true)
			window.addEventListener('pointercancel', finish, true)
			window.addEventListener('blur', finish)
			target.addEventListener('lostpointercapture', finish)
			return finish
		}

		function PenCanvas(props) {
			const { store, sessionId, state, active } = props
			const language = useHarnessLanguage(props.locale)
			const labels = LOCALIZED_CANVAS_LABELS[language]
			const dragRef = React.useRef(null)
			const resizeRef = React.useRef(null)
			const menusRef = React.useRef(null)
			const fileMenuRef = React.useRef(null)
			const exportMenuRef = React.useRef(null)
			const conflictMenuRef = React.useRef(null)
			const saveErrorMenuRef = React.useRef(null)
			const [menu, setMenu] = React.useState(null)
			const [files, setFiles] = React.useState([])
			const [filesLoading, setFilesLoading] = React.useState(false)
			const [menuError, setMenuError] = React.useState(null)
			const [exporting, setExporting] = React.useState(null)
			const [exportResult, setExportResult] = React.useState(null)
			const [viewportWidth, setViewportWidth] = React.useState(() => window.innerWidth)
			const clampWide = React.useCallback((value, viewport) => Math.min(Math.max(Math.round(value), 400), Math.max(400, viewport - 560)), [])
			const effectiveRatio = state.ratio || DEFAULT_SPLIT_RATIO
			const effectiveWide = clampWide(viewportWidth * effectiveRatio, viewportWidth)

			const applyGrid = React.useCallback((frame, width) => {
				try {
					const parts = String(getComputedStyle(frame).gridTemplateColumns).split(' ')
					frame.dataset.penhostWide = sessionId
					frame.style.setProperty('--penhost-grid', (parts[0] || '300px') + ' minmax(0, 1fr) ' + width + 'px')
				} catch (error) { /* shell may be between layouts */ }
			}, [sessionId])

			React.useLayoutEffect(() => {
				if (!active || !state.open || state.mode !== 'split') return
				const frame = frameOf()
				if (!frame) return
				const syncWidth = () => {
					const current = store.getSnapshot().sessions[sessionId] || EMPTY_SESSION
					const viewport = window.innerWidth
					const width = clampWide(viewport * (current.ratio || DEFAULT_SPLIT_RATIO), viewport)
					setViewportWidth(viewport)
					applyGrid(frame, width)
				}
				syncWidth()
				window.addEventListener('resize', syncWidth)
				return () => {
					window.removeEventListener('resize', syncWidth)
					if (frame.dataset.penhostWide === sessionId) {
						delete frame.dataset.penhostWide
						frame.style.removeProperty('--penhost-grid')
					}
				}
			}, [active, state.open, state.mode, sessionId, store, clampWide, applyGrid])

			React.useEffect(() => () => {
				const resize = resizeRef.current
				if (resize) resize.finish()
				const drag = dragRef.current
				if (drag) drag.finish()
			}, [])

			React.useEffect(() => {
				if (!menu) return
				const onOutside = (event) => {
					const inWorkspace = menusRef.current && menusRef.current.contains(event.target)
					const inFile = fileMenuRef.current && fileMenuRef.current.contains(event.target)
					const inExport = exportMenuRef.current && exportMenuRef.current.contains(event.target)
					const inConflict = conflictMenuRef.current && conflictMenuRef.current.contains(event.target)
					const inSaveError = saveErrorMenuRef.current && saveErrorMenuRef.current.contains(event.target)
					if (!inWorkspace && !inFile && !inExport && !inConflict && !inSaveError) setMenu(null)
				}
				window.addEventListener('pointerdown', onOutside, true)
				return () => window.removeEventListener('pointerdown', onOutside, true)
			}, [menu])

			React.useEffect(() => {
				if (!state.binding) return
				let disposed = false
				const sync = async () => {
					try {
						const response = await fetch('/pen-host/state?binding=' + encodeURIComponent(state.binding))
						if (!response.ok) return
						const result = await response.json()
						const current = store.getSnapshot().sessions[sessionId] || EMPTY_SESSION
						if (!disposed && (result.file !== current.file || (result.conflict || null) !== (current.conflict || null) || (result.saveError || null) !== (current.saveError || null))) {
							store.patch(sessionId, { file: result.file || current.file, conflict: result.conflict || null, saveError: result.saveError || null })
						}
					} catch (error) { /* host may be restarting */ }
				}
				void sync()
				const timer = setInterval(sync, 1500)
				return () => { disposed = true; clearInterval(timer) }
			}, [state.binding, sessionId, store])

			const startResize = (event) => {
				if (state.mode !== 'split' || (event.button !== 0 && event.pointerType === 'mouse')) return
				event.preventDefault(); event.stopPropagation()
				if (resizeRef.current) resizeRef.current.finish()
				const frame = frameOf()
				const startX = event.clientX
				const startWide = effectiveWide
				const onMove = (moveEvent) => {
					const viewport = window.innerWidth
					const width = clampWide(startWide + startX - moveEvent.clientX, viewport)
					store.patch(sessionId, { ratio: width / viewport })
					if (frame) applyGrid(frame, width)
				}
				trackPointer(event, 'resize', resizeRef, onMove)
			}

			const startDrag = (event) => {
				if (state.mode !== 'float' || (event.button !== 0 && event.pointerType === 'mouse')) return
				event.preventDefault()
				if (dragRef.current) dragRef.current.finish()
				const initial = state.pos || { x: Math.max(12, window.innerWidth - 920), y: Math.max(12, window.innerHeight - 720) }
				const dx = event.clientX - initial.x
				const dy = event.clientY - initial.y
				const onMove = (moveEvent) => store.patch(sessionId, { pos: {
					x: Math.min(Math.max(8, moveEvent.clientX - dx), Math.max(8, window.innerWidth - 120)),
					y: Math.min(Math.max(8, moveEvent.clientY - dy), Math.max(8, window.innerHeight - 48)),
				} })
				trackPointer(event, 'drag', dragRef, onMove)
			}

			const loadFiles = async () => {
				setFilesLoading(true); setMenuError(null)
				try {
					const response = await fetch('/pen-host/files?binding=' + encodeURIComponent(state.binding))
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					const result = await response.json()
					setFiles(Array.isArray(result.files) ? result.files : [])
				} catch (error) {
					setMenuError(error && error.message ? error.message : String(error))
				} finally { setFilesLoading(false) }
			}

			const showFileMenu = () => {
				const next = menu === 'file' ? null : 'file'
				setMenu(next); setMenuError(null)
				if (next) void loadFiles()
			}

			const revealWorkspace = async () => {
				setMenuError(null)
				try {
					const response = await fetch('/pen-host/reveal?binding=' + encodeURIComponent(state.binding), { method: 'POST' })
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					setMenu(null)
				} catch (error) { setMenuError(error && error.message ? error.message : String(error)) }
			}

			const switchFile = async (file) => {
				setMenuError(null)
				try {
					const response = await fetch('/pen-host/file?binding=' + encodeURIComponent(state.binding), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }),
					})
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					const result = await response.json()
					store.patch(sessionId, { file: result.file, conflict: null, saveError: null, error: null })
					setMenu(null)
				} catch (error) { setMenuError(error && error.message ? error.message : String(error)) }
			}

			const resolveConflict = async (action) => {
				setMenuError(null)
				try {
					const response = await fetch('/pen-host/conflict?binding=' + encodeURIComponent(state.binding), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
					})
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					const result = await response.json()
					store.patch(sessionId, { file: result.file || state.file, conflict: result.conflict || null })
					setMenu(null)
				} catch (error) { setMenuError(error && error.message ? error.message : String(error)) }
			}

			const createFile = () => {
				let file = window.prompt(labels.newFilePrompt, 'designs/untitled.pen')
				if (file === null) return
				file = String(file).trim()
				if (!file) return
				if (!file.toLowerCase().endsWith('.pen')) file += '.pen'
				void switchFile(file)
			}

			const saveAs = async () => {
				const current = workspaceRelative(state.workspace, state.file) || 'designs/design.pen'
				const suggested = current.replace(/\.pen$/i, '-copy.pen')
				let file = window.prompt(labels.saveAsPrompt, suggested)
				if (file === null) return
				file = String(file).trim()
				if (!file) return
				if (!file.toLowerCase().endsWith('.pen')) file += '.pen'
				setMenuError(null)
				try {
					const response = await fetch('/pen-host/save-as?binding=' + encodeURIComponent(state.binding), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }),
					})
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					const result = await response.json()
					store.patch(sessionId, { file: result.file, conflict: null, saveError: null, error: null })
					setMenu(null)
				} catch (error) { setMenuError(error && error.message ? error.message : String(error)) }
			}

			const exportCanvas = async (format) => {
				if (exporting) return
				setMenuError(null); setExportResult(null); setExporting(format)
				try {
					const response = await fetch('/pen-host/export?binding=' + encodeURIComponent(state.binding), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }),
					})
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					const result = await response.json()
					const count = Array.isArray(result.files) ? result.files.length : 0
					setExportResult({ directory: result.directory, scope: result.scope, count })
				} catch (error) {
					setMenuError(error && error.message ? error.message : String(error))
				} finally { setExporting(null) }
			}

			const revealExport = async () => {
				if (!exportResult || !exportResult.directory) return
				setMenuError(null)
				try {
					const response = await fetch('/pen-host/reveal?binding=' + encodeURIComponent(state.binding), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: exportResult.directory }),
					})
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					setMenu(null)
				} catch (error) { setMenuError(error && error.message ? error.message : String(error)) }
			}

			const retrySave = async () => {
				setMenuError(null)
				try {
					const response = await fetch('/pen-host/save?binding=' + encodeURIComponent(state.binding), { method: 'POST' })
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					store.patch(sessionId, { saveError: null })
					setMenu(null)
				} catch (error) { setMenuError(error && error.message ? error.message : String(error)) }
			}

			const isSplit = state.mode === 'split'
			const workspaceLabel = pathName(state.workspace, labels.workspace)
			const currentFile = workspaceRelative(state.workspace, state.file)
			const visibleFiles = currentFile && !files.includes(currentFile) ? [currentFile, ...files] : files
			const position = state.pos || { x: Math.max(12, window.innerWidth - 920), y: Math.max(12, window.innerHeight - 720) }
			const style = isSplit
				? { right: 0, top: 0, bottom: 0, width: effectiveWide + 'px' }
				: { left: position.x, top: position.y, width: 900, maxWidth: '96vw', height: 'min(700px, 90vh)' }
			const editorUrl = '/pen-editor/index.html?binding=' + encodeURIComponent(state.binding)
			return React.createElement('div', {
				className: 'dsh-penhost-panel' + (isSplit ? ' dsh-penhost-split' : ' dsh-penhost-float'),
				style,
				hidden: !active || !state.open,
				'data-pen-session': sessionId,
			},
				isSplit ? React.createElement('div', { className: 'dsh-penhost-resize', title: labels.resize, onPointerDown: startResize }) : null,
				React.createElement('div', { className: 'dsh-penhost-head', onPointerDown: startDrag },
					React.createElement('strong', { className: 'dsh-penhost-brand' }, '✏ pen.dev'),
					React.createElement('div', { className: 'dsh-penhost-menu-wrap dsh-penhost-workspace-wrap', ref: menusRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-menu-btn', title: state.workspace || '', 'aria-haspopup': 'menu', 'aria-expanded': menu === 'workspace',
							onClick: () => { setMenu(menu === 'workspace' ? null : 'workspace'); setMenuError(null) },
						}, '⌂ ' + workspaceLabel),
						menu === 'workspace' ? React.createElement('div', { className: 'dsh-penhost-menu', role: 'menu' },
							React.createElement('div', { className: 'dsh-penhost-path' }, state.workspace),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void revealWorkspace() } }, labels.openWorkspace),
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null),
					React.createElement('div', { className: 'dsh-penhost-menu-wrap dsh-penhost-file-wrap', ref: fileMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-menu-btn', title: state.file || '', 'aria-haspopup': 'menu', 'aria-expanded': menu === 'file', onClick: showFileMenu,
						}, currentFile || labels.chooseFile),
						menu === 'file' ? React.createElement('div', { className: 'dsh-penhost-menu', role: 'menu' },
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: createFile }, labels.newFile),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void saveAs() } }, labels.saveAs),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							filesLoading ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, labels.findingFiles) : null,
							!filesLoading && !visibleFiles.length ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, labels.noFiles) : null,
							!filesLoading ? visibleFiles.map((file) => React.createElement('button', {
								key: file, className: 'dsh-penhost-menu-item dsh-penhost-file-choice', role: 'menuitem', 'aria-current': file === currentFile ? 'true' : undefined,
								title: file, onClick: () => { if (file === currentFile) setMenu(null); else void switchFile(file) },
							}, file)) : null,
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null),
					React.createElement('div', { className: 'dsh-penhost-menu-wrap dsh-penhost-export-wrap', ref: exportMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-menu-btn', 'aria-haspopup': 'menu', 'aria-expanded': menu === 'export',
							onClick: () => { setMenu(menu === 'export' ? null : 'export'); setMenuError(null); setExportResult(null) },
						}, labels.export),
						menu === 'export' ? React.createElement('div', { className: 'dsh-penhost-menu', role: 'menu' },
							React.createElement('div', { className: 'dsh-penhost-menu-note' }, labels.exportHint),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', disabled: !!exporting, onClick: () => { void exportCanvas('png') } }, exporting === 'png' ? labels.exportingPng : labels.exportPng),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', disabled: !!exporting, onClick: () => { void exportCanvas('pdf') } }, exporting === 'pdf' ? labels.exportingPdf : labels.exportPdf),
							exportResult ? React.createElement(React.Fragment, null,
								React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
								React.createElement('div', { className: 'dsh-penhost-menu-note', title: exportResult.directory }, (exportResult.scope === 'selection' ? labels.exportedSelection : labels.exportedDocument) + ' · ' + exportResult.count + ' ' + labels.files + ' → ' + exportResult.directory),
								React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void revealExport() } }, labels.openExports)) : null,
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null),
					state.conflict ? React.createElement('div', { className: 'dsh-penhost-menu-wrap', ref: conflictMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-control dsh-penhost-mode dsh-penhost-conflict', title: state.conflict, 'aria-haspopup': 'menu', 'aria-expanded': menu === 'conflict',
							onClick: () => { setMenu(menu === 'conflict' ? null : 'conflict'); setMenuError(null) },
						}, labels.diskConflict),
						menu === 'conflict' ? React.createElement('div', { className: 'dsh-penhost-menu dsh-penhost-conflict-menu', role: 'menu' },
							React.createElement('div', { className: 'dsh-penhost-menu-note' }, state.conflict),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void resolveConflict('reload') } }, labels.reloadDisk),
							React.createElement('button', { className: 'dsh-penhost-menu-item dsh-penhost-danger', role: 'menuitem', onClick: () => { void resolveConflict('overwrite') } }, labels.overwriteDisk),
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null) : null,
					state.saveError ? React.createElement('div', { className: 'dsh-penhost-menu-wrap', ref: saveErrorMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-control dsh-penhost-mode dsh-penhost-save-error', title: state.saveError, 'aria-haspopup': 'menu', 'aria-expanded': menu === 'save-error',
							onClick: () => { setMenu(menu === 'save-error' ? null : 'save-error'); setMenuError(null) },
						}, labels.saveFailed),
						menu === 'save-error' ? React.createElement('div', { className: 'dsh-penhost-menu dsh-penhost-conflict-menu', role: 'menu' },
							React.createElement('div', { className: 'dsh-penhost-menu-note' }, state.saveError),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void retrySave() } }, labels.retrySave),
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null) : null,
					React.createElement('button', {
						className: 'dsh-penhost-control dsh-penhost-mode',
						title: isSplit ? labels.switchToFloat : labels.switchToSplit,
						onPointerDown: (event) => event.stopPropagation(),
						onClick: () => store.patch(sessionId, { mode: isSplit ? 'float' : 'split' }),
					}, isSplit ? labels.float : labels.split),
					React.createElement('button', {
						className: 'dsh-penhost-close', title: labels.close,
						onPointerDown: (event) => event.stopPropagation(),
						onClick: () => store.patch(sessionId, { open: false }),
					}, '✕')),
				React.createElement('div', { className: 'dsh-penhost-body' },
					React.createElement('iframe', { key: state.binding, className: 'dsh-penhost-frame', src: editorUrl, title: labels.editorTitle, allow: 'clipboard-read; clipboard-write' })))
		}

		function PenOverlay(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const current = props.useSessions((sessions) => sessions.current)
			const known = props.useSessions((sessions) => sessions.byId)
			React.useEffect(() => {
				for (const sessionId of Object.keys(snapshot.sessions)) {
					if (!known[sessionId] || (known[sessionId].blank === true && sessionId !== current)) {
						const binding = snapshot.sessions[sessionId] && snapshot.sessions[sessionId].binding
						if (binding) {
							void fetch('/pen-host/unbind?binding=' + encodeURIComponent(binding), { method: 'POST', keepalive: true })
								.catch(() => undefined)
						}
						props.store.remove(sessionId)
					}
				}
			}, [current, known, snapshot, props.store])
			return React.createElement(React.Fragment, null,
				Object.entries(snapshot.sessions).map(([sessionId, state]) => state.binding
					? React.createElement(PenCanvas, { key: sessionId, store: props.store, locale: props.locale, sessionId, state, active: sessionId === current })
					: null))
		}

		function PenHeader(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const labels = LOCALIZED_CANVAS_LABELS[useHarnessLanguage(props.locale)]
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			const workspace = props.useSessions((sessions) => sessions.byId[props.sessionId] && sessions.byId[props.sessionId].cwd)
			const className = 'dsh-penhost-control dsh-penhost-header-btn'
				+ (state.open ? ' dsh-penhost-header-on' : '')
				+ (state.error ? ' dsh-penhost-header-error' : '')
			return React.createElement('button', {
				className,
				disabled: state.loading,
				onClick: () => { void openForSession(props.store, props.sessionId, workspace) },
				title: state.error || (workspace ? labels.openCanvas : labels.noWorkspace),
			}, React.createElement('span', { 'aria-hidden': 'true' }, '✏'), state.loading ? labels.canvasLoading : state.error ? labels.canvasError : labels.canvas)
		}

		function PenBlankTrigger(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const labels = LOCALIZED_CANVAS_LABELS[useHarnessLanguage(props.locale)]
			const summary = props.useSessions((sessions) => sessions.byId[props.sessionId])
			if (!summary || summary.blank !== true) return null
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			return React.createElement('button', {
				className: 'dsh-penhost-input-btn',
				disabled: state.loading,
				'aria-label': labels.canvas,
				title: state.error || (summary.cwd ? labels.openCanvas : labels.noWorkspace),
				onClick: () => { void openForSession(props.store, props.sessionId, summary.cwd) },
			}, state.loading ? '…' : '✏')
		}

		const name = 'dsh-with-pencil'
		const inject = ['slots', 'locale']

		function apply(ctx) {
			const store = createSessionStore()
			const disposeStyles = insertStyles()
			const disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register(
				{ name: 'shell.overlay', id: 'penhost-canvas', order: 20 },
				(props) => React.createElement(PenOverlay, { ...props, store, locale: ctx.locale })))
			const disposeHeader = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
				{ name: 'conversation.session.header.actions', id: 'penhost-header', order: 90, label: () => LOCALIZED_CANVAS_LABELS[languageFromLocale(ctx.locale)].canvas },
				(props) => React.createElement(PenHeader, { ...props, store, locale: ctx.locale })))
			const disposeBlankTrigger = ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
				{ name: 'conversation.input.right', id: 'penhost-blank-trigger', order: 85, label: () => LOCALIZED_CANVAS_LABELS[languageFromLocale(ctx.locale)].canvas },
				(props) => React.createElement(PenBlankTrigger, { ...props, store, locale: ctx.locale })))
			return () => {
				if (typeof disposeBlankTrigger === 'function') disposeBlankTrigger()
				if (typeof disposeHeader === 'function') disposeHeader()
				if (typeof disposeOverlay === 'function') disposeOverlay()
				store.clear()
				disposeStyles()
			}
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;

		return module.exports;
	}
});
