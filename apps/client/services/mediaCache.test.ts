import { expect, spyOn, test } from 'bun:test'
import { MEDIA_CACHE_TTL_MS } from '@meapp/shared'
import {
  cacheMedia,
  clearMediaCache,
  getCachedMedia,
  mediaCacheEpoch,
  pruneMediaCache,
  removeCachedAttachment,
} from './mediaCache.web'

test('web plaintext cache clears on logout and rejects downloads from the old session', async () => {
  await clearMediaCache()
  const epoch = mediaCacheEpoch()
  const url = await cacheMedia('image', new Uint8Array([1, 2]), 'image/webp', epoch)
  expect(await getCachedMedia('image')).toBe(url)
  await clearMediaCache()
  expect(await getCachedMedia('image')).toBeNull()
  await expect(
    cacheMedia('late-download', new Uint8Array([1]), 'image/webp', epoch),
  ).rejects.toThrow('Media session ended')
})

test('plaintext cache expiry is absolute and deleting an attachment revokes both variants', async () => {
  await clearMediaCache()
  const clock = spyOn(Date, 'now')
  const start = 100000
  clock.mockReturnValue(start)
  try {
    const id = crypto.randomUUID()
    await cacheMedia(`${id}.webp`, new Uint8Array([1]), 'image/webp')
    await cacheMedia(`${id}-thumb.webp`, new Uint8Array([1]), 'image/webp')
    await removeCachedAttachment(id)
    expect(await getCachedMedia(`${id}.webp`)).toBeNull()
    expect(await getCachedMedia(`${id}-thumb.webp`)).toBeNull()
    await cacheMedia('expiry', new Uint8Array([1]), 'image/webp')
    clock.mockReturnValue(start + MEDIA_CACHE_TTL_MS - 1)
    expect(await getCachedMedia('expiry')).not.toBeNull()
    clock.mockReturnValue(start + MEDIA_CACHE_TTL_MS)
    pruneMediaCache()
    expect(await getCachedMedia('expiry')).toBeNull()
  } finally {
    clock.mockRestore()
    await clearMediaCache()
  }
})

test('web cache evicts least recently used objects at its byte cap', async () => {
  await clearMediaCache()
  const bytes = new Uint8Array(40 * 1024 * 1024)
  await cacheMedia('first', bytes, 'image/webp')
  await cacheMedia('second', bytes, 'image/webp')
  await getCachedMedia('first')
  await cacheMedia('third', bytes, 'image/webp')
  expect(await getCachedMedia('second')).toBeNull()
  expect(await getCachedMedia('first')).not.toBeNull()
  expect(await getCachedMedia('third')).not.toBeNull()
  await clearMediaCache()
})
