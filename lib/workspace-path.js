import fs from 'node:fs'
import path from 'node:path'

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function nearestExistingAncestor(target) {
  let current = target
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

/**
 * Resolve a model- or browser-supplied path inside one conversation workspace.
 *
 * The lexical check rejects ordinary `..`/absolute escapes. The realpath check
 * also rejects paths that stay lexically inside the workspace but traverse a
 * symlink to another directory. For a new output, the nearest existing parent
 * is checked so the final file does not need to exist yet.
 */
export function resolveWorkspacePath(workspace, input, options = {}) {
  const workspaceText = String(workspace || '').trim()
  if (!workspaceText || !path.isAbsolute(workspaceText)) throw new Error('conversation workspace must be an absolute path')
  const root = path.resolve(workspaceText)

  const raw = String(input || '')
  if (!raw) throw new Error(options.label ? options.label + ' is required' : 'path is required')
  const target = path.resolve(root, raw)
  if (!isInside(root, target)) throw new Error('path escapes the bound session workspace')

  let realRoot
  let realAncestor
  try {
    realRoot = fs.realpathSync.native(root)
    realAncestor = fs.realpathSync.native(nearestExistingAncestor(target))
  } catch (error) {
    throw new Error('workspace path cannot be resolved: ' + (error && error.message ? error.message : String(error)))
  }
  if (!isInside(realRoot, realAncestor)) throw new Error('path escapes the bound session workspace through a symlink')

  if (options.extension && path.extname(target).toLowerCase() !== String(options.extension).toLowerCase()) {
    throw new Error((options.label || 'path') + ' must end in ' + options.extension)
  }
  return target
}

export function workspaceForExec(policy, exec) {
  const session = exec && exec.agent && exec.agent.session
  const scoped = policy && typeof policy.resolve === 'function'
    ? policy.resolve(session ? { session } : {})
    : undefined
  const cwd = (scoped && scoped.workspaceRoot) || (session && session.header && session.header.cwd)
  if (!cwd) throw new Error('pen.dev requires a workspace-backed conversation')
  return path.resolve(String(cwd))
}
