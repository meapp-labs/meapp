import { expect, test } from 'bun:test'
import { readMediaResponse } from './mediaResponse'

test('media downloads reject oversized streams before buffering them and cancel the reader', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(20))
    },
    cancel() {
      cancelled = true
    },
  })
  await expect(readMediaResponse(new Response(body), 10)).rejects.toThrow('Media size mismatch')
  expect(cancelled).toBe(true)
})
test('media downloads accept exact sizes and reject truncation or conflicting headers', async () => {
  expect(await readMediaResponse(new Response(new Uint8Array([1, 2, 3])), 3)).toEqual(
    new Uint8Array([1, 2, 3]),
  )
  await expect(readMediaResponse(new Response(new Uint8Array([1, 2])), 3)).rejects.toThrow(
    'Media size mismatch',
  )
  await expect(
    readMediaResponse(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '4' } }),
      3,
    ),
  ).rejects.toThrow('Media size mismatch')
})
