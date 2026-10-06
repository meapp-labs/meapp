import { z } from 'zod'
import { usernameSchema } from './auth.ts'

export const profileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      Array.from(value).every((char) => {
        const point = char.codePointAt(0) ?? 0
        return point >= 32 && point !== 127
      }),
    'Names cannot contain control characters',
  )
export const profileSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
  displayName: profileNameSchema,
  avatarUrl: z.string().url().nullable(),
})
export type Profile = z.infer<typeof profileSchema>
export const editProfileSchema = z.object({ displayName: profileNameSchema }).strict()
export const AVATAR_MAX_BYTES = 64 * 1024
export const avatarUploadSchema = z
  .object({
    image: z
      .string()
      .min(4)
      .max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict()
export const aliasValueSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.string().uuid(),
    contactId: z.string().uuid(),
    alias: profileNameSchema.nullable(),
  })
  .strict()
export const encryptedAliasSchema = z.object({
  revision: z.number().int().nonnegative(),
  ciphertext: z
    .string()
    .min(28)
    .max(2048)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .nullable(),
})
export const editAliasSchema = encryptedAliasSchema.strict()
export const contactAliasSchema = encryptedAliasSchema.extend({ contactId: z.string().uuid() })
export const contactAliasesSchema = z.array(contactAliasSchema)
