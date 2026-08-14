window.__ModuleLoader__.load({
	id: "pen-dev-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require('react')

		// pen-dev-bridge — browser half.
		//
		// The pen.dev canvas seat: a right-side split-screen editor (default
		// 50% width, draggable left edge) or a floating window, fed by the
		// host half's /pen-editor static routes + /pen-host IPC bridge. The
		// product's own details column is hidden while the split is active so
		// it never shows through behind the canvas.

		const STYLE_TAG_ID = 'pen-dev-bridge/canvas.css'
		const CSS = `
.dsh-penhost-panel { display: flex; flex-direction: column; background: var(--dsw-alias-bg-overlay, #1d1e24); color: var(--dsw-alias-label-primary, #eee); border: 1px solid var(--dsw-alias-border-l2, #3a3d4a); font: 13px/1.5 system-ui, -apple-system, sans-serif; overflow: hidden; }
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
[data-penhost-wide] { grid-template-columns: var(--penhost-grid) !important; }
[data-penhost-wide] .pI_x6G_detailsCol, [data-penhost-wide] > div:nth-child(3) { visibility: hidden; }
`

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

		function PenCanvas(props) {
			const store = props.store
			const [open, setOpen] = React.useState(store.open)
			const [mode, setMode] = React.useState(store.mode)
			const [wide, setWide] = React.useState(store.wide)
			React.useEffect(() => store.subscribe(() => { setOpen(store.open); setMode(store.mode); setWide(store.wide) }), [])
			const [pos, setPos] = React.useState(null)
			const dragRef = React.useRef(null)
			const resizeRef = React.useRef(null)

			React.useEffect(() => {
				if (store.open && store.mode === 'float' && pos === null) {
					setPos({ x: Math.max(12, window.innerWidth - 920), y: Math.max(12, window.innerHeight - 720) })
				}
			}, [store.open, store.mode])

			const clampWide = (w) => Math.min(Math.max(Math.round(w), 400), Math.max(400, window.innerWidth - 560))

			const frameOf = () => {
				try {
					const overlay = document.querySelector('[data-shell-overlay]')
					return overlay ? overlay.parentElement : null
				} catch (err) { return null }
			}
			const applyGrid = (frame, w) => {
				try {
					const parts = String(getComputedStyle(frame).gridTemplateColumns).split(' ')
					frame.dataset.penhostWide = '1'
					frame.style.setProperty('--penhost-grid', (parts[0] || '300px') + ' minmax(0, 1fr) ' + w + 'px')
				} catch (err) { /* ignore */ }
			}

			React.useEffect(() => {
				if (store.mode !== 'split' || !store.open) return
				const frame = frameOf()
				if (!frame) return
				if (!store.wide) store.wide = clampWide(window.innerWidth * 0.5)
				applyGrid(frame, store.wide)
				const onResize = () => {
					store.wide = clampWide(store.wide || window.innerWidth * 0.5)
					applyGrid(frame, store.wide)
					for (const fn of store.listeners) fn()
				}
				window.addEventListener('resize', onResize)
				let mo = null
				try {
					mo = new MutationObserver(() => {
						try {
							const parts = String(getComputedStyle(frame).gridTemplateColumns).split(' ')
							const third = parseFloat(parts[2] || '0')
							if (store.mode === 'split' && Math.abs(third - store.wide) > 4) applyGrid(frame, store.wide)
						} catch (err) { /* ignore */ }
					})
					mo.observe(frame, { attributes: true, attributeFilter: ['style'] })
				} catch (err) { /* fallback */ }
				return () => {
					window.removeEventListener('resize', onResize)
					if (mo) { try { mo.disconnect() } catch (err) { /* ignore */ } }
					delete frame.dataset.penhostWide
					frame.style.removeProperty('--penhost-grid')
				}
			}, [store.mode, store.open])

			const endResize = () => {
				const r = resizeRef.current
				if (!r) return
				window.removeEventListener('pointermove', r.onMove)
				window.removeEventListener('pointerup', r.onUp)
				window.removeEventListener('pointercancel', r.onUp)
				window.removeEventListener('blur', r.onUp)
				resizeRef.current = null
			}
			const startResize = (e) => {
				if (store.mode !== 'split') return
				if (e.button !== 0 && e.pointerType === 'mouse') return
				e.preventDefault(); e.stopPropagation()
				try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
				const frame = frameOf()
				const startX = e.clientX
				const startWide = store.wide || 720
				const onMove = (ev) => {
					const delta = startX - ev.clientX
					store.wide = clampWide(startWide + delta)
					if (frame) applyGrid(frame, store.wide)
					for (const fn of store.listeners) fn()
				}
				const onUp = () => { endResize() }
				resizeRef.current = { onMove, onUp }
				window.addEventListener('pointermove', onMove)
				window.addEventListener('pointerup', onUp)
				window.addEventListener('pointercancel', onUp)
				window.addEventListener('blur', onUp)
			}

			const endDrag = () => {
				const d = dragRef.current
				if (!d) return
				window.removeEventListener('pointermove', d.onMove)
				window.removeEventListener('pointerup', d.onUp)
				window.removeEventListener('pointercancel', d.onUp)
				window.removeEventListener('blur', d.onUp)
				dragRef.current = null
			}
			const startDrag = (e) => {
				if (store.mode !== 'float') return
				if (e.button !== 0 && e.pointerType === 'mouse') return
				try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
				dragRef.current = { dx: e.clientX - (pos ? pos.x : 0), dy: e.clientY - (pos ? pos.y : 0), onMove: null, onUp: null }
				const onMove = (ev) => setPos({ x: ev.clientX - dragRef.current.dx, y: ev.clientY - dragRef.current.dy })
				const onUp = () => { endDrag() }
				dragRef.current.onMove = onMove
				dragRef.current.onUp = onUp
				window.addEventListener('pointermove', onMove)
				window.addEventListener('pointerup', onUp)
				window.addEventListener('pointercancel', onUp)
				window.addEventListener('blur', onUp)
			}

			const editorUrl = window.location.origin + '/pen-editor/index.html'
			const isSplit = store.mode === 'split'
			const style = isSplit
				? { display: store.open ? 'flex' : 'none', right: 0, top: 0, bottom: 0, width: (wide || 720) + 'px' }
				: { display: store.open ? 'flex' : 'none', left: pos ? pos.x : 0, top: pos ? pos.y : 0, width: 900, maxWidth: '96vw', height: 'min(700px, 90vh)' }
			const cls = 'dsh-penhost-panel' + (isSplit ? ' dsh-penhost-split' : ' dsh-penhost-float')
			return React.createElement('div', { className: cls, style: style },
				isSplit ? React.createElement('div', { className: 'dsh-penhost-resize', title: '拖动调整宽度', onPointerDown: startResize }) : null,
				React.createElement('div', { className: 'dsh-penhost-head', onPointerDown: startDrag },
					React.createElement('strong', null, '✏ pen.dev 画布'),
					React.createElement('span', null, isSplit ? '右侧分屏 · 默认 50% · 拖动左缘调宽 · 自动保存' : '浮动窗口 · 按住标题拖动'),
					React.createElement('button', {
						className: 'dsh-penhost-mode',
						title: isSplit ? '切换为浮动窗口' : '切换为右侧分屏',
						onClick: () => store.setMode(isSplit ? 'float' : 'split'),
					}, isSplit ? '浮动' : '分屏'),
					React.createElement('button', { className: 'dsh-penhost-close', title: '关闭', onClick: () => store.setOpen(false) }, '✕')),
				React.createElement('div', { className: 'dsh-penhost-body' },
					React.createElement('iframe', {
						className: 'dsh-penhost-frame',
						src: editorUrl,
						title: 'pen.dev 画布编辑器',
						allow: 'clipboard-read; clipboard-write',
					})))
		}

		function PenHeader(props) {
			const store = props.store
			const [open, setOpen] = React.useState(store.open)
			React.useEffect(() => store.subscribe(() => setOpen(store.open)), [])
			return React.createElement('button', {
				className: 'dsh-penhost-header-btn' + (open ? ' dsh-penhost-header-on' : ''),
				onClick: () => store.setOpen(true),
				title: '打开 pen.dev 画布',
			}, '✏ pen.dev 画布')
		}

		const name = 'pen-dev-bridge'

		const inject = ['slots']

		function apply(ctx) {
			const listeners = new Set()
			const store = {
				open: false,
				mode: 'split',
				wide: 0,
				listeners: listeners,
				setOpen(v) {
					store.open = !!v
					for (const fn of listeners) fn()
				},
				setMode(m) {
					store.mode = m
					for (const fn of listeners) fn()
				},
				subscribe(fn) {
					listeners.add(fn)
					return () => listeners.delete(fn)
				},
			}
			const disposeStyles = insertStyles()
			ctx.slots.inject('shell.overlay', () => ctx.slots.register(
				{ name: 'shell.overlay', id: 'penhost-canvas', order: 20 },
				() => (store.open ? React.createElement(PenCanvas, { store }) : null)))
			ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
				{ name: 'conversation.session.header.actions', id: 'penhost-header', order: 90, label: () => 'pen.dev 画布' },
				() => React.createElement(PenHeader, { store })))
			store.setOpen(true)
			return () => {
				disposeStyles()
			}
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;

		return module.exports;
	}
});
