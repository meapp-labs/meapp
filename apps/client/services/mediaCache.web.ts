import { MEDIA_CACHE_TTL_MS } from '@meapp/shared'
import { clearMediaTransfers } from './mediaTransfers'
const cache = new Map<string, { url: string; size: number; createdAt: number }>()
const MAX_BYTES = 100 * 1024 * 1024
let total = 0
let epoch = 0
export const mediaCacheEpoch = () => epoch

export function pruneMediaCache() {
  for (const [name, entry] of cache) {
    if (Date.now() - entry.createdAt >= MEDIA_CACHE_TTL_MS) {
      URL.revokeObjectURL(entry.url)
      total -= entry.size
      cache.delete(name)
    }
  }
}

export async function removeCachedAttachment(id: string) {
  for (const [name, entry] of cache) {
    if (name.startsWith(`${id}.`) || name.startsWith(`${id}-thumb.`)) {
      URL.revokeObjectURL(entry.url)
      total -= entry.size
      cache.delete(name)
    }
  }
}

export async function cacheMedia(
  name: string,
  bytes: Uint8Array,
  mime: string,
  expectedEpoch = epoch,
): Promise<string> {
  if (epoch !== expectedEpoch) throw new Error('Media session ended')
  pruneMediaCache()
  const previous = cache.get(name)
  if (previous) {
    URL.revokeObjectURL(previous.url)
    total -= previous.size
    cache.delete(name)
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }))
  cache.set(name, { url, size: bytes.length, createdAt: Date.now() })
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
  if (Date.now() - entry.createdAt >= MEDIA_CACHE_TTL_MS) {
    URL.revokeObjectURL(entry.url)
    total -= entry.size
    cache.delete(name)
    return null
  }
  cache.delete(name)
  cache.set(name, entry)
  return entry.url
}

export async function clearMediaCache(): Promise<void> {
  epoch++
  clearMediaTransfers()
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url)
  cache.clear()
  total = 0
}
