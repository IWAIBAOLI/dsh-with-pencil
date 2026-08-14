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
.dsh-penhost-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: grab; background: var(--dsw-alias-bg-layer-1, #26272e); border-bottom: 1px solid var(--dsw-alias-border-l1, #34353d); user-select: none; }
.dsh-penhost-split .dsh-penhost-head { cursor: default; }
.dsh-penhost-head strong { font-size: 13px; }
.dsh-penhost-head span { color: var(--dsw-alias-label-secondary, #9aa0b4); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-penhost-mode { border: 1px solid var(--dsw-alias-border-l1, #34353d); background: transparent; color: var(--dsw-alias-label-primary, #eee); cursor: pointer; font-size: 11px; padding: 3px 8px; border-radius: 6px; }
.dsh-penhost-mode:hover { border-color: var(--dsw-alias-brand-primary, #4f7cff); }
.dsh-penhost-close { margin-left: auto; border: none; background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font-size: 13px; padding: 2px 8px; border-radius: 6px; }
.dsh-penhost-close:hover { background: rgba(255,255,255,.08); color: var(--dsw-alias-label-primary, #eee); }
.dsh-penhost-body { flex: 1; min-height: 0; }
.dsh-penhost-frame { width: 100%; height: 100%; border: none; background: #fff; }
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

		const EMPTY_SESSION = Object.freeze({ open: false, mode: 'split', wide: 0, pos: null, binding: null, workspace: null, file: null, loading: false, error: null })

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

		function PenCanvas(props) {
			const { store, sessionId, state, active } = props
			const dragRef = React.useRef(null)
			const resizeRef = React.useRef(null)
			const clampWide = React.useCallback((value) => Math.min(Math.max(Math.round(value), 400), Math.max(400, window.innerWidth - 560)), [])
			const effectiveWide = state.wide || clampWide(window.innerWidth * 0.5)

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
				const width = clampWide(state.wide || window.innerWidth * 0.5)
				if (state.wide !== width) store.patch(sessionId, { wide: width })
				applyGrid(frame, width)
				const onResize = () => {
					const next = clampWide((store.getSnapshot().sessions[sessionId] || EMPTY_SESSION).wide || window.innerWidth * 0.5)
					store.patch(sessionId, { wide: next })
					applyGrid(frame, next)
				}
				window.addEventListener('resize', onResize)
				return () => {
					window.removeEventListener('resize', onResize)
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

			const startResize = (event) => {
				if (state.mode !== 'split' || (event.button !== 0 && event.pointerType === 'mouse')) return
				event.preventDefault(); event.stopPropagation()
				const frame = frameOf()
				const startX = event.clientX
				const startWide = effectiveWide
				const finish = () => {
					window.removeEventListener('pointermove', onMove)
					window.removeEventListener('pointerup', finish)
					window.removeEventListener('pointercancel', finish)
					window.removeEventListener('blur', finish)
					resizeRef.current = null
				}
				const onMove = (moveEvent) => {
					const width = clampWide(startWide + startX - moveEvent.clientX)
					store.patch(sessionId, { wide: width })
					if (frame) applyGrid(frame, width)
				}
				resizeRef.current = { finish }
				window.addEventListener('pointermove', onMove)
				window.addEventListener('pointerup', finish)
				window.addEventListener('pointercancel', finish)
				window.addEventListener('blur', finish)
			}

			const startDrag = (event) => {
				if (state.mode !== 'float' || (event.button !== 0 && event.pointerType === 'mouse')) return
				const initial = state.pos || { x: Math.max(12, window.innerWidth - 920), y: Math.max(12, window.innerHeight - 720) }
				const dx = event.clientX - initial.x
				const dy = event.clientY - initial.y
				const finish = () => {
					window.removeEventListener('pointermove', onMove)
					window.removeEventListener('pointerup', finish)
					window.removeEventListener('pointercancel', finish)
					window.removeEventListener('blur', finish)
					dragRef.current = null
				}
				const onMove = (moveEvent) => store.patch(sessionId, { pos: {
					x: Math.min(Math.max(8, moveEvent.clientX - dx), Math.max(8, window.innerWidth - 120)),
					y: Math.min(Math.max(8, moveEvent.clientY - dy), Math.max(8, window.innerHeight - 48)),
				} })
				dragRef.current = { finish }
				window.addEventListener('pointermove', onMove)
				window.addEventListener('pointerup', finish)
				window.addEventListener('pointercancel', finish)
				window.addEventListener('blur', finish)
			}

			const isSplit = state.mode === 'split'
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
					React.createElement('strong', null, '✏ pen.dev 画布'),
					React.createElement('span', { title: state.file || '' }, isSplit ? '当前会话 · 右侧分屏 · 自动保存' : '当前会话 · 浮动窗口 · 自动保存'),
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
					React.createElement('iframe', { className: 'dsh-penhost-frame', src: editorUrl, title: 'pen.dev 画布编辑器', allow: 'clipboard-read; clipboard-write' })))
		}

		function PenOverlay(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const current = props.useSessions((sessions) => sessions.current)
			const known = props.useSessions((sessions) => sessions.byId)
			React.useEffect(() => {
				for (const sessionId of Object.keys(snapshot.sessions)) {
					if (!known[sessionId] || (known[sessionId].blank === true && sessionId !== current)) {
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
