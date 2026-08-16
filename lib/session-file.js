/**
 * Session-scoped "current working .pen file" — a thin shared datum, not a
 * coordinator. Every file-switch entry point (agent `open`, the canvas UI
 * file menu, Save As, rename/delete fallback) writes it; every reader that
 * needs to know which file a session is working on (headless engine load,
 * tool-call default target) reads it. The webview binding and the headless
 * engine keep their own loaded-file details, but they align through this
 * single source of truth instead of drifting apart.
 */

const currentBySession = new Map()

/** Absolute path of the session's current working .pen file, or null. */
export function getSessionFile(sessionId) {
  return sessionId ? currentBySession.get(String(sessionId)) || null : null
}

/** Record the session's current working .pen file (absolute path). */
export function setSessionFile(sessionId, file) {
  if (!sessionId) return
  currentBySession.set(String(sessionId), file)
}

/** Forget the session's current file (session teardown). */
export function clearSessionFile(sessionId) {
  if (sessionId) currentBySession.delete(String(sessionId))
}

/** Resolve the session id from a tool exec context. */
export function sessionIdOf(exec) {
  const session = exec && exec.agent && exec.agent.session
  return session ? String(session.id) : ''
}
