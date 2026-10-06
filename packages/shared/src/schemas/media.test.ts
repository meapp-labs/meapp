import { expect, test } from 'bun:test'
import { encryptedSendSchema } from './e2e'
import {
  MEDIA_MAX_BYTES,
  decryptedContentSchema,
  mediaDescriptorSchema,
  mediaIntentSchema,
  verifyMediaIds,
} from './media'

const descriptor = () => ({
  v: 1 as const,
  id: crypto.randomUUID(),
  kind: 'image' as const,
  base: `cap/${'a'.repeat(32)}`,
  key: btoa('k'.repeat(32)),
  width: 100,
  height: 100,
  variants: [
    {
      name: 'orig' as const,
      path: 'orig.enc' as const,
      iv: btoa('i'.repeat(12)),
      size: 100,
      digest: btoa('d'.repeat(64)),
      mime: 'image/webp' as const,
    },
  ],
})

test('100 MB encrypted manifests are accepted and the exact byte boundary is enforced', () => {
  const value = {
    clientId: crypto.randomUUID(),
    roomId: crypto.randomUUID(),
    variants: [{ name: 'orig', size: MEDIA_MAX_BYTES }],
  }
  expect(MEDIA_MAX_BYTES).toBe(100 * 1024 * 1024)
  expect(mediaIntentSchema.safeParse(value).success).toBe(true)
  expect(
    mediaIntentSchema.safeParse({
      ...value,
      variants: [{ name: 'orig', size: MEDIA_MAX_BYTES + 1 }],
    }).success,
  ).toBe(false)
})

test('v1 descriptors ignore additive fields but reject unsafe paths, crypto sizes and duplicate nonces', () => {
  const value = descriptor()
  expect(mediaDescriptorSchema.parse({ ...value, future: true }).id).toBe(value.id)
  expect(mediaDescriptorSchema.safeParse({ ...value, key: 'bad-key' }).success).toBe(false)
  expect(
    mediaDescriptorSchema.safeParse({
      ...value,
      variants: [{ ...value.variants[0], path: '../orig.enc' }],
    }).success,
  ).toBe(false)
  expect(
    mediaDescriptorSchema.safeParse({
      ...value,
      variants: [{ ...value.variants[0], enc: 'unknown' }],
    }).success,
  ).toBe(false)
  expect(
    mediaDescriptorSchema.safeParse({
      ...value,
      variants: [...value.variants, { ...value.variants[0], name: 'thumb', path: 'thumb.enc' }],
    }).success,
  ).toBe(false)
})

test('media content and plaintext attachment IDs form the same unique set', () => {
  const value = mediaDescriptorSchema.parse(descriptor())
  expect(() => verifyMediaIds([value.id], [value])).not.toThrow()
  expect(() => verifyMediaIds([value.id, crypto.randomUUID()], [value, value])).toThrow()
  expect(() => verifyMediaIds([], [value])).toThrow()
  expect(() => verifyMediaIds([value.id], [])).toThrow()
  expect(decryptedContentSchema.safeParse({ text: '', media: [] }).success).toBe(false)
  expect(decryptedContentSchema.safeParse({ text: 12, media: [value] }).success).toBe(false)
  expect(decryptedContentSchema.safeParse({ text: 'a'.repeat(2001), media: [value] }).success).toBe(
    false,
  )
  expect(decryptedContentSchema.safeParse({ media: [value] }).success).toBe(true)
})

test('upload manifests reject plaintext metadata, excessive sizes and duplicate variants', () => {
  const value = {
    roomId: crypto.randomUUID(),
    clientId: crypto.randomUUID(),
    variants: [{ name: 'orig', size: 100 }],
  }
  expect(mediaIntentSchema.safeParse(value).success).toBe(true)
  expect(mediaIntentSchema.safeParse({ ...value, mime: 'image/webp' }).success).toBe(false)
  expect(
    mediaIntentSchema.safeParse({
      ...value,
      variants: [
        { name: 'orig', size: MEDIA_MAX_BYTES },
        { name: 'thumb', size: 100 },
      ],
    }).success,
  ).toBe(false)
  expect(
    mediaIntentSchema.safeParse({ ...value, variants: [value.variants[0], value.variants[0]] })
      .success,
  ).toBe(false)
  expect(
    encryptedSendSchema.safeParse({
      conversationId: value.roomId,
      attachmentIds: [crypto.randomUUID()],
      installId: crypto.randomUUID(),
      envelopes: [],
    }).success,
  ).toBe(false)
})

test('general files and audio/video descriptors preserve typed metadata without image dimensions', () => {
  for (const [kind, mime] of [
    ['file', 'application/zip'],
    ['file', 'application/octet-stream'],
    ['file', 'text/html'],
    ['video', 'video/mp4'],
    ['audio', 'audio/mpeg'],
  ]) {
    const value = {
      ...descriptor(),
      kind,
      fileName: 'attachment',
      width: undefined,
      height: undefined,
      variants: [{ ...descriptor().variants[0], mime }],
    }
    expect(mediaDescriptorSchema.safeParse(value).success).toBe(true)
    expect(
      mediaDescriptorSchema.safeParse({
        ...value,
        variants: [{ ...value.variants[0], mime: 'invalid\r\nmime' }],
      }).success,
    ).toBe(false)
  }
  expect(mediaDescriptorSchema.safeParse({ ...descriptor(), width: undefined }).success).toBe(false)
  expect(mediaDescriptorSchema.safeParse({ ...descriptor(), kind: 'video' }).success).toBe(false)
})
