import { type MediaDescriptor, decryptedContentSchema } from '@meapp/shared'

// A dedicated versioned metadata key distinguishes structured content from
// legacy raw-text caches, so any string remains a valid user message.
export function encodeContent(text: string, media: MediaDescriptor[] = []) {
  return JSON.stringify(
    decryptedContentSchema.parse({
      ...(text ? { text } : {}),
      ...(media.length ? { media } : {}),
    }),
  )
}
export function decodeContent(value: string) {
  return decryptedContentSchema.parse(JSON.parse(value))
}
