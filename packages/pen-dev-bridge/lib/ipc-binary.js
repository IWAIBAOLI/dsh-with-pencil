/** Encode structured-clone binary values for the JSON-only Browser/Host bridge. */
export function encodeIpcBinary(value) {
  if (Buffer.isBuffer(value)) return { __penBinaryBase64: value.toString('base64') }
  if (value instanceof ArrayBuffer) {
    return { __penBinaryBase64: Buffer.from(value).toString('base64') }
  }
  if (ArrayBuffer.isView(value)) {
    return {
      __penBinaryBase64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    }
  }
  if (Array.isArray(value)) return value.map(encodeIpcBinary)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeIpcBinary(item)]))
  }
  return value
}

/** Decode binary markers emitted by the browser bootstrap into Node Buffers. */
export function decodeIpcBinary(value) {
  if (Array.isArray(value)) return value.map(decodeIpcBinary)
  if (value && typeof value === 'object') {
    if (typeof value.__penBinaryBase64 === 'string') {
      return Buffer.from(value.__penBinaryBase64, 'base64')
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeIpcBinary(item)]))
  }
  return value
}
