import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveWorkspacePath } from '../lib/workspace-path.js'

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-workspace-path-'))
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-workspace-outside-'))

try {
  assert.throws(() => resolveWorkspacePath('', 'design.pen'), /workspace must be an absolute path/)
  assert.throws(() => resolveWorkspacePath('relative', 'design.pen'), /workspace must be an absolute path/)
  assert.equal(resolveWorkspacePath(workspace, 'designs/login.pen'), path.join(workspace, 'designs/login.pen'))
  assert.throws(() => resolveWorkspacePath(workspace, '../outside.pen'), /escapes/)
  assert.throws(() => resolveWorkspacePath(workspace, path.join(outside, 'outside.pen')), /escapes/)
  assert.throws(() => resolveWorkspacePath(workspace, 'designs/login.json', { extension: '.pen' }), /must end in \.pen/)

  const linked = path.join(workspace, 'linked')
  fs.symlinkSync(outside, linked, 'dir')
  assert.throws(() => resolveWorkspacePath(workspace, 'linked/escaped.pen'), /through a symlink/)

  console.log('workspace path boundary: ok')
} finally {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
}
