window.__ModuleLoader__.load({
	id: "pen-dev-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require('react')

		// Browser half. Canvas state is keyed by Harness session id. The root
		// overlay follows useSessions().current, while each header action mutates
		// only its own session entry.
		const STYLE_TAG_ID = 'pen-dev-bridge/canvas.css'
		const CSS = `
.dsh-penhost-panel { display: flex; flex-direction: column; background: var(--dsw-alias-bg-overlay, #1d1e24); color: var(--dsw-alias-label-primary, #eee); border: 1px solid var(--dsw-alias-border-l2, #3a3d4a); font: 13px/1.5 system-ui, -apple-system, sans-serif; overflow: hidden; }
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
.dsh-penhost-menu-btn { display: block; width: 100%; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #a8adbd); cursor: pointer; font: inherit; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.dsh-penhost-menu-btn:hover, .dsh-penhost-menu-btn[aria-expanded="true"] { color: var(--dsw-alias-label-primary, #eee); background: rgba(255,255,255,.07); border-color: var(--dsw-alias-border-l1, #34353d); }
.dsh-penhost-menu { position: absolute; left: 0; top: calc(100% + 7px); z-index: 8; min-width: 230px; max-width: min(420px, 80vw); padding: 5px; border: 1px solid var(--dsw-alias-border-l2, #3a3d4a); border-radius: 9px; background: var(--dsw-alias-bg-overlay, #1d1e24); box-shadow: 0 12px 32px rgba(0,0,0,.42); }
.dsh-penhost-path { padding: 7px 8px; color: var(--dsw-alias-label-secondary, #9aa0b4); font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; user-select: text; }
.dsh-penhost-menu-sep { height: 1px; margin: 4px 3px; background: var(--dsw-alias-border-l1, #34353d); }
.dsh-penhost-menu-item { display: flex; width: 100%; align-items: center; gap: 7px; padding: 7px 8px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #eee); cursor: pointer; font: inherit; font-size: 12px; text-align: left; }
.dsh-penhost-menu-item:hover { background: rgba(255,255,255,.08); }
.dsh-penhost-menu-item[aria-current="true"]::before { content: '✓'; width: 12px; color: var(--dsw-alias-brand-primary, #4f7cff); }
.dsh-penhost-menu-item:not([aria-current="true"])::before { content: ''; width: 12px; }
.dsh-penhost-menu-note { padding: 8px; color: var(--dsw-alias-label-secondary, #9aa0b4); font-size: 11px; }
.dsh-penhost-mode { border: 1px solid var(--dsw-alias-border-l1, #34353d); background: transparent; color: var(--dsw-alias-label-primary, #eee); cursor: pointer; font-size: 11px; padding: 3px 8px; border-radius: 6px; }
.dsh-penhost-mode:hover { border-color: var(--dsw-alias-brand-primary, #4f7cff); }
.dsh-penhost-conflict { color: #ffb454; border-color: #ffb454; white-space: nowrap; }
.dsh-penhost-conflict-menu { left: auto; right: 0; width: 310px; }
.dsh-penhost-save-error { color: #ff8f8f; border-color: #ff8f8f; white-space: nowrap; }
.dsh-penhost-danger { color: #ff8f8f; }
.dsh-penhost-close { margin-left: auto; border: none; background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font-size: 13px; padding: 2px 8px; border-radius: 6px; }
.dsh-penhost-close:hover { background: rgba(255,255,255,.08); color: var(--dsw-alias-label-primary, #eee); }
.dsh-penhost-body { flex: 1; min-height: 0; }
.dsh-penhost-frame { width: 100%; height: 100%; border: none; background: #fff; }
html[data-penhost-pointer] { user-select: none !important; }
html[data-penhost-pointer] .dsh-penhost-frame { pointer-events: none !important; }
html[data-penhost-pointer="resize"], html[data-penhost-pointer="resize"] * { cursor: col-resize !important; }
html[data-penhost-pointer="drag"], html[data-penhost-pointer="drag"] * { cursor: grabbing !important; }
.dsh-penhost-header-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #34353d); background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font-size: 12px; }
.dsh-penhost-header-btn:hover { background: var(--dsw-alias-bg-layer-1, #26272e); color: var(--dsw-alias-label-primary, #eee); border-color: var(--dsw-alias-border-l2, #3a3d4a); }
.dsh-penhost-header-on { color: var(--dsw-alias-brand-primary, #4f7cff); border-color: var(--dsw-alias-brand-primary, #4f7cff); }
.dsh-penhost-header-error { color: #ef7373; border-color: #ef7373; }
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
			tag.dataset.plugin = 'pen-dev-bridge'
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

		function pathName(value) {
			const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean)
			return parts[parts.length - 1] || '工作区'
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
			const dragRef = React.useRef(null)
			const resizeRef = React.useRef(null)
			const menusRef = React.useRef(null)
			const fileMenuRef = React.useRef(null)
			const conflictMenuRef = React.useRef(null)
			const saveErrorMenuRef = React.useRef(null)
			const [menu, setMenu] = React.useState(null)
			const [files, setFiles] = React.useState([])
			const [filesLoading, setFilesLoading] = React.useState(false)
			const [menuError, setMenuError] = React.useState(null)
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
					const inConflict = conflictMenuRef.current && conflictMenuRef.current.contains(event.target)
					const inSaveError = saveErrorMenuRef.current && saveErrorMenuRef.current.contains(event.target)
					if (!inWorkspace && !inFile && !inConflict && !inSaveError) setMenu(null)
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
				let file = window.prompt('新建 .pen 文件（相对于当前工作区）', 'designs/untitled.pen')
				if (file === null) return
				file = String(file).trim()
				if (!file) return
				if (!file.toLowerCase().endsWith('.pen')) file += '.pen'
				void switchFile(file)
			}

			const saveAs = async () => {
				const current = workspaceRelative(state.workspace, state.file) || 'designs/design.pen'
				const suggested = current.replace(/\.pen$/i, '-copy.pen')
				let file = window.prompt('另存为（相对于当前工作区，不会覆盖已有文件）', suggested)
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
			const workspaceLabel = pathName(state.workspace)
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
				isSplit ? React.createElement('div', { className: 'dsh-penhost-resize', title: '拖动调整宽度', onPointerDown: startResize }) : null,
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
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void revealWorkspace() } }, '打开工作区文件夹'),
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null),
					React.createElement('div', { className: 'dsh-penhost-menu-wrap dsh-penhost-file-wrap', ref: fileMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-menu-btn', title: state.file || '', 'aria-haspopup': 'menu', 'aria-expanded': menu === 'file', onClick: showFileMenu,
						}, currentFile || '选择 .pen 文件'),
						menu === 'file' ? React.createElement('div', { className: 'dsh-penhost-menu', role: 'menu' },
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: createFile }, '新建 .pen 文件…'),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void saveAs() } }, '另存为…'),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							filesLoading ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, '正在查找 .pen 文件…') : null,
							!filesLoading && !visibleFiles.length ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, '工作区内没有 .pen 文件') : null,
							!filesLoading ? visibleFiles.map((file) => React.createElement('button', {
								key: file, className: 'dsh-penhost-menu-item', role: 'menuitem', 'aria-current': file === currentFile ? 'true' : undefined,
								title: file, onClick: () => { if (file === currentFile) setMenu(null); else void switchFile(file) },
							}, file)) : null,
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null),
					state.conflict ? React.createElement('div', { className: 'dsh-penhost-menu-wrap', ref: conflictMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-mode dsh-penhost-conflict', title: state.conflict, 'aria-haspopup': 'menu', 'aria-expanded': menu === 'conflict',
							onClick: () => { setMenu(menu === 'conflict' ? null : 'conflict'); setMenuError(null) },
						}, '磁盘冲突'),
						menu === 'conflict' ? React.createElement('div', { className: 'dsh-penhost-menu dsh-penhost-conflict-menu', role: 'menu' },
							React.createElement('div', { className: 'dsh-penhost-menu-note' }, state.conflict),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void resolveConflict('reload') } }, '重新加载磁盘版本'),
							React.createElement('button', { className: 'dsh-penhost-menu-item dsh-penhost-danger', role: 'menuitem', onClick: () => { void resolveConflict('overwrite') } }, '保留画布并覆盖磁盘'),
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null) : null,
					state.saveError ? React.createElement('div', { className: 'dsh-penhost-menu-wrap', ref: saveErrorMenuRef, onPointerDown: (event) => event.stopPropagation() },
						React.createElement('button', {
							className: 'dsh-penhost-mode dsh-penhost-save-error', title: state.saveError, 'aria-haspopup': 'menu', 'aria-expanded': menu === 'save-error',
							onClick: () => { setMenu(menu === 'save-error' ? null : 'save-error'); setMenuError(null) },
						}, '保存失败'),
						menu === 'save-error' ? React.createElement('div', { className: 'dsh-penhost-menu dsh-penhost-conflict-menu', role: 'menu' },
							React.createElement('div', { className: 'dsh-penhost-menu-note' }, state.saveError),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => { void retrySave() } }, '重试保存'),
							menuError ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, menuError) : null) : null) : null,
					React.createElement('button', {
						className: 'dsh-penhost-mode',
						title: isSplit ? '切换为浮动窗口' : '切换为右侧分屏',
						onPointerDown: (event) => event.stopPropagation(),
						onClick: () => store.patch(sessionId, { mode: isSplit ? 'float' : 'split' }),
					}, isSplit ? '浮动' : '分屏'),
					React.createElement('button', {
						className: 'dsh-penhost-close', title: '关闭',
						onPointerDown: (event) => event.stopPropagation(),
						onClick: () => store.patch(sessionId, { open: false }),
					}, '✕')),
				React.createElement('div', { className: 'dsh-penhost-body' },
					React.createElement('iframe', { key: state.binding, className: 'dsh-penhost-frame', src: editorUrl, title: 'pen.dev 画布编辑器', allow: 'clipboard-read; clipboard-write' })))
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
					? React.createElement(PenCanvas, { key: sessionId, store: props.store, sessionId, state, active: sessionId === current })
					: null))
		}

		function PenHeader(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			const workspace = props.useSessions((sessions) => sessions.byId[props.sessionId] && sessions.byId[props.sessionId].cwd)
			const className = 'dsh-penhost-header-btn'
				+ (state.open ? ' dsh-penhost-header-on' : '')
				+ (state.error ? ' dsh-penhost-header-error' : '')
			return React.createElement('button', {
				className,
				disabled: state.loading,
				onClick: () => { void openForSession(props.store, props.sessionId, workspace) },
				title: state.error || (workspace ? '在当前会话工作区打开 pen.dev 画布' : '当前会话没有工作区'),
			}, state.loading ? '✏ 正在绑定…' : state.error ? '✏ 画布出错' : '✏ pen.dev 画布')
		}

		function PenBlankTrigger(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const summary = props.useSessions((sessions) => sessions.byId[props.sessionId])
			if (!summary || summary.blank !== true) return null
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			return React.createElement('button', {
				className: 'dsh-penhost-input-btn',
				disabled: state.loading,
				'aria-label': 'pen.dev 画布',
				title: state.error || '在这个新会话的工作区打开 pen.dev 画布',
				onClick: () => { void openForSession(props.store, props.sessionId, summary.cwd) },
			}, state.loading ? '…' : '✏')
		}

		const name = 'pen-dev-bridge'
		const inject = ['slots']

		function apply(ctx) {
			const store = createSessionStore()
			const disposeStyles = insertStyles()
			const disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register(
				{ name: 'shell.overlay', id: 'penhost-canvas', order: 20 },
				(props) => React.createElement(PenOverlay, { ...props, store })))
			const disposeHeader = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
				{ name: 'conversation.session.header.actions', id: 'penhost-header', order: 90, label: () => 'pen.dev 画布' },
				(props) => React.createElement(PenHeader, { ...props, store })))
			const disposeBlankTrigger = ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
				{ name: 'conversation.input.right', id: 'penhost-blank-trigger', order: 85, label: () => 'pen.dev 画布' },
				(props) => React.createElement(PenBlankTrigger, { ...props, store })))
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
