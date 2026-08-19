import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sniffImageMediaType, imageExtension, writeImageAsset } from '../lib/image-assets.js'

// A minimal valid 1x1 red PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const png = Buffer.from(PNG_B64, 'base64')

assert.equal(sniffImageMediaType(png), 'image/png')
assert.equal(sniffImageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg')
assert.equal(sniffImageMediaType(Buffer.from('RIFF' + 'xxxx' + 'WEBP', 'binary')), 'image/webp')
assert.equal(sniffImageMediaType(Buffer.from('not an image')), undefined)
assert.equal(sniffImageMediaType(Buffer.alloc(4)), undefined)

assert.equal(imageExtension('image/png'), 'png')
assert.equal(imageExtension('image/jpeg'), 'jpg')
assert.equal(imageExtension('image/gif'), 'gif')
assert.equal(imageExtension('image/webp'), 'webp')

const penDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-image-assets-'))
try {
  const { absolute, relativeUrl } = await writeImageAsset(penDir, png, 'image/png')
  assert.ok(fs.existsSync(absolute), 'image file written')
  assert.equal(relativeUrl, './images/' + path.basename(absolute))
  assert.equal(path.dirname(absolute), path.join(penDir, 'images'))
  assert.equal(fs.readFileSync(absolute).equals(png), true, 'bytes preserved')
  // idempotent-ish: second write gets a unique file
  const second = await writeImageAsset(penDir, png, 'image/png')
  assert.notEqual(second.absolute, absolute)
  console.log('image-assets: ok')
} finally {
  fs.rmSync(penDir, { recursive: true, force: true })
}
