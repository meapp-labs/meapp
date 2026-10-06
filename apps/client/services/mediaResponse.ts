/** Enforce the authenticated manifest's size before buffering untrusted bytes. */
export async function readMediaResponse(response: Response, expectedSize: number) {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) !== expectedSize) throw new Error('Media size mismatch')
  if (!response.body) {
    // Native Fetch can omit readable streams; R2 provides an exact length.
    if (length === null) throw new Error('Media response length is missing')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length !== expectedSize) throw new Error('Media size mismatch')
    return bytes
  }
  const reader = response.body.getReader()
  const bytes = new Uint8Array(expectedSize)
  let offset = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.length > expectedSize) {
        await reader.cancel()
        throw new Error('Media size mismatch')
      }
      bytes.set(value, offset)
      offset += value.length
    }
    if (offset !== expectedSize) throw new Error('Media size mismatch')
    return bytes
  } finally {
    reader.releaseLock()
  }
}
