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
    const refs = []
    collectImageRefs(messages, (ref) => refs.push(ref))
    if (refs.length === 0) return
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
    for (const ref of refs) {
      const id = refId(ref)
      if (!id) continue
      const key = String(id)
      // Refresh encounter order. This makes `latest` / `recent:N` follow the
      // most recently observed image batch while exact-id lookup stays stable.
      map.delete(key)
      map.set(key, ref)
      if (byId) {
        byId.delete(key)
        byId.set(key, ref)
      }
    }
  }

  function lookup(session, id) {
    if (!session || !id) return undefined
    const key = String(id).trim()
    const byId = session.id !== undefined ? bySessionId.get(String(session.id)) : undefined
    const map = byId || bySessionObject.get(session)
    if (!map) return undefined
    const exact = map.get(key)
    if (exact) return exact
    const values = [...map.values()]
    if (key.toLowerCase() === 'latest') return values.at(-1)
    const recent = /^recent:(\d+)$/i.exec(key)
    if (recent) {
      const offset = Number(recent[1])
      if (Number.isSafeInteger(offset) && offset > 0) return values.at(-offset)
    }
    return undefined
  }

  function clear(session) {
    if (!session) return
    if (session.id !== undefined) bySessionId.delete(String(session.id))
    bySessionObject.delete(session)
  }

  return { record, lookup, clear }
}
