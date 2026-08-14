import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Share Pencil authentication across canvases without placing secrets in workspaces. */
export function createSessionStore() {
  const configuredStateFile = process.env.DSH_PEN_STATE_FILE
  const stateFile = path.resolve(configuredStateFile || path.join(os.homedir(), '.dsh', 'dsh-with-pencil', 'state.json'))
  const legacyStateFile = configuredStateFile ? null : path.join(os.homedir(), '.dsh', 'pen-dev-bridge', 'state.json')
  const cliSessionFile = path.join(os.homedir(), '.pencil', 'session-cli.json')
  const state = { email: '', token: '' }

  try { fs.chmodSync(stateFile, 0o600) } catch (error) { /* no persisted state yet */ }
  for (const candidate of [stateFile, legacyStateFile]) {
    if (!candidate) continue
    try {
      const saved = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (saved && saved.token) {
        state.email = saved.email || ''
        state.token = saved.token
        break
      }
    } catch (error) { /* try the next compatible state location */ }
  }

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
      console.warn('[dsh-with-pencil] failed to persist browser session:', error && error.message)
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
