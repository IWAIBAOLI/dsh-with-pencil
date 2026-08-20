import assert from 'node:assert/strict'
import { createSessionImages, collectImageRefs } from '../lib/session-images.js'

// collectImageRefs walks nested content and visits every image attachment ref.
let visited = []
collectImageRefs([
  { role: 'user', content: [
    { type: 'text', text: 'hi' },
    { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png' } },
    { content: [
      { type: 'image', attachment: { attachmentId: 'a2', mediaType: 'image/jpeg' } },
    ] },
  ] },
  { role: 'assistant', content: [] },
], (ref) => visited.push(ref.attachmentId))
assert.deepEqual(visited.sort(), ['a1', 'a2'])
assert.equal(collectImageRefs([], () => {}), undefined)

// registry: record then look up by id (both object- and id-keyed index).
const images = createSessionImages()
const session = { id: 'sess-1' }
images.record(session, [{ content: [{ type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png' } }] }])
assert.equal(images.lookup(session, 'img-1').attachmentId, 'img-1')
assert.equal(images.lookup(session, 'latest').attachmentId, 'img-1')
assert.equal(images.lookup(session, 'recent:1').attachmentId, 'img-1')
assert.equal(images.lookup(session, 'missing'), undefined)
images.record(session, [{ content: [{ type: 'image', attachment: { attachmentId: 'img-new', mediaType: 'image/webp' } }] }])
assert.equal(images.lookup(session, 'latest').attachmentId, 'img-new')
assert.equal(images.lookup(session, 'recent:2').attachmentId, 'img-1')
assert.equal(images.lookup(session, 'recent:0'), undefined)
assert.equal(images.lookup(session, 'recent:3'), undefined)
// a different session must not see it
assert.equal(images.lookup({ id: 'sess-2' }, 'img-1'), undefined)
// record via `id` alias too
const session2 = { id: 'sess-3' }
images.record(session2, [{ content: [{ type: 'image', attachment: { id: 'img-2' } }] }])
assert.equal(images.lookup(session2, 'img-2').id, 'img-2')
// clear removes
images.clear(session)
assert.equal(images.lookup(session, 'img-1'), undefined)

// The id-keyed fallback is bounded and evicts the least-recently-used session.
for (let index = 0; index <= 256; index++) {
  const boundedSession = { id: 'bounded-' + index }
  images.record(boundedSession, [{ content: [{ type: 'image', attachment: { attachmentId: 'bounded-image-' + index } }] }])
}
assert.equal(images.lookup({ id: 'bounded-0' }, 'bounded-image-0'), undefined)
assert.equal(images.lookup({ id: 'bounded-256' }, 'bounded-image-256').attachmentId, 'bounded-image-256')

console.log('session-images: ok')
