import { getFetcher, isApiHttpError, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import type { MediaDescriptor, Message } from '@meapp/shared'
import { MEDIA_MAX_BYTES, MEDIA_TRANSFER_TIMEOUT_MS, mediaDescriptorSchema } from '@meapp/shared'
import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  aesDecryptAsync,
  aesEncryptAsync,
  digest,
} from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Image } from 'expo-image'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { Image as NativeImage, Platform } from 'react-native'
import {
  attachmentCacheName,
  droppedMediaTypes,
  optimizedImageMime,
  safeAttachmentName,
} from './droppedMedia'
import { getE2EContext, sendE2EMessage } from './e2e'
import { deletePrivateMetadata, getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { cacheMedia, getCachedMedia, mediaCacheEpoch } from './mediaCache'
import { readMediaResponse } from './mediaResponse'

type PreparedVariant = {
  name: 'orig' | 'thumb'
  path: 'orig.enc' | 'thumb.enc'
  bytes: Uint8Array
  plain: Uint8Array
  iv: string
  digest: string
  mime: string
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  return btoa(binary)
}
async function readUri(uri: string, asset?: ImagePicker.ImagePickerAsset) {
  if (Platform.OS === 'web' && asset?.file) return new Uint8Array(await asset.file.arrayBuffer())
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer())
  const file = new File(uri)
  if (file.size > MEDIA_MAX_BYTES - 28)
    throw new Error('File exceeds the 100 MB encrypted upload limit')
  return file.bytes()
}

async function prepareVariant(
  name: 'orig' | 'thumb',
  plain: Uint8Array,
  mime: string,
  key: AESEncryptionKey,
): Promise<PreparedVariant> {
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA512, new Uint8Array(plain)))
  const sealed = await aesEncryptAsync(plain, key)
  return {
    name,
    path: `${name}.enc`,
    plain,
    bytes: await sealed.combined(),
    iv: await sealed.iv('base64'),
    digest: bytesToBase64(hash),
    mime,
  }
}

async function prepareAttachment(asset: ImagePicker.ImagePickerAsset) {
  const mime = droppedMediaTypes([
    {
      name: asset.fileName ?? '',
      type: asset.mimeType ?? '',
      size: asset.file?.size ?? asset.fileSize ?? 1,
    },
  ])[0] as string
  const isGif = mime === 'image/gif'
  const key = await AESEncryptionKey.generate(256)
  const variants: PreparedVariant[] = []
  let width = asset.width
  let height = asset.height
  let blurhash: string | undefined
  const image = optimizedImageMime(mime)
  if (image && (!width || !height)) {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) =>
      NativeImage.getSize(asset.uri, (width, height) => resolve({ width, height }), reject),
    )
    width = dimensions.width
    height = dimensions.height
  }
  if (!image) {
    const plain = await readUri(asset.uri, asset)
    if (!plain.length || plain.length + 28 > MEDIA_MAX_BYTES)
      throw new Error('File must fit the 100 MB encrypted upload limit')
    variants.push(await prepareVariant('orig', plain, mime, key))
  } else if (isGif) {
    variants.push(await prepareVariant('orig', await readUri(asset.uri, asset), 'image/gif', key))
  } else {
    const scale = Math.min(1, 2048 / Math.max(width, height))
    const resized = await ImageManipulator.manipulateAsync(
      asset.uri,
      scale < 1 ? [{ resize: { width: Math.round(width * scale) } }] : [],
      { format: ImageManipulator.SaveFormat.WEBP, compress: 0.8 },
    )
    width = resized.width
    height = resized.height
    const thumb = await ImageManipulator.manipulateAsync(
      resized.uri,
      [{ resize: { width: Math.max(1, Math.round((160 * width) / Math.max(width, height))) } }],
      { format: ImageManipulator.SaveFormat.WEBP, compress: 0.65 },
    )
    if (Platform.OS !== 'web')
      blurhash =
        (await Image.generateBlurhashAsync(thumb.uri, [4, 3]).catch(() => null)) ?? undefined
    variants.push(await prepareVariant('orig', await readUri(resized.uri), 'image/webp', key))
    variants.push(await prepareVariant('thumb', await readUri(thumb.uri), 'image/webp', key))
  }
  const total = variants.reduce((sum, variant) => sum + variant.bytes.length, 0)
  if (total > MEDIA_MAX_BYTES)
    throw new Error('Attachment exceeds the 100 MB encrypted upload limit')
  return {
    clientId: uuid(),
    key: await key.encoded('base64'),
    kind: image
      ? isGif
        ? ('gif' as const)
        : ('image' as const)
      : mime.startsWith('video/')
        ? ('video' as const)
        : mime.startsWith('audio/')
          ? ('audio' as const)
          : ('file' as const),
    ...(image ? { width, height } : {}),
    ...(asset.fileName ? { fileName: safeAttachmentName(asset.fileName) } : {}),
    ...(blurhash ? { blurhash } : {}),
    variants: variants.map(({ name, path, bytes, iv, digest, mime }) => ({
      name,
      path,
      bytes: bytesToBase64(bytes),
      iv,
      digest,
      mime,
    })),
  }
}

type PreparedAttachment = Awaited<ReturnType<typeof prepareAttachment>>
type UploadJob = {
  roomId: string
  clientId: string
  attachments: PreparedAttachment[]
}
const UPLOADS_KEY = 'meapp:media:uploads:v1'
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
let uploadQueue = Promise.resolve()

function requireMediaSession(epoch: number) {
  if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
}

async function uploadJob(job: UploadJob, epoch: number) {
  requireMediaSession(epoch)
  const media: MediaDescriptor[] = []
  for (const attachment of job.attachments) {
    const intent = await postFetcher<{
      attachmentId: string
      base: string
      uploads: { name: string; url: string; headers: Record<string, string> }[]
    }>('media/intent', {
      clientId: attachment.clientId,
      roomId: job.roomId,
      variants: attachment.variants.map(({ name, bytes }) => ({
        name,
        size: fromBase64(bytes).length,
      })),
    })
    requireMediaSession(epoch)
    for (const upload of intent.uploads) {
      const variant = attachment.variants.find((item) => item.name === upload.name)
      if (!variant) throw new Error('Unexpected media upload variant')
      const response = await fetch(upload.url, {
        method: 'PUT',
        headers: upload.headers,
        body: new Blob([new Uint8Array(fromBase64(variant.bytes))]),
        signal: AbortSignal.timeout(MEDIA_TRANSFER_TIMEOUT_MS),
      })
      requireMediaSession(epoch)
      if (!response.ok && response.status !== 412)
        throw new Error(`Media upload failed (${response.status})`)
    }
    await postFetcher(`media/${intent.attachmentId}/commit`, { clientId: attachment.clientId })
    requireMediaSession(epoch)
    media.push(
      mediaDescriptorSchema.parse({
        v: 1,
        id: intent.attachmentId,
        base: intent.base,
        key: attachment.key,
        kind: attachment.kind,
        ...(attachment.width ? { width: attachment.width, height: attachment.height } : {}),
        ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
        ...(attachment.blurhash ? { blurhash: attachment.blurhash } : {}),
        variants: attachment.variants.map(({ bytes, ...variant }) => ({
          ...variant,
          size: fromBase64(bytes).length,
        })),
      }),
    )
  }
  requireMediaSession(epoch)
  return sendE2EMessage(job.roomId, '', job.clientId, media)
}

async function renewJob(job: UploadJob) {
  job.clientId = uuid()
  for (const attachment of job.attachments) {
    const oldKey = await AESEncryptionKey.import(attachment.key, 'base64')
    const key = await AESEncryptionKey.generate(256)
    for (const variant of attachment.variants) {
      const plain = await aesDecryptAsync(
        AESSealedData.fromCombined(fromBase64(variant.bytes)),
        oldKey,
      )
      const sealed = await aesEncryptAsync(plain, key)
      variant.bytes = await sealed.combined('base64')
      variant.iv = await sealed.iv('base64')
    }
    attachment.clientId = uuid()
    attachment.key = await key.encoded('base64')
  }
}

async function withUploadQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = uploadQueue
  let release = () => {}
  uploadQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function drainUploads(epoch: number) {
  requireMediaSession(epoch)
  const { storage } = await getE2EContext()
  requireMediaSession(epoch)
  const raw = await getPrivateMetadata(storage, UPLOADS_KEY)
  const jobs: UploadJob[] = raw ? JSON.parse(raw) : []
  const sent = []
  for (const job of [...jobs]) {
    let message: Message
    try {
      message = await uploadJob(job, epoch)
    } catch (error) {
      if (!isApiHttpError(error) || error.status !== 410) throw error
      await renewJob(job)
      requireMediaSession(epoch)
      await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(jobs))
      message = await uploadJob(job, epoch)
    }
    requireMediaSession(epoch)
    sent.push(message)
    jobs.splice(jobs.indexOf(job), 1)
    if (jobs.length) await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(jobs))
    else await deletePrivateMetadata(storage, UPLOADS_KEY)
  }
  return sent
}

export function resumeMediaUploads() {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(() => drainUploads(epoch))
}

export function pickAndSendMedia(conversationId: string) {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(async () => {
    // Retry a frozen job before allowing a new selection for the same room.
    const recovered = await drainUploads(epoch)
    const previous = recovered.find((message) => message.roomId === conversationId)
    if (previous) return previous
    await publicOrigin()
    requireMediaSession(epoch)
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    })
    requireMediaSession(epoch)
    if (picked.canceled || picked.assets.length === 0) return null
    return persistAndSendAssets(conversationId, picked.assets.slice(0, 4), epoch)
  })
}

async function persistAndSendAssets(
  conversationId: string,
  assets: ImagePicker.ImagePickerAsset[],
  epoch: number,
) {
  requireMediaSession(epoch)
  const attachments: PreparedAttachment[] = []
  for (const asset of assets) {
    attachments.push(await prepareAttachment(asset))
    requireMediaSession(epoch)
  }
  const { storage } = await getE2EContext()
  requireMediaSession(epoch)
  const job: UploadJob = { roomId: conversationId, clientId: uuid(), attachments }
  // Persist keys, nonces, and exact encrypted bytes before the first network write.
  await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify([job]))
  return (await drainUploads(epoch))[0] ?? null
}

export function sendMediaAssets(conversationId: string, assets: ImagePicker.ImagePickerAsset[]) {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(async () => {
    if (assets.length < 1 || assets.length > 4)
      throw new Error('Send between 1 and 4 files at once')
    // A new drop must still be sent after older frozen jobs finish.
    await drainUploads(epoch)
    await publicOrigin()
    requireMediaSession(epoch)
    return persistAndSendAssets(conversationId, assets, epoch)
  })
}

export async function pickAndSendFiles(conversationId: string) {
  const epoch = mediaCacheEpoch()
  // Open synchronously from the click before awaiting network work (web user activation).
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: true,
    base64: false,
  })
  requireMediaSession(epoch)
  if (result.canceled) return null
  const types = droppedMediaTypes(
    result.assets.map((asset) => ({
      name: asset.name,
      type: asset.mimeType ?? '',
      size: asset.size ?? asset.file?.size ?? 1,
    })),
  )
  const assets = result.assets.map(
    (asset, index): ImagePicker.ImagePickerAsset => ({
      uri: asset.uri,
      width: 0,
      height: 0,
      fileName: asset.name,
      mimeType: types[index] as string,
      ...(asset.file ? { file: asset.file } : {}),
      ...(asset.size !== undefined ? { fileSize: asset.size } : {}),
    }),
  )
  return sendMediaAssets(conversationId, assets)
}

let publicOriginPromise: Promise<string> | null = null
function publicOrigin() {
  publicOriginPromise ??= getFetcher<{ publicUrl: string }>('media/config')
    .then(({ publicUrl }) => publicUrl)
    .catch((error: unknown) => {
      publicOriginPromise = null
      throw error
    })
  return publicOriginPromise
}

const downloads = new Map<string, Promise<string>>()
export function loadMedia(
  descriptor: MediaDescriptor,
  preferred: 'orig' | 'thumb' = 'orig',
): Promise<string> {
  const key = `${mediaCacheEpoch()}:${descriptor.id}:${preferred}:${descriptor.variants.find((variant) => variant.name === preferred)?.digest}`
  const existing = downloads.get(key)
  if (existing) return existing
  const download = loadMediaOnce(descriptor, preferred).finally(() => {
    downloads.delete(key)
  })
  downloads.set(key, download)
  return download
}
async function loadMediaOnce(
  descriptor: MediaDescriptor,
  preferred: 'orig' | 'thumb' = 'orig',
): Promise<string> {
  const epoch = mediaCacheEpoch()
  const parsed = mediaDescriptorSchema.parse(descriptor)
  const variant = parsed.variants.find((item) => item.name === preferred)
  if (!variant) throw new Error('Media variant is missing')
  const name = attachmentCacheName(parsed.id, variant.mime, parsed.fileName, preferred === 'thumb')
  const cached = await getCachedMedia(name)
  if (cached) return cached
  const origin = await publicOrigin()
  const url = `${origin.replace(/\/$/, '')}/${parsed.base}/${variant.path}`
  const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_TRANSFER_TIMEOUT_MS) })
  if (!response.ok) throw new Error('Media download failed')
  const encrypted = await readMediaResponse(response, variant.size)
  const sealed = AESSealedData.fromCombined(encrypted)
  if ((await sealed.iv('base64')) !== variant.iv) throw new Error('Media nonce mismatch')
  const key = await AESEncryptionKey.import(parsed.key, 'base64')
  const plain = (await aesDecryptAsync(sealed, key)) as Uint8Array
  const hash = bytesToBase64(
    new Uint8Array(await digest(CryptoDigestAlgorithm.SHA512, new Uint8Array(plain))),
  )
  if (hash !== variant.digest) throw new Error('Media digest mismatch')
  return cacheMedia(
    name,
    plain,
    parsed.kind === 'file' ? 'application/octet-stream' : variant.mime,
    epoch,
  )
}
