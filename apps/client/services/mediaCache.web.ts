const cache = new Map<string, { url: string; size: number }>()
const MAX_BYTES = 100 * 1024 * 1024
let total = 0
let epoch = 0
export const mediaCacheEpoch = () => epoch

export async function cacheMedia(
  name: string,
  bytes: Uint8Array,
  mime: string,
  expectedEpoch = epoch,
): Promise<string> {
  if (epoch !== expectedEpoch) throw new Error('Media session ended')
  const previous = cache.get(name)
  if (previous) {
    URL.revokeObjectURL(previous.url)
    total -= previous.size
    cache.delete(name)
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }))
  cache.set(name, { url, size: bytes.length })
  total += bytes.length
  for (const [key, entry] of cache) {
    if (total <= MAX_BYTES) break
    URL.revokeObjectURL(entry.url)
    total -= entry.size
    cache.delete(key)
  }
  return url
}

export async function getCachedMedia(name: string): Promise<string | null> {
  const entry = cache.get(name)
  if (!entry) return null
  cache.delete(name)
  cache.set(name, entry)
  return entry.url
}

export async function clearMediaCache(): Promise<void> {
  epoch++
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url)
  cache.clear()
  total = 0
}
