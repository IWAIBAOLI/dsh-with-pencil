import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installOfficialEditor } from '../lib/editor-installer.js'

function storedZip(files) {
  const locals = []
  const centrals = []
  let localOffset = 0
  for (const [name, source] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const content = Buffer.from(source)
    const local = Buffer.alloc(30 + nameBytes.length + content.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(local, 30)
    content.copy(local, 30 + nameBytes.length)
    locals.push(local)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(localOffset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)
    localOffset += local.length
  }
  const centralOffset = localOffset
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0)
  const footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50, 0)
  footer.writeUInt16LE(centrals.length, 8)
  footer.writeUInt16LE(centrals.length, 10)
  footer.writeUInt32LE(centralSize, 12)
  footer.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([...locals, ...centrals, footer])
}

function metadataFor(archive, version = '0.1.94') {
  return {
    version,
    downloadUrl: `https://official.example/editor-${version}.zip`,
    sha256: createHash('sha256').update(archive).digest('hex'),
  }
}

function fetchArchive(archive, counter) {
  return async () => {
    counter.count += 1
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(archive.length) }),
      async arrayBuffer() { return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) },
    }
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pencil-editor-install-'))
try {
  const archive = storedZip({
    'out/index.html': '<html><script type="module" src="/assets/app.js"></script></html>',
    'out/assets/app.js': 'window.pencilEditor = true',
  })
  const metadata = metadataFor(archive)
  const counter = { count: 0 }
  const cacheRoot = path.join(temporary, 'cache')
  const first = await installOfficialEditor({ cacheRoot, metadata, fetchImpl: fetchArchive(archive, counter) })
  assert.equal(fs.readFileSync(path.join(first, 'assets', 'app.js'), 'utf8'), 'window.pencilEditor = true')
  assert.equal(counter.count, 1)
  const second = await installOfficialEditor({ cacheRoot, metadata, fetchImpl: fetchArchive(archive, counter) })
  assert.equal(second, first)
  assert.equal(counter.count, 1, 'a verified cached editor must not be downloaded again')
  assert.equal(fs.statSync(path.join(cacheRoot, metadata.version, '.installed.json')).mode & 0o777, 0o600)

  const concurrentMetadata = metadataFor(archive, '0.1.96')
  const concurrentCounter = { count: 0 }
  const concurrentFetch = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 20))
    return fetchArchive(archive, concurrentCounter)(...args)
  }
  const concurrentRoot = path.join(temporary, 'concurrent')
  const concurrent = await Promise.all([
    installOfficialEditor({ cacheRoot: concurrentRoot, metadata: concurrentMetadata, fetchImpl: concurrentFetch }),
    installOfficialEditor({ cacheRoot: concurrentRoot, metadata: concurrentMetadata, fetchImpl: concurrentFetch }),
  ])
  assert.equal(concurrent[0], concurrent[1])
  assert.equal(concurrentCounter.count, 1, 'parallel installers must share the completed cache')

  await assert.rejects(
    installOfficialEditor({
      cacheRoot: path.join(temporary, 'bad-checksum'),
      metadata: { ...metadata, sha256: '0'.repeat(64) },
      fetchImpl: fetchArchive(archive, { count: 0 }),
    }),
    /checksum mismatch/,
  )

  const traversalArchive = storedZip({
    'out/index.html': '<script type="module"></script>',
    'out/../escaped.txt': 'must not escape',
  })
  await assert.rejects(
    installOfficialEditor({
      cacheRoot: path.join(temporary, 'bad-path'),
      metadata: metadataFor(traversalArchive, '0.1.95'),
      fetchImpl: fetchArchive(traversalArchive, { count: 0 }),
    }),
    /invalid editor ZIP path/,
  )
  assert.equal(fs.existsSync(path.join(temporary, 'bad-path', 'escaped.txt')), false)

  console.log('official editor installer: ok')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
