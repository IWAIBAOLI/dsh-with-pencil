/**
 * Session-scoped registry of "chat images" — the durable image attachments that
 * appear in a conversation's model-visible messages.
 *
 * Harness chat images are `ImageBlock`s whose `attachment` carries an
 * `ImageAttachmentRef` (`attachmentId` + metadata). This module watches the
 * agent loop's pre-step messages (the same seam `dsh-vision-router` uses) and
 * keeps a `session -> attachmentId -> ref` index so a model-facing tool can
 * resolve "that image from the chat" by its attachment id.
 *
 * It only records refs — it never rewrites, strips, or persists anything. A
 * tool that needs the bytes calls the attachment service's `readImage(ref)`.
 */

/** An id from an `ImageAttachmentRef` (either field the harness may use). */
function refId(ref) {
  return ref && (ref.attachmentId || ref.id)
}

/** Visit every `ImageAttachmentRef` nested in model-visible message content. */
export function collectImageRefs(messages, visit) {
  if (typeof visit !== 'function') return
  const walkContent = (content) => {
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (!block) continue
      if (block.type === 'image' && block.attachment) visit(block.attachment)
      else if (Array.isArray(block.content)) walkContent(block.content)
    }
  }
  for (const message of messages || []) {
    if (message && Array.isArray(message.content)) walkContent(message.content)
  }
}

export function createSessionImages() {
  const maxSessionIds = 256
  // session object -> Map<attachmentId, ref>
  const bySessionObject = new WeakMap()
  // session.id string -> Map<attachmentId, ref> (object identity can change
  // across turns, so keep the id-keyed index as the primary lookup).
  const bySessionId = new Map()

  function record(session, messages) {
    if (!session || !Array.isArray(messages)) return
    const map = bySessionObject.get(session) || new Map()
    bySessionObject.set(session, map)
    let byId
    if (session.id !== undefined) {
      const sessionId = String(session.id)
      byId = bySessionId.get(sessionId)
      if (!byId) {
        byId = new Map()
        bySessionId.set(sessionId, byId)
        while (bySessionId.size > maxSessionIds) {
          bySessionId.delete(bySessionId.keys().next().value)
        }
      } else {
        // Refresh recency so active conversations survive bounded eviction.
        bySessionId.delete(sessionId)
        bySessionId.set(sessionId, byId)
      }
    }
    collectImageRefs(messages, (ref) => {
      const id = refId(ref)
      if (!id) return
      map.set(String(id), ref)
      byId && byId.set(String(id), ref)
    })
  }

  function lookup(session, id) {
    if (!session || !id) return undefined
    const byId = session.id !== undefined ? bySessionId.get(String(session.id)) : undefined
    if (byId) {
      const hit = byId.get(String(id))
      if (hit) return hit
    }
    const map = bySessionObject.get(session)
    return map ? map.get(String(id)) : undefined
  }

  function clear(session) {
    if (!session) return
    if (session.id !== undefined) bySessionId.delete(String(session.id))
    bySessionObject.delete(session)
  }

  return { record, lookup, clear }
}
