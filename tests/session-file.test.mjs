import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { clearSessionFile, getSessionDocument, getSessionFile, setSessionFile } from '../lib/session-file.js'

const session = 'document-context-test'
const firstPath = path.join(os.tmpdir(), '设计 #1 %', 'first.pen')
const secondPath = path.join(os.tmpdir(), 'another', 'second.pen')
try {
  assert.equal(getSessionDocument(session), null)
  const first = setSessionFile(session, firstPath)
  assert.equal(getSessionFile(session), firstPath)
  assert.equal(fileURLToPath(first.fileURI), firstPath)
  assert.equal(first.directory, path.dirname(firstPath))
  assert.equal(first.revision, 1)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(setSessionFile(session, firstPath), first)
  assert.equal(setSessionFile(session, secondPath).revision, 2)
  const returned = setSessionFile(session, firstPath)
  assert.equal(returned.revision, 3, 'A -> B -> A must invalidate the first A editor')
  assert.equal(first.revision, 1, 'in-flight operations retain an immutable snapshot')
  assert.equal(getSessionDocument('another-session'), null)
  assert.throws(() => setSessionFile(session, 'relative.pen'), /absolute/)
  assert.equal(getSessionDocument(session), returned)
  console.log('canonical document identity, URI encoding, and switch revisions: ok')
} finally { clearSessionFile(session) }
