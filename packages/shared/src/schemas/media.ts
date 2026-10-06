import { z } from 'zod'

export const MEDIA_MAX_BYTES = 100 * 1024 * 1024
export const MEDIA_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000
export const MEDIA_MAX_ATTACHMENTS = 4
const size = z.number().int().min(29).max(MEDIA_MAX_BYTES)
const uniqueVariants = (variants: { name: string; size: number }[]) =>
  variants.some((variant) => variant.name === 'orig') &&
  new Set(variants.map((variant) => variant.name)).size === variants.length &&
  variants.reduce((sum, variant) => sum + variant.size, 0) <= MEDIA_MAX_BYTES

export const mediaVariantSchema = z.object({ name: z.enum(['orig', 'thumb']), size }).strict()
export const mediaIntentSchema = z
  .object({
    clientId: z.string().uuid(),
    roomId: z.string().uuid(),
    variants: z
      .array(mediaVariantSchema)
      .min(1)
      .max(2)
      .refine(
        uniqueVariants,
        'Unique variants including an original and total encrypted size of at most 100 MB are required',
      ),
  })
  .strict()
export const mediaCommitSchema = z.object({ clientId: z.string().uuid() }).strict()
export const attachmentIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(MEDIA_MAX_ATTACHMENTS)
  .refine((ids) => new Set(ids).size === ids.length, 'Attachment IDs must be unique')

const base64 = (bytes: number) =>
  z
    .string()
    .regex(
      new RegExp(
        `^[A-Za-z0-9+/]{${Math.floor(bytes / 3) * 4 + (bytes % 3 ? (bytes % 3) + 1 : 0)}}${bytes % 3 ? '='.repeat(3 - (bytes % 3)) : ''}$`,
      ),
    )
export const mediaDescriptorSchema = z
  .object({
    v: z.literal(1),
    id: z.string().uuid(),
    kind: z.enum(['image', 'gif', 'video', 'audio', 'file']),
    base: z.string().regex(/^cap\/[a-f0-9]{32}$/),
    key: base64(32),
    width: z.number().int().positive().max(65535).optional(),
    height: z.number().int().positive().max(65535).optional(),
    fileName: z.string().max(255).optional(),
    blurhash: z.string().min(6).max(166).optional(),
    durationMs: z.number().nonnegative().nullable().optional(),
    variants: z
      .array(
        z
          .object({
            name: z.enum(['orig', 'thumb']),
            path: z.enum(['orig.enc', 'thumb.enc']),
            iv: base64(12),
            size,
            digest: base64(64),
            mime: z
              .string()
              .max(127)
              .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
            enc: z.literal('aes-256-gcm-whole').optional(),
          })
          .refine(
            (variant) =>
              variant.path === `${variant.name}.enc` &&
              (variant.name !== 'thumb' || variant.mime === 'image/webp'),
          ),
      )
      .min(1)
      .max(2)
      .refine(uniqueVariants)
      .refine(
        (variants) => new Set(variants.map((v) => v.iv)).size === variants.length,
        'Each variant must use a unique nonce',
      ),
  })
  .refine((media) => {
    const original = media.variants.find((variant) => variant.name === 'orig')
    if (media.kind === 'image' || media.kind === 'gif')
      return (
        Boolean(media.width && media.height) &&
        original?.mime === (media.kind === 'gif' ? 'image/gif' : 'image/webp')
      )
    if (media.variants.length !== 1) return false
    if (media.kind === 'video') return original?.mime.startsWith('video/')
    if (media.kind === 'audio') return original?.mime.startsWith('audio/')
    return true
  }, 'Attachment kind, dimensions and MIME type must match its variants')
export type MediaDescriptor = z.infer<typeof mediaDescriptorSchema>
export const decryptedContentSchema = z
  .object({
    text: z.string().max(2000).optional(),
    media: z
      .array(mediaDescriptorSchema)
      .min(1)
      .max(MEDIA_MAX_ATTACHMENTS)
      .refine((media) => new Set(media.map((item) => item.id)).size === media.length)
      .optional(),
  })
  .refine(
    (content) => Boolean(content.text?.trim() || content.media?.length),
    'Message must contain text or media',
  )

export function verifyMediaIds(ids: string[] = [], media: MediaDescriptor[] = []) {
  if (
    new Set(ids).size !== ids.length ||
    new Set(media.map((item) => item.id)).size !== media.length ||
    media.length !== ids.length ||
    media.some((item) => !ids.includes(item.id))
  ) {
    throw new Error('Encrypted media does not match message attachments')
  }
}
