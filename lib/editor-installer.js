import { createHash, randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'

export const OFFICIAL_EDITOR = Object.freeze({
  version: '0.1.94',
  downloadUrl: 'https://fauuw1qyejoc3spm.public.blob.vercel-storage.com/editor-bundle-v0.1.94.zip',
  sha256: '7b655d0ee6b18ca460959573661c250db650538443466c2783dd089d3e4ad22a',
})

const inflate = promisify(inflateRaw)
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024
const MAX_ENTRIES = 10_000

function defaultCacheRoot() {
  return process.env.DSH_PEN_EDITOR_CACHE_DIR
    ? path.resolve(process.env.DSH_PEN_EDITOR_CACHE_DIR)
    : path.join(os.homedir(), '.dsh', 'dsh-with-pencil', 'editor')
}

function readUInt16(buffer, offset, label) {
  if (offset < 0 || offset + 2 > buffer.length) throw new Error(`invalid editor ZIP: truncated ${label}`)
  return buffer.readUInt16LE(offset)
}

function readUInt32(buffer, offset, label) {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error(`invalid editor ZIP: truncated ${label}`)
  return buffer.readUInt32LE(offset)
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 65_535)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('invalid editor ZIP: central directory footer not found')
}

function safeEntryParts(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/')) {
    throw new Error(`invalid editor ZIP path: ${JSON.stringify(name)}`)
  }
  const parts = name.split('/')
  if (parts.at(-1) === '') parts.pop()
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`invalid editor ZIP path: ${JSON.stringify(name)}`)
  }
  if (parts[0] !== 'out') throw new Error(`invalid editor ZIP root: ${JSON.stringify(name)}`)
  return parts
}

function zipEntries(buffer) {
  const footer = findEndOfCentralDirectory(buffer)
  const disk = readUInt16(buffer, footer + 4, 'disk number')
  const centralDisk = readUInt16(buffer, footer + 6, 'central directory disk')
  const diskEntries = readUInt16(buffer, footer + 8, 'disk entry count')
  const totalEntries = readUInt16(buffer, footer + 10, 'entry count')
  const centralSize = readUInt32(buffer, footer + 12, 'central directory size')
  const centralOffset = readUInt32(buffer, footer + 16, 'central directory offset')
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error('invalid editor ZIP: multi-disk archives are not supported')
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('invalid editor ZIP: ZIP64 archives are not supported')
  }
  if (totalEntries > MAX_ENTRIES || centralOffset + centralSize > buffer.length) {
    throw new Error('invalid editor ZIP: central directory is out of bounds')
  }

  const entries = []
  let offset = centralOffset
  let extractedBytes = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUInt32(buffer, offset, 'central entry signature') !== 0x02014b50) {
      throw new Error('invalid editor ZIP: malformed central directory entry')
    }
    const flags = readUInt16(buffer, offset + 8, 'entry flags')
    const method = readUInt16(buffer, offset + 10, 'compression method')
    const compressedSize = readUInt32(buffer, offset + 20, 'compressed size')
    const uncompressedSize = readUInt32(buffer, offset + 24, 'uncompressed size')
    const nameLength = readUInt16(buffer, offset + 28, 'entry name length')
    const extraLength = readUInt16(buffer, offset + 30, 'entry extra length')
    const commentLength = readUInt16(buffer, offset + 32, 'entry comment length')
    const externalAttributes = readUInt32(buffer, offset + 38, 'external attributes')
    const localOffset = readUInt32(buffer, offset + 42, 'local entry offset')
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (end > buffer.length) throw new Error('invalid editor ZIP: truncated central directory entry')
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    const parts = safeEntryParts(name)
    const unixMode = externalAttributes >>> 16
    if ((flags & 1) !== 0) throw new Error(`invalid editor ZIP: encrypted entry ${name}`)
    if (method !== 0 && method !== 8) throw new Error(`invalid editor ZIP: unsupported compression method ${method}`)
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`invalid editor ZIP: symbolic link ${name}`)
    extractedBytes += uncompressedSize
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('invalid editor ZIP: extracted content is too large')
    entries.push({ name, parts, directory: name.endsWith('/'), method, compressedSize, uncompressedSize, localOffset })
    offset = end
  }
  if (offset !== centralOffset + centralSize) throw new Error('invalid editor ZIP: central directory size mismatch')
  return entries
}

async function extractArchive(archive, destination) {
  for (const entry of zipEntries(archive)) {
    const target = path.join(destination, ...entry.parts)
    if (entry.directory) {
      await fsp.mkdir(target, { recursive: true })
      continue
    }
    if (readUInt32(archive, entry.localOffset, 'local entry signature') !== 0x04034b50) {
      throw new Error(`invalid editor ZIP: missing local entry for ${entry.name}`)
    }
    const localNameLength = readUInt16(archive, entry.localOffset + 26, 'local name length')
    const localExtraLength = readUInt16(archive, entry.localOffset + 28, 'local extra length')
    const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataOffset + entry.compressedSize
    if (dataEnd > archive.length) throw new Error(`invalid editor ZIP: truncated data for ${entry.name}`)
    const compressed = archive.subarray(dataOffset, dataEnd)
    const content = entry.method === 0 ? Buffer.from(compressed) : await inflate(compressed)
    if (content.length !== entry.uncompressedSize) {
      throw new Error(`invalid editor ZIP: size mismatch for ${entry.name}`)
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content, { flag: 'wx' })
  }
}

async function isInstalled(directory, metadata) {
  try {
    const marker = JSON.parse(await fsp.readFile(path.join(directory, '.installed.json'), 'utf8'))
    const index = await fsp.stat(path.join(directory, 'out', 'index.html'))
    return index.isFile() && marker.version === metadata.version && marker.sha256 === metadata.sha256
  } catch (error) {
    return false
  }
}

async function downloadArchive(metadata, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('this Node.js runtime does not provide fetch')
  const response = await fetchImpl(metadata.downloadUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`official editor download failed: HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_ARCHIVE_BYTES) throw new Error('official editor download is unexpectedly large')
  const archive = Buffer.from(await response.arrayBuffer())
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('official editor download is unexpectedly large')
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== metadata.sha256) {
    throw new Error(`official editor checksum mismatch (expected ${metadata.sha256}, received ${actual})`)
  }
  return archive
}

async function acquireInstallLock(cacheRoot, target, metadata) {
  const lockPath = path.join(cacheRoot, `.${metadata.version}.lock`)
  const deadline = Date.now() + 125_000
  for (;;) {
    if (await isInstalled(target, metadata)) return null
    try {
      const handle = await fsp.open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
      } catch (error) {
        await handle.close()
        try { await fsp.unlink(lockPath) } catch (unlinkError) { /* preserve the original write failure */ }
        throw error
      }
      return async () => {
        await handle.close()
        try { await fsp.unlink(lockPath) } catch (error) { /* another process may have cleaned a stale lock */ }
      }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error
      try {
        const stat = await fsp.stat(lockPath)
        if (Date.now() - stat.mtimeMs > 5 * 60_000) await fsp.unlink(lockPath)
      } catch (statError) { /* the owning process released it */ }
      if (Date.now() >= deadline) throw new Error('timed out waiting for another process to install the Pencil editor')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}

/** Download the pinned official browser editor directly from pen.dev and cache it locally. */
export async function installOfficialEditor(options = {}) {
  const metadata = options.metadata || OFFICIAL_EDITOR
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version) || !/^https:\/\//.test(metadata.downloadUrl) || !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
    throw new Error('invalid pinned editor metadata')
  }
  const cacheRoot = path.resolve(options.cacheRoot || defaultCacheRoot())
  const target = path.join(cacheRoot, metadata.version)
  if (await isInstalled(target, metadata)) return path.join(target, 'out')
  await fsp.mkdir(cacheRoot, { recursive: true })
  const releaseLock = await acquireInstallLock(cacheRoot, target, metadata)
  if (!releaseLock) return path.join(target, 'out')
  const staging = path.join(cacheRoot, `.${metadata.version}-${randomUUID()}.tmp`)
  try {
    if (await isInstalled(target, metadata)) return path.join(target, 'out')
    const archive = await downloadArchive(metadata, options.fetchImpl || globalThis.fetch)
    await fsp.mkdir(staging, { recursive: false, mode: 0o700 })
    await extractArchive(archive, staging)
    const index = await fsp.readFile(path.join(staging, 'out', 'index.html'), 'utf8')
    if (!index.includes('<script type="module"')) throw new Error('downloaded Pencil editor has no module entrypoint')
    await fsp.writeFile(path.join(staging, '.installed.json'), JSON.stringify({
      version: metadata.version,
      sha256: metadata.sha256,
      source: metadata.downloadUrl,
      installedAt: new Date().toISOString(),
    }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    if (await isInstalled(target, metadata)) return path.join(target, 'out')
    await fsp.rm(target, { recursive: true, force: true })
    await fsp.rename(staging, target)
    return path.join(target, 'out')
  } finally {
    try { await fsp.rm(staging, { recursive: true, force: true }) } catch (error) { /* renamed or already absent */ }
    await releaseLock()
  }
}
