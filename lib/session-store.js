import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Share Pencil authentication across canvases without placing secrets in workspaces. */
export function createSessionStore() {
  const stateFile = path.resolve(process.env.DSH_PEN_STATE_FILE || path.join(os.homedir(), '.dsh', 'pen-dev-bridge', 'state.json'))
  const cliSessionFile = path.join(os.homedir(), '.pencil', 'session-cli.json')
  const state = { email: '', token: '' }

  try { fs.chmodSync(stateFile, 0o600) } catch (error) { /* no persisted state yet */ }
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (saved && saved.token) { state.email = saved.email || ''; state.token = saved.token }
  } catch (error) { /* no valid persisted state yet */ }

  function get() {
    if (state.email && state.token) return { email: state.email, token: state.token }
    try {
      const cli = JSON.parse(fs.readFileSync(cliSessionFile, 'utf8'))
      if (cli && cli.email && cli.token) return { email: cli.email, token: cli.token }
    } catch (error) { /* not logged in via CLI either */ }
    return { email: '', token: '' }
  }
  function persist() {
    const temporary = stateFile + '.tmp-' + randomUUID()
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 })
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 })
      fs.renameSync(temporary, stateFile)
      fs.chmodSync(stateFile, 0o600)
    } catch (error) {
      try { fs.unlinkSync(temporary) } catch (cleanupError) { /* no temporary state */ }
      console.warn('[pen-dev-bridge] failed to persist browser session:', error && error.message)
    }
  }
  function set(value) {
    if (!value || !value.token) return false
    state.email = value.email || ''
    state.token = value.token
    persist()
    return true
  }

  return { get, set, token() { return get().token || null } }
}
