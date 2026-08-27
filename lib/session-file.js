import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Authoritative document identity for a conversation. The host coordinates
 * switching; consumers derive paths/URIs from this immutable snapshot. An
 * editor's loaded document is separate state, never another current-file source.
 */

const currentBySession = new Map()

/** Absolute path of the session's current working .pen file, or null. */
export function getSessionFile(sessionId) {
  return getSessionDocument(sessionId)?.filePath || null
}

export function getSessionDocument(sessionId) {
  return sessionId ? currentBySession.get(String(sessionId)) || null : null
}

/** Publish a document switch, after saving the previous document if needed. */
export function setSessionFile(sessionId, file) {
  if (!sessionId) return null
  if (!path.isAbsolute(file)) throw new Error('current .pen file must be an absolute path')
  const filePath = path.resolve(file)
  const previous = getSessionDocument(sessionId)
  if (previous?.filePath === filePath) return previous
  const document = Object.freeze({
    filePath,
    fileURI: pathToFileURL(filePath).toString(),
    directory: path.dirname(filePath),
    revision: (previous?.revision || 0) + 1,
  })
  currentBySession.set(String(sessionId), document)
  return document
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
