window.__ModuleLoader__.load({
	id: "dsh-with-pencil",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require('react')

		// Browser half. Canvas state is keyed by Harness session id. The editor
		// lives in the session's official right-Sidebar tab.
		const STYLE_TAG_ID = 'dsh-with-pencil/canvas.css'
		const PENCIL_TAB_KIND = 'dsh-with-pencil'
		const CSS = `
.dsh-penhost-panel { position: relative; display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; width: 100%; height: 100%; flex-direction: column; color-scheme: light dark; background: var(--dsw-alias-bg-overlay, Canvas); color: var(--dsw-alias-label-primary, CanvasText); font: 13px/1.5 system-ui, -apple-system, sans-serif; overflow: hidden; }
.dsh-penhost-panel * { box-sizing: border-box; }
.dsh-penhost-head { position: relative; display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 6px 8px 6px 10px; background: var(--dsw-alias-bg-layer-1, #26272e); border-bottom: 1px solid var(--dsw-alias-border-l1, #34353d); user-select: none; }
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
.dsh-penhost-file-row { position: relative; display: flex; align-items: center; }
.dsh-penhost-file-row .dsh-penhost-file-choice { flex: 1 1 auto; min-width: 0; }
.dsh-penhost-file-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-penhost-file-more { flex: 0 0 auto; width: 24px; text-align: center; color: var(--dsw-alias-label-tertiary, #81858c); cursor: pointer; font-size: 13px; opacity: 0; transition: opacity .12s ease; border-radius: 5px; }
.dsh-penhost-file-row:hover .dsh-penhost-file-more, .dsh-penhost-file-more[aria-expanded="true"], .dsh-penhost-file-more:focus-visible { opacity: 1; }
.dsh-penhost-file-more:hover { color: var(--dsw-alias-label-primary, CanvasText); }
.dsh-penhost-file-actions { position: absolute; right: 0; top: calc(100% + 2px); left: auto; min-width: 130px; }
.dsh-penhost-danger { color: var(--dsw-alias-danger, #e5534b); }
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
.dsh-penhost-body { flex: 1; min-height: 0; }
.dsh-penhost-frame { width: 100%; height: 100%; border: none; color-scheme: light dark; background: var(--dsw-alias-bg-layer-1, Canvas); }
.dsh-penhost-dialog-backdrop { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 12px; background: rgba(0, 0, 0, .55); }
.dsh-penhost-dialog { width: min(380px, 100%); max-height: 100%; overflow: auto; padding: 18px; border: 1px solid var(--dsw-alias-border-l1, GrayText); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, Canvas); box-shadow: 0 12px 40px rgba(0, 0, 0, .3); }
.dsh-penhost-dialog-title { margin: 0 0 12px; font-size: 15px; line-height: 1.45; }
.dsh-penhost-dialog-input { display: block; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, GrayText); border-radius: 7px; background: var(--dsw-alias-bg-layer-1, Canvas); color: var(--dsw-alias-label-primary, CanvasText); font: inherit; }
.dsh-penhost-dialog-path { margin: 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-penhost-dialog-error { margin: 10px 0 0; color: var(--dsw-alias-danger, #e5534b); overflow-wrap: anywhere; }
.dsh-penhost-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-penhost-dialog-actions button { padding: 6px 12px; border: 1px solid var(--dsw-alias-border-l1, GrayText); border-radius: 7px; background: var(--dsw-alias-bg-layer-1, Canvas); color: var(--dsw-alias-label-primary, CanvasText); font: inherit; cursor: pointer; }
.dsh-penhost-dialog-actions button:disabled { cursor: wait; opacity: .55; }
.dsh-penhost-dialog-actions .dsh-penhost-dialog-primary { border-color: var(--dsw-alias-button-primary-fill, #4f7cff); background: var(--dsw-alias-button-primary-fill, #4f7cff); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-penhost-dialog-actions .dsh-penhost-dialog-primary.dsh-penhost-danger { border-color: var(--dsw-alias-state-error-primary, #e5534b); background: var(--dsw-alias-state-error-primary, #e5534b); }
.dsh-penhost-tab-status { padding: 12px; color: var(--dsw-alias-label-secondary, CanvasText); }
.dsh-penhost-tab-status button { margin-left: 8px; }
.dsh-penhost-header-btn { vertical-align: middle; }
.dsh-penhost-header-on { color: var(--dsw-alias-brand-primary, #4f7cff); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 10%, transparent); }
.dsh-penhost-header-error { color: #ef7373; }
.dsh-penhost-input-btn { width: 34px; height: 30px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, #9aa0b4); cursor: pointer; font-size: 15px; }
.dsh-penhost-input-btn:hover { background: var(--dsw-alias-bg-layer-1, #26272e); color: var(--dsw-alias-label-primary, #eee); }
.dsh-penhost-input-btn:disabled { cursor: wait; opacity: .55; }
.dsh-penhost-settings-card { list-style: none; border: 1px solid var(--dsw-alias-border-l2, GrayText); border-radius: 12px; background: var(--dsw-alias-bg-layer-3, Canvas); transition: border-color .16s, background .16s; }
.dsh-penhost-settings-card:hover { border-color: var(--dsw-alias-label-dimmed, GrayText); }
.dsh-penhost-settings-card.dsh-penhost-settings-open { background: var(--dsw-alias-bg-layer-2, Canvas); border-color: var(--dsw-alias-label-dimmed, GrayText); }
.dsh-penhost-settings-head { width: 100%; background: none; color: inherit; display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; }
.dsh-penhost-settings-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff); outline-offset: -2px; }
.dsh-penhost-settings-head-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dsh-penhost-settings-name { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary, CanvasText); }
.dsh-penhost-settings-desc { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, GrayText); }
.dsh-penhost-settings-chevron { flex: none; color: var(--dsw-alias-label-tertiary, GrayText); transition: transform .16s; }
.dsh-penhost-settings-chevron.dsh-penhost-settings-chevron-open { transform: rotate(180deg); }
.dsh-penhost-settings-pending { flex: none; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; background: var(--dsw-alias-bg-module-platform, Canvas); color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-penhost-settings-body { border-top: 1px solid var(--dsw-alias-border-l2, GrayText); margin: 0 16px; padding: 12px 0 4px; }
.dsh-penhost-settings-readonly { margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, GrayText); }
.dsh-penhost-settings-row { display: flex; align-items: center; gap: 10px; }
.dsh-penhost-settings-label { flex: none; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-penhost-settings-options { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.dsh-penhost-settings-option { display: flex; align-items: flex-start; gap: 9px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, GrayText); border-radius: 9px; cursor: pointer; transition: border-color .12s, background .12s; }
.dsh-penhost-settings-option:hover { border-color: var(--dsw-alias-label-dimmed, GrayText); }
.dsh-penhost-settings-option-active { border-color: var(--dsw-alias-brand-primary, #4f7cff); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 8%, transparent); }
.dsh-penhost-settings-option input { flex: none; margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary, #4f7cff); cursor: pointer; }
.dsh-penhost-settings-option-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-penhost-settings-option-title { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, CanvasText); }
.dsh-penhost-settings-option-desc { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary, GrayText); }
.dsh-penhost-settings-status { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-error, #e5534b); }
.dsh-penhost-settings-status.dsh-penhost-settings-ok { color: var(--dsw-alias-label-success, #2da44e); }
.dsh-penhost-settings-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 0 4px; border-top: 1px solid var(--dsw-alias-border-l2, GrayText); margin-top: 12px; }
.dsh-penhost-settings-btn { appearance: none; border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer; }
.dsh-penhost-settings-btn-reset { border-color: var(--dsw-alias-border-l2, GrayText); background: none; color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-penhost-settings-btn-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary, CanvasText); border-color: var(--dsw-alias-label-dimmed, GrayText); }
.dsh-penhost-settings-btn-save { background: var(--dsw-alias-label-primary, CanvasText); color: var(--dsw-alias-bg-layer-3, Canvas); }
.dsh-penhost-settings-btn:disabled { opacity: .4; cursor: default; }
.dsh-penhost-settings-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff); outline-offset: 1px; }
`

		const EMPTY_SESSION = Object.freeze({ binding: null, workspace: null, file: null, conflict: null, saveError: null, loading: false, closing: false, error: null })

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
				renameFile: '重命名', deleteFile: '删除', fileActions: '文件操作', renameFilePrompt: '重命名为（相对于当前工作区）', deleteFileConfirm: '确定删除该文件？删除后无法恢复。', cancel: '取消', working: '正在处理…', fileRequired: '请输入 .pen 文件路径',
				findingFiles: '正在查找 .pen 文件…', noFiles: '工作区内没有 .pen 文件',
				export: '导出', exportHint: '有选区时导出选区，否则导出全部顶层元素。',
				exportPng: '导出 PNG（2×）', exportingPng: '正在导出 PNG…', exportPdf: '导出 PDF', exportingPdf: '正在导出 PDF…',
				exportedSelection: '已导出选区', exportedDocument: '已导出当前文档', files: '个文件', openExports: '打开导出文件夹',
				editorTitle: 'pen.dev 画布编辑器', alreadyOpen: '画布已在另一个标签页打开', showCanvas: '显示画布', retry: '重试', closing: '正在保存画布…',
				diskConflict: '磁盘冲突', reloadDisk: '重新加载磁盘版本', overwriteDisk: '保留画布并覆盖磁盘', saveFailed: '保存失败', retrySave: '重试保存',
			},
			en: {
				canvas: 'pen.dev Canvas', canvasLoading: 'Connecting…', canvasError: 'Canvas error', openCanvas: 'Open the pen.dev canvas in this conversation workspace', noWorkspace: 'This conversation has no workspace',
				workspace: 'Workspace', openWorkspace: 'Open workspace folder',
				chooseFile: 'Choose a .pen file', newFile: 'New .pen file…', newFilePrompt: 'New .pen file (relative to this workspace)',
				saveAs: 'Save As…', saveAsPrompt: 'Save As (relative to this workspace; existing files are not overwritten)',
				renameFile: 'Rename', deleteFile: 'Delete', fileActions: 'File actions', renameFilePrompt: 'Rename to (relative to this workspace)', deleteFileConfirm: 'Delete this file? This cannot be undone.', cancel: 'Cancel', working: 'Working…', fileRequired: 'Enter a .pen file path',
				findingFiles: 'Finding .pen files…', noFiles: 'No .pen files in this workspace',
				export: 'Export', exportHint: 'Exports the selection, or all top-level elements when nothing is selected.',
				exportPng: 'Export PNG (2×)', exportingPng: 'Exporting PNG…', exportPdf: 'Export PDF', exportingPdf: 'Exporting PDF…',
				exportedSelection: 'Selection exported', exportedDocument: 'Document exported', files: 'files', openExports: 'Open export folder',
				editorTitle: 'pen.dev canvas editor', alreadyOpen: 'Canvas is open in another tab', showCanvas: 'Show canvas', retry: 'Retry', closing: 'Saving canvas…',
				diskConflict: 'Disk conflict', reloadDisk: 'Reload disk version', overwriteDisk: 'Keep canvas and overwrite disk', saveFailed: 'Save failed', retrySave: 'Retry save',
			},
		}

		const PENCIL_SETTINGS_LABELS = {
			zh: {
				title: 'dsh-with-pencil',
				unsaved: '有未保存修改',
				modeLabel: '截图视觉模式',
				modeText: '图像转译包装路由',
				modeTextHint: '使用高清截图；直连纯文本路由无法消费图片',
				modeMultimodal: '原生视觉模型',
				modeMultimodalHint: '使用原生截图；模型需支持图片输入',
				readOnly: '当前环境为只读，无法保存配置。',
				save: '保存', saving: '保存中…', saved: '已保存，立即生效', reset: '重置为默认',
				saveFailed: '保存失败', expand: '展开', collapse: '收起',
			},
			en: {
				title: 'dsh-with-pencil',
				unsaved: 'Unsaved changes',
				modeLabel: 'Screenshot vision mode',
				modeText: 'Vision-translation wrapper',
				modeTextHint: 'High-resolution screenshots; direct text-only routes cannot consume images',
				modeMultimodal: 'Native vision model',
				modeMultimodalHint: 'Native screenshots; model must accept image input',
				readOnly: 'This environment is read-only; settings cannot be saved.',
				save: 'Save', saving: 'Saving…', saved: 'Saved — effective immediately', reset: 'Reset to default',
				saveFailed: 'Save failed', expand: 'Expand', collapse: 'Collapse',
			},
		}

		async function openForSession(store, sessionId, workspace, releasing) {
			const current = store.getSnapshot().sessions[sessionId] || EMPTY_SESSION
			if (current.binding) return
			if (current.loading) return
			store.patch(sessionId, { loading: true, error: null })
			try {
				if (releasing) await releasing
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
					error: null,
				})
			} catch (error) {
				store.patch(sessionId, { loading: false, error: error && error.message ? error.message : String(error) })
			}
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

		function PenCanvas(props) {
			const { store, sessionId, state } = props
			const language = useHarnessLanguage(props.locale)
			const labels = LOCALIZED_CANVAS_LABELS[language]
			const menusRef = React.useRef(null)
			const fileMenuRef = React.useRef(null)
			const exportMenuRef = React.useRef(null)
			const conflictMenuRef = React.useRef(null)
			const saveErrorMenuRef = React.useRef(null)
			const [menu, setMenu] = React.useState(null)
			const [files, setFiles] = React.useState([])
			const [filesLoading, setFilesLoading] = React.useState(false)
			const [fileAction, setFileAction] = React.useState(null)
			const [menuError, setMenuError] = React.useState(null)
			const [fileDialog, setFileDialog] = React.useState(null)
			const [exporting, setExporting] = React.useState(null)
			const [exportResult, setExportResult] = React.useState(null)

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
				setFileAction(null)
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

			const openFileDialog = (kind, file) => {
				const current = workspaceRelative(state.workspace, state.file) || 'designs/design.pen'
				const value = kind === 'new' ? 'designs/untitled.pen'
					: kind === 'save-as' ? current.replace(/\.pen$/i, '-copy.pen') : file || ''
				setMenu(null); setFileAction(null); setMenuError(null)
				setFileDialog({ kind, file: file || null, value, error: null, busy: false })
			}

			const submitFileDialog = async (event) => {
				event.preventDefault()
				if (!fileDialog || fileDialog.busy) return
				const { kind, file } = fileDialog
				let value = String(fileDialog.value || '').trim()
				if (kind !== 'delete' && !value) {
					setFileDialog((current) => ({ ...current, error: labels.fileRequired }))
					return
				}
				if (kind !== 'delete' && !value.toLowerCase().endsWith('.pen')) value += '.pen'
				if (kind === 'rename' && value === file) { setFileDialog(null); return }
				const endpoint = kind === 'new' ? 'file' : kind === 'save-as' ? 'save-as' : kind
				const body = kind === 'rename' ? { file, name: value } : kind === 'delete' ? { file } : kind === 'new' ? { file: value, create: true } : { file: value }
				setFileDialog((current) => ({ ...current, value, error: null, busy: true }))
				try {
					const response = await fetch('/pen-host/' + endpoint + '?binding=' + encodeURIComponent(state.binding), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
					})
					if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
					const result = await response.json()
					if ((kind === 'new' || kind === 'save-as' || (kind === 'rename' && file === workspaceRelative(state.workspace, state.file)) || kind === 'delete') && result.file) {
						store.patch(sessionId, { file: result.file, conflict: null, saveError: null, error: null })
					}
					setFileDialog(null)
				} catch (error) {
					setFileDialog((current) => current && current.kind === kind
						? { ...current, busy: false, error: error && error.message ? error.message : String(error) } : current)
				}
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

			const workspaceLabel = pathName(state.workspace, labels.workspace)
			const currentFile = workspaceRelative(state.workspace, state.file)
			const visibleFiles = currentFile && !files.includes(currentFile) ? [currentFile, ...files] : files
			const editorUrl = '/pen-editor/index.html?binding=' + encodeURIComponent(state.binding)
			return React.createElement('div', {
				className: 'dsh-penhost-panel',
				'data-pen-session': sessionId,
			},
				React.createElement('div', { className: 'dsh-penhost-head' },
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
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => openFileDialog('new') }, labels.newFile),
							React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => openFileDialog('save-as') }, labels.saveAs),
							React.createElement('div', { className: 'dsh-penhost-menu-sep' }),
							filesLoading ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, labels.findingFiles) : null,
							!filesLoading && !visibleFiles.length ? React.createElement('div', { className: 'dsh-penhost-menu-note' }, labels.noFiles) : null,
							!filesLoading ? visibleFiles.map((file) => React.createElement('div', {
								key: file, className: 'dsh-penhost-file-row',
							},
								React.createElement('button', {
									className: 'dsh-penhost-menu-item dsh-penhost-file-choice', role: 'menuitem', 'aria-current': file === currentFile ? 'true' : undefined,
									title: file, onClick: () => { if (file === currentFile) setMenu(null); else void switchFile(file) },
								},
									React.createElement('span', { className: 'dsh-penhost-file-label' }, file),
									React.createElement('span', {
										className: 'dsh-penhost-file-more', title: labels.fileActions, 'aria-haspopup': 'menu', 'aria-expanded': fileAction === file ? 'true' : undefined,
										onClick: (event) => { event.stopPropagation(); setFileAction(fileAction === file ? null : file); setMenuError(null) },
									}, '⋯')),
								fileAction === file ? React.createElement('div', { className: 'dsh-penhost-menu dsh-penhost-file-actions', role: 'menu' },
									React.createElement('button', { className: 'dsh-penhost-menu-item', role: 'menuitem', onClick: () => openFileDialog('rename', file) }, labels.renameFile),
									React.createElement('button', { className: 'dsh-penhost-menu-item dsh-penhost-danger', role: 'menuitem', onClick: () => openFileDialog('delete', file) }, labels.deleteFile)) : null)) : null,
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
					state.closing ? React.createElement('span', { className: 'dsh-penhost-control', role: 'status' }, labels.closing) : null),
				React.createElement('div', { className: 'dsh-penhost-body' },
					React.createElement('iframe', { key: state.binding, className: 'dsh-penhost-frame', src: editorUrl, title: labels.editorTitle, allow: 'clipboard-read; clipboard-write' })),
				fileDialog ? React.createElement('div', {
					className: 'dsh-penhost-dialog-backdrop',
					onClick: (event) => { if (event.target === event.currentTarget && !fileDialog.busy) setFileDialog(null) },
				}, React.createElement('form', {
					className: 'dsh-penhost-dialog', role: 'dialog', 'aria-modal': 'true',
					'aria-label': fileDialog.kind === 'new' ? labels.newFilePrompt : fileDialog.kind === 'save-as' ? labels.saveAsPrompt : fileDialog.kind === 'rename' ? labels.renameFilePrompt : labels.deleteFileConfirm,
					onSubmit: submitFileDialog,
					onKeyDown: (event) => {
						event.stopPropagation()
						if (event.key === 'Escape' && !fileDialog.busy) { event.preventDefault(); setFileDialog(null) }
					},
				},
					React.createElement('h3', { className: 'dsh-penhost-dialog-title' }, fileDialog.kind === 'new' ? labels.newFilePrompt : fileDialog.kind === 'save-as' ? labels.saveAsPrompt : fileDialog.kind === 'rename' ? labels.renameFilePrompt : labels.deleteFileConfirm),
					fileDialog.kind === 'delete'
						? React.createElement('p', { className: 'dsh-penhost-dialog-path' }, fileDialog.file)
						: React.createElement('input', {
							type: 'text', className: 'dsh-penhost-dialog-input', 'aria-label': labels.chooseFile,
							value: fileDialog.value, autoFocus: true, disabled: fileDialog.busy,
							onChange: (event) => setFileDialog((current) => ({ ...current, value: event.target.value, error: null })),
						}),
					fileDialog.error ? React.createElement('p', { className: 'dsh-penhost-dialog-error', role: 'alert' }, fileDialog.error) : null,
					React.createElement('div', { className: 'dsh-penhost-dialog-actions' },
						React.createElement('button', { type: 'button', disabled: fileDialog.busy, onClick: () => setFileDialog(null) }, labels.cancel),
						React.createElement('button', {
							type: 'submit', disabled: fileDialog.busy,
							className: 'dsh-penhost-dialog-primary' + (fileDialog.kind === 'delete' ? ' dsh-penhost-danger' : ''),
						}, fileDialog.busy ? labels.working : fileDialog.kind === 'new' ? labels.newFile.replace(/…$/, '') : fileDialog.kind === 'save-as' ? labels.saveAs.replace(/…$/, '') : fileDialog.kind === 'rename' ? labels.renameFile : labels.deleteFile)))) : null)
		}

		function useSidebarSnapshot(source) {
			const subscribe = React.useCallback((listener) => source.subscribe(listener), [source])
			const getSnapshot = React.useCallback(() => source.getSnapshot(), [source])
			return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
		}

		function PencilTab(props) {
			const { tab } = props.useTabInfo()
			const snapshot = useBridgeSnapshot(props.store)
			const tabs = useSidebarSnapshot(props.sidebarRight.openTabs)
			const summary = props.useSessions((sessions) => sessions.byId[props.sessionId])
			const labels = LOCALIZED_CANVAS_LABELS[useHarnessLanguage(props.locale)]
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			const first = tabs.find((item) => item.sessionId === props.sessionId && item.kind === PENCIL_TAB_KIND)
			React.useEffect(() => {
				props.tabActions.set(tab.id, tab.actions)
				const onClosed = () => props.onTabClosed(props.sessionId, tab.id)
				tab.signal.addEventListener('abort', onClosed, { once: true })
				return () => {
					props.tabActions.delete(tab.id)
					tab.signal.removeEventListener('abort', onClosed)
				}
			}, [props.sessionId, props.tabActions, props.onTabClosed, tab.id, tab.actions, tab.signal])
			React.useEffect(() => {
				if (!summary || state.binding || state.loading || state.error) return
				void openForSession(props.store, props.sessionId, summary.cwd, props.releasing.get(props.sessionId))
			}, [props.store, props.sessionId, summary && summary.cwd, state.binding, state.loading, state.error])
			if (first && first.tabId !== tab.id) {
				return React.createElement('div', { className: 'dsh-penhost-tab-status' },
					labels.alreadyOpen,
					React.createElement('button', { onClick: () => props.sidebarRight.focus(first.tabId) }, labels.showCanvas))
			}
			if (state.error) {
				return React.createElement('div', { className: 'dsh-penhost-tab-status', role: 'alert' },
					state.error,
					React.createElement('button', { onClick: () => { props.store.patch(props.sessionId, { error: null }) } }, labels.retry))
			}
			if (!state.binding) return React.createElement('div', { className: 'dsh-penhost-tab-status', role: 'status' }, labels.canvasLoading)
			return React.createElement(PenCanvas, { store: props.store, locale: props.locale, sessionId: props.sessionId, state })
		}

		function PencilTabTitle(props) {
			return LOCALIZED_CANVAS_LABELS[useHarnessLanguage(props.locale)].canvas
		}

		function PenHeader(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const mounted = useSidebarSnapshot(props.sidebarRight.mounted)
			const tabs = useSidebarSnapshot(props.sidebarRight.openTabs)
			const labels = LOCALIZED_CANVAS_LABELS[useHarnessLanguage(props.locale)]
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			const workspace = props.useSessions((sessions) => sessions.byId[props.sessionId] && sessions.byId[props.sessionId].cwd)
			const className = 'dsh-penhost-control dsh-penhost-header-btn'
				+ (tabs.some((item) => item.sessionId === props.sessionId && item.kind === PENCIL_TAB_KIND) ? ' dsh-penhost-header-on' : '')
				+ (state.error ? ' dsh-penhost-header-error' : '')
			return React.createElement('button', {
				className,
				disabled: mounted !== props.sessionId,
				onClick: () => { props.sidebarRight.openTab(PENCIL_TAB_KIND) },
				title: state.error || (workspace ? labels.openCanvas : labels.noWorkspace),
			}, React.createElement('span', { 'aria-hidden': 'true' }, '✏'), state.loading ? labels.canvasLoading : state.error ? labels.canvasError : labels.canvas)
		}

		function PenBlankTrigger(props) {
			const snapshot = useBridgeSnapshot(props.store)
			const mounted = useSidebarSnapshot(props.sidebarRight.mounted)
			const labels = LOCALIZED_CANVAS_LABELS[useHarnessLanguage(props.locale)]
			const summary = props.useSessions((sessions) => sessions.byId[props.sessionId])
			if (!summary || summary.blank !== true) return null
			const state = snapshot.sessions[props.sessionId] || EMPTY_SESSION
			return React.createElement('button', {
				className: 'dsh-penhost-input-btn',
				disabled: mounted !== props.sessionId,
				'aria-label': labels.canvas,
				title: state.error || (summary.cwd ? labels.openCanvas : labels.noWorkspace),
				onClick: () => { props.sidebarRight.openTab(PENCIL_TAB_KIND) },
			}, state.loading ? '…' : '✏')
		}

		// Plugins → dsh-with-pencil → Configure. The Host projects the row's
		// volatile Config into the form, and mutations are revision-fenced.
		function PencilVisionCard(props) {
			const { form, locale } = props
			const labels = PENCIL_SETTINGS_LABELS[languageFromLocale(locale)] || PENCIL_SETTINGS_LABELS.en
			const snapshot = form && form.state
			const [draft, setDraft] = React.useState(null)
			const [saving, setSaving] = React.useState(false)
			const [status, setStatus] = React.useState(null)
			React.useEffect(() => { setDraft(null); setStatus(null) }, [snapshot && snapshot.revision])
			if (!snapshot || snapshot.status !== 'ready') return null
			const configured = snapshot.value && snapshot.value.visionMode
			const current = configured === 'text' ? 'text' : 'multimodal'
			const overridden = !!(snapshot.user && Object.prototype.hasOwnProperty.call(snapshot.user, 'visionMode'))
			const dirty = draft !== null && draft !== current
			const selected = draft === null ? current : draft
			const writable = snapshot.writable
			async function save() {
				if (draft === null || saving) return
				setSaving(true)
				try {
					const accepted = await form.mutate([{ op: 'set', path: ['visionMode'], value: draft }], snapshot.revision)
					if (!accepted) throw new Error('Host rejected configuration update')
					setDraft(null)
					setStatus('saved')
				} catch {
					setStatus('failed')
				} finally {
					setSaving(false)
				}
			}
			async function reset() {
				if (saving) return
				setSaving(true)
				try {
					const accepted = await form.mutate([{ op: 'unset', path: ['visionMode'] }], snapshot.revision)
					if (!accepted) throw new Error('Host rejected configuration update')
					setDraft(null)
					setStatus('saved')
				} catch {
					setStatus('failed')
				} finally {
					setSaving(false)
				}
			}
			return React.createElement('div', { className: 'dsh-penhost-settings-card dsh-penhost-settings-open' },
				React.createElement('div', {
					className: 'dsh-penhost-settings-head',
				},
						React.createElement('span', { className: 'dsh-penhost-settings-head-text' },
							React.createElement('span', { className: 'dsh-penhost-settings-name' }, labels.title),
							React.createElement('span', { className: 'dsh-penhost-settings-desc' }, labels.modeLabel)),
					dirty ? React.createElement('span', { className: 'dsh-penhost-settings-pending' }, labels.unsaved) : null),
				React.createElement('div', { className: 'dsh-penhost-settings-body' },
					!writable ? React.createElement('p', { className: 'dsh-penhost-settings-readonly' }, labels.readOnly) : null,
					React.createElement('div', { className: 'dsh-penhost-settings-options', role: 'radiogroup', 'aria-label': labels.modeLabel },
						React.createElement('label', { className: 'dsh-penhost-settings-option' + (selected === 'multimodal' ? ' dsh-penhost-settings-option-active' : '') },
							React.createElement('input', {
								type: 'radio', name: 'penhost-vision-mode', value: 'multimodal',
								checked: selected === 'multimodal', disabled: !writable,
								onChange: () => { setDraft('multimodal'); setStatus(null) },
							}),
							React.createElement('span', { className: 'dsh-penhost-settings-option-text' },
								React.createElement('span', { className: 'dsh-penhost-settings-option-title' }, labels.modeMultimodal),
								React.createElement('span', { className: 'dsh-penhost-settings-option-desc' }, labels.modeMultimodalHint))),
						React.createElement('label', { className: 'dsh-penhost-settings-option' + (selected === 'text' ? ' dsh-penhost-settings-option-active' : '') },
							React.createElement('input', {
								type: 'radio', name: 'penhost-vision-mode', value: 'text',
								checked: selected === 'text', disabled: !writable,
								onChange: () => { setDraft('text'); setStatus(null) },
							}),
							React.createElement('span', { className: 'dsh-penhost-settings-option-text' },
								React.createElement('span', { className: 'dsh-penhost-settings-option-title' }, labels.modeText),
								React.createElement('span', { className: 'dsh-penhost-settings-option-desc' }, labels.modeTextHint)))),
					React.createElement('div', { className: 'dsh-penhost-settings-footer' },
						status ? React.createElement('p', {
							className: 'dsh-penhost-settings-status' + (status === 'saved' ? ' dsh-penhost-settings-ok' : ''),
							role: 'status',
						}, status === 'saved' ? labels.saved : labels.saveFailed) : null,
						React.createElement('button', {
							type: 'button',
							className: 'dsh-penhost-settings-btn dsh-penhost-settings-btn-reset',
							disabled: !writable || saving || (!dirty && !overridden),
							onClick: reset,
						}, labels.reset),
						React.createElement('button', {
							type: 'button',
							className: 'dsh-penhost-settings-btn dsh-penhost-settings-btn-save',
							disabled: !writable || !dirty || saving,
							onClick: save,
						}, saving ? labels.saving : labels.save))))
		}

		const name = 'dsh-with-pencil'
		const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']

		function apply(ctx) {
			const store = createSessionStore()
			const tabActions = new Map()
			const releasing = new Map()
			const closePending = new Set()
			const closeAllowed = new Set()
			const onTabClosed = (sessionId) => {
				if (ctx.sidebarRight.openTabs.getSnapshot().some((item) => item.sessionId === sessionId && item.kind === PENCIL_TAB_KIND)) return
				const binding = store.getSnapshot().sessions[sessionId]?.binding
				store.remove(sessionId)
				if (!binding) return
				const release = fetch('/pen-host/unbind?binding=' + encodeURIComponent(binding), { method: 'POST', keepalive: true })
					.catch(() => undefined)
					.finally(() => { if (releasing.get(sessionId) === release) releasing.delete(sessionId) })
				releasing.set(sessionId, release)
			}
			const disposeStyles = insertStyles()
			const disposeSettingsCard = ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
				{ name: 'plugins.row.config', key: 'dsh-with-pencil#dsh-with-pencil' },
				(props) => props.view === 'summary'
					? PENCIL_SETTINGS_LABELS[languageFromLocale(ctx.locale)].modeLabel
					: React.createElement(PencilVisionCard, { ...props, locale: ctx.locale })))
			const disposeTabType = ctx.sidebarRightTabs.register({
				id: 'dsh-with-pencil', kind: PENCIL_TAB_KIND, keepMounted: true,
				title: () => LOCALIZED_CANVAS_LABELS[languageFromLocale(ctx.locale)].canvas,
			})
			const disposeTabBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
				{ name: 'sidebar.right.pane.tab', key: 'dsh-with-pencil' },
				(props) => React.createElement(PencilTab, { ...props, store, locale: ctx.locale, sidebarRight: ctx.sidebarRight, tabActions, releasing, onTabClosed })))
			const disposeTabTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
				{ name: 'sidebar.right.pane.tab.title', key: 'dsh-with-pencil' },
				(props) => React.createElement(PencilTabTitle, { ...props, locale: ctx.locale })))
			const disposeCloseHandler = ctx.sidebarRight.registerCloseHandler(PENCIL_TAB_KIND, (sessionId, tab) => {
				if (closeAllowed.delete(tab.id)) return
				const first = ctx.sidebarRight.openTabs.getSnapshot().find((item) => item.sessionId === sessionId && item.kind === PENCIL_TAB_KIND)
				const binding = store.getSnapshot().sessions[sessionId]?.binding
				const action = tabActions.get(tab.id)
				if (!binding || !action || first?.tabId !== tab.id) return
				if (!closePending.has(tab.id)) {
					closePending.add(tab.id)
					store.patch(sessionId, { closing: true, saveError: null })
					void fetch('/pen-host/save?binding=' + encodeURIComponent(binding), { method: 'POST' })
						.then(async (response) => {
							if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status))
							closeAllowed.add(tab.id)
							action.close()
						})
						.catch((error) => {
							closeAllowed.delete(tab.id)
							if (store.getSnapshot().sessions[sessionId]) store.patch(sessionId, { saveError: error && error.message ? error.message : String(error) })
						})
						.finally(() => {
							closePending.delete(tab.id)
							if (store.getSnapshot().sessions[sessionId]) store.patch(sessionId, { closing: false })
						})
				}
				throw new Error('pen.dev canvas is saving before the tab closes')
			})
			const disposeHeader = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
				{ name: 'conversation.session.header.actions', id: 'penhost-header', order: 90, label: () => LOCALIZED_CANVAS_LABELS[languageFromLocale(ctx.locale)].canvas },
				(props) => React.createElement(PenHeader, { ...props, store, locale: ctx.locale, sidebarRight: ctx.sidebarRight })))
			const disposeBlankTrigger = ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
				{ name: 'conversation.input.right', id: 'penhost-blank-trigger', order: 85, label: () => LOCALIZED_CANVAS_LABELS[languageFromLocale(ctx.locale)].canvas },
				(props) => React.createElement(PenBlankTrigger, { ...props, store, locale: ctx.locale, sidebarRight: ctx.sidebarRight })))
			return () => {
				if (typeof disposeSettingsCard === 'function') disposeSettingsCard()
				if (typeof disposeBlankTrigger === 'function') disposeBlankTrigger()
				if (typeof disposeHeader === 'function') disposeHeader()
				if (typeof disposeCloseHandler === 'function') disposeCloseHandler()
				if (typeof disposeTabTitle === 'function') disposeTabTitle()
				if (typeof disposeTabBody === 'function') disposeTabBody()
				if (typeof disposeTabType === 'function') disposeTabType()
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
