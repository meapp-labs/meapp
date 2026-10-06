import { AVATAR_MAX_BYTES } from '@meapp/shared'
import sharp from 'sharp'
import { ApiError, ErrorCode, createValidationError } from './errors.ts'

export async function normalizeAvatar(input: Buffer): Promise<Buffer> {
  if (input.length > AVATAR_MAX_BYTES)
    throw new ApiError(ErrorCode.PAYLOAD_TOO_LARGE, 'Avatar exceeds 64 KiB', 413)
  try {
    const image = sharp(input, { limitInputPixels: 16_777_216, failOn: 'warning' })
    const metadata = await image.metadata()
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 4096 ||
      metadata.height > 4096 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Unsupported image')
    const result = await image
      .rotate()
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 80 })
      .timeout({ seconds: 5 })
      .toBuffer()
    if (result.length > AVATAR_MAX_BYTES) throw new Error('Output too large')
    return result
  } catch {
    throw createValidationError(
      'Use a valid static JPEG, PNG, or WebP up to 4096 × 4096 pixels and 64 KiB',
    )
  }
}
