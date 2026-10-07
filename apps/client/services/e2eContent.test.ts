import { expect, test } from 'bun:test'
import { verifyMediaIds } from '@meapp/shared'
import { decodeContent, encodeContent } from './e2eContent'

test('structured caches preserve arbitrary text including the former media marker', () => {
  const text = 'meapp:media:v1:{"text":"different"}'
  expect(decodeContent(encodeContent(text))).toEqual({ text })
})
test('cached media stays structured when the server strips its attachment IDs', () => {
  const media = [
    {
      v: 1 as const,
      id: crypto.randomUUID(),
      base: `cap/${'a'.repeat(32)}`,
      kind: 'image' as const,
      key: btoa('k'.repeat(32)),
      width: 10,
      height: 10,
      variants: [
        {
          name: 'orig' as const,
          path: 'orig.enc' as const,
          size: 100,
          iv: btoa('i'.repeat(12)),
          digest: btoa('d'.repeat(64)),
          mime: 'image/webp' as const,
        },
      ],
    },
  ]
  const content = decodeContent(encodeContent('', media))
  expect(() => verifyMediaIds([], content.media)).toThrow()
  expect(content.text).toBeUndefined()
})

test('reply references survive encrypted content caches without forwarding quotes', () => {
  const replyTo = crypto.randomUUID()
  const threadRootId = crypto.randomUUID()
  expect(decodeContent(encodeContent('Reply', [], replyTo, threadRootId))).toEqual({
    text: 'Reply',
    replyTo,
    threadRootId,
  })
  expect(() => decodeContent(JSON.stringify({ text: 'Reply', replyTo: 'pending-id' }))).toThrow()
})
