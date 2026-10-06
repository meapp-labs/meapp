import { expect, test } from 'bun:test'
import { cacheMedia, clearMediaCache, getCachedMedia, mediaCacheEpoch } from './mediaCache.web'

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
