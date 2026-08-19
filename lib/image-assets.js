/**
 * Small image-asset helpers for placing chat images onto a `.pen` canvas.
 *
 * pen.dev's official way to put an image on the canvas is an image *fill*:
 * a node's `fill: { type:'image', url, mode }`, where `url` is relative to the
 * `.pen` file. Following the editor's own convention, imported/generated
 * images live in an `images/` directory next to the `.pen`, so we write there
 * and reference it with `./images/<name>`.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Magic-byte sniff (extensionless content-addressed files are common). */
export function sniffImageMediaType(bytes) {
  if (!bytes || bytes.length < 12) return undefined
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  // WebP (RIFF....WEBP)
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return undefined
}

export function imageExtension(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/gif') return 'gif'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

export function extensionToMediaType(value) {
  const ext = String(value || '').toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.png') return 'image/png'
  return undefined
}

/**
 * Write image bytes into `<penDir>/images/` (created on demand) and return the
 * absolute path plus the `.pen`-relative URL to reference in an image fill.
 */
export async function writeImageAsset(penDir, bytes, mediaType) {
  const imagesDir = path.join(penDir, 'images')
  await fs.mkdir(imagesDir, { recursive: true })
  const name = `pencil-${Date.now()}-${randomUUID().slice(0, 8)}.${imageExtension(mediaType)}`
  const target = path.join(imagesDir, name)
  await fs.writeFile(target, bytes)
  return { absolute: target, relativeUrl: './images/' + name }
}
