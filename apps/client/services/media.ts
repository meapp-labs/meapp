import { deleteFetcher, getFetcher, isApiHttpError, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import type { MediaDescriptor, Message } from '@meapp/shared'
import {
  MEDIA_MAX_BYTES,
  MEDIA_TRANSFER_TIMEOUT_MS,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_MS,
  mediaDescriptorSchema,
} from '@meapp/shared'
import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  aesDecryptAsync,
  aesEncryptAsync,
  digest,
} from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
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
import { cacheMedia, getCachedMedia, mediaCacheEpoch, removeCachedAttachment } from './mediaCache'
import { readMediaResponse } from './mediaResponse'
import {
  beginMediaTransfer,
  removeMediaTransfer,
  updateMediaTransfer,
  uploadMediaBytes,
} from './mediaTransfers'
import {
  deleteFrozenCiphertext,
  getFrozenCiphertext,
  putFrozenCiphertext,
} from './mediaUploadStore'

type PreparedVariant = {
  name: 'orig' | 'thumb'
  path: 'orig.enc' | 'thumb.enc'
  bytes: Uint8Array
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

function removeTemporaryMedia(uri: string) {
  if (Platform.OS === 'web') {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri)
    return
  }
  // Only toolkit-generated copies under this app's cache are eligible.
  if (!uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) return
  const file = new File(uri)
  if (file.exists) file.delete()
}

async function readPreparedUri(uri: string) {
  try {
    return await readUri(uri)
  } finally {
    removeTemporaryMedia(uri)
  }
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
    variants.push(
      await prepareVariant('orig', await readPreparedUri(resized.uri), 'image/webp', key),
    )
    variants.push(
      await prepareVariant('thumb', await readPreparedUri(thumb.uri), 'image/webp', key),
    )
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
    ...(asset.duration != null ? { durationMs: asset.duration } : {}),
    ...(blurhash ? { blurhash } : {}),
    variants: variants.map(({ name, path, bytes, iv, digest, mime }) => ({
      name,
      path,
      bytes,
      iv,
      digest,
      mime,
    })),
  }
}

type PreparedAttachment = Omit<Awaited<ReturnType<typeof prepareAttachment>>, 'variants'> & {
  variants: (Omit<Awaited<ReturnType<typeof prepareAttachment>>['variants'][number], 'bytes'> & {
    bytes?: string | undefined // Existing v1 jobs keep their frozen bytes on retry.
    blobId?: string
    size?: number
  })[]
}
type UploadJob = {
  replyTo?: string | undefined
  threadRootId?: string | undefined
  roomId: string
  clientId: string
  attachments: PreparedAttachment[]
  paused?: boolean
  sending?: boolean
  media?: MediaDescriptor[]
}
const UPLOADS_KEY = 'meapp:media:uploads:v1'
const fromBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
const variantSize = (variant: PreparedAttachment['variants'][number]) =>
  variant.size ?? decodedSize(variant.bytes ?? '')
async function frozenBytes(variant: PreparedAttachment['variants'][number]) {
  const bytes = variant.blobId
    ? await getFrozenCiphertext(variant.blobId)
    : fromBase64(variant.bytes ?? '')
  if (bytes.length !== variantSize(variant))
    throw new Error('Saved upload size mismatch. Discard it and select the file again.')
  return bytes
}
async function removeFrozenJob(job: UploadJob) {
  for (const attachment of job.attachments)
    for (const variant of attachment.variants)
      if (variant.blobId)
        await deleteFrozenCiphertext(variant.blobId).catch((error: unknown) => {
          console.warn('[Media] Ciphertext cache cleanup deferred:', error)
        })
}
let uploadQueue = Promise.resolve()

function requireMediaSession(epoch: number) {
  if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
}

async function uploadJob(job: UploadJob, epoch: number, signal: AbortSignal) {
  requireMediaSession(epoch)
  const total = job.attachments.reduce(
    (sum, item) => sum + item.variants.reduce((n, v) => n + variantSize(v), 0),
    0,
  )
  let loaded = 0
  const report = (progress: number) =>
    mediaCacheEpoch() === epoch &&
    updateMediaTransfer({
      id: job.clientId,
      roomId: job.roomId,
      phase: 'uploading',
      loaded: progress,
      total,
    })
  report(0)
  if (job.sending && job.media) {
    updateMediaTransfer({
      id: job.clientId,
      roomId: job.roomId,
      phase: 'sending',
      loaded: total,
      total,
    })
    return sendE2EMessage(
      job.roomId,
      '',
      job.clientId,
      job.media,
      job.replyTo,
      job.threadRootId,
      signal,
    )
  }
  const media: MediaDescriptor[] = []
  for (const attachment of job.attachments) {
    signal.throwIfAborted()
    const intent = await postFetcher<{
      attachmentId: string
      base: string
      uploads: { name: string; url: string; headers: Record<string, string> }[]
    }>(
      'media/intent',
      {
        clientId: attachment.clientId,
        roomId: job.roomId,
        variants: attachment.variants.map((variant) => ({
          name: variant.name,
          size: variantSize(variant),
        })),
      },
      { signal },
    )
    requireMediaSession(epoch)
    for (const upload of intent.uploads) {
      const variant = attachment.variants.find((item) => item.name === upload.name)
      if (!variant) throw new Error('Unexpected media upload variant')
      await uploadMediaBytes(upload.url, upload.headers, await frozenBytes(variant), signal, (n) =>
        report(loaded + n),
      )
      loaded += variantSize(variant)
      requireMediaSession(epoch)
    }
    signal.throwIfAborted()
    await postFetcher(
      `media/${intent.attachmentId}/commit`,
      { clientId: attachment.clientId },
      { signal },
    )
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
        ...(attachment.durationMs != null ? { durationMs: attachment.durationMs } : {}),
        ...(attachment.blurhash ? { blurhash: attachment.blurhash } : {}),
        variants: attachment.variants.map((variant) => ({
          name: variant.name,
          path: variant.path,
          iv: variant.iv,
          digest: variant.digest,
          mime: variant.mime,
          size: variantSize(variant),
        })),
      }),
    )
  }
  requireMediaSession(epoch)
  signal.throwIfAborted()
  // Once the message send starts its outcome may be ambiguous. Disable pause
  // and preserve its client ID until an idempotent retry confirms delivery.
  job.sending = true
  job.media = media
  const { storage } = await getE2EContext()
  requireMediaSession(epoch)
  await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify([job]))
  requireMediaSession(epoch)
  updateMediaTransfer({
    id: job.clientId,
    roomId: job.roomId,
    phase: 'sending',
    loaded: total,
    total,
  })
  return sendE2EMessage(job.roomId, '', job.clientId, media, job.replyTo, job.threadRootId, signal)
}

const decodedSize = (value: string) =>
  (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)

async function renewJob(job: UploadJob) {
  const previousBlobs: string[] = []
  job.clientId = uuid()
  for (const attachment of job.attachments) {
    const oldKey = await AESEncryptionKey.import(attachment.key, 'base64')
    const key = await AESEncryptionKey.generate(256)
    for (const variant of attachment.variants) {
      const plain = await aesDecryptAsync(
        AESSealedData.fromCombined(await frozenBytes(variant)),
        oldKey,
      )
      const sealed = await aesEncryptAsync(plain, key)
      const bytes = await sealed.combined()
      const blobId = uuid()
      await putFrozenCiphertext(blobId, bytes)
      if (variant.blobId) previousBlobs.push(variant.blobId)
      variant.blobId = blobId
      variant.size = bytes.length
      variant.bytes = undefined
      variant.iv = await sealed.iv('base64')
    }
    attachment.clientId = uuid()
    attachment.key = await key.encoded('base64')
  }
  return previousBlobs
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

async function drainUploads(epoch: number, recoverExpired = true) {
  requireMediaSession(epoch)
  const { storage } = await getE2EContext()
  requireMediaSession(epoch)
  const raw = await getPrivateMetadata(storage, UPLOADS_KEY)
  requireMediaSession(epoch)
  const jobs: UploadJob[] = raw ? JSON.parse(raw) : []
  const sent = []
  for (const job of [...jobs]) {
    if (job.paused) {
      updateMediaTransfer({
        id: job.clientId,
        roomId: job.roomId,
        phase: 'paused',
        loaded: 0,
        total: 0,
      })
      continue
    }
    const controller = beginMediaTransfer(job.clientId)
    let message: Message
    try {
      message = await uploadJob(job, epoch, controller.signal)
    } catch (error) {
      if (isApiHttpError(error) && error.status === 410 && !job.sending && recoverExpired) {
        removeMediaTransfer(job.clientId)
        const previousBlobs = await renewJob(job)
        requireMediaSession(epoch)
        await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(jobs))
        for (const id of previousBlobs) await deleteFrozenCiphertext(id)
        // Use a new attempt to keep error handling and persisted state identical.
        return drainUploads(epoch, false)
      }
      if (mediaCacheEpoch() !== epoch) throw error
      job.paused = controller.signal.aborted
      await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(jobs))
      updateMediaTransfer({
        id: job.clientId,
        roomId: job.roomId,
        phase: job.paused ? 'paused' : 'failed',
        loaded: 0,
        total: 0,
        error: error instanceof Error ? error.message : 'Transfer interrupted',
        canDiscard: !job.sending,
      })
      throw error
    }
    requireMediaSession(epoch)
    sent.push(message)
    removeMediaTransfer(job.clientId)
    jobs.splice(jobs.indexOf(job), 1)
    if (jobs.length) await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(jobs))
    else await deletePrivateMetadata(storage, UPLOADS_KEY)
    await removeFrozenJob(job)
  }
  return sent
}

export function resumeMediaUploads() {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(() => drainUploads(epoch))
}

export function pickAndSendMedia(conversationId: string, replyTo?: string, threadRootId?: string) {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(async () => {
    // Retry a frozen job before allowing a new selection for the same room.
    const recovered = await drainUploads(epoch)
    const previous = recovered.find((message) => message.roomId === conversationId)
    if (previous) return previous
    await publicOrigin()
    requireMediaSession(epoch)
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    })
    requireMediaSession(epoch)
    if (picked.canceled || picked.assets.length === 0) return null
    return persistAndSendAssets(
      conversationId,
      picked.assets.slice(0, 4),
      epoch,
      undefined,
      replyTo,
      threadRootId,
    )
  })
}

async function persistAndSendAssets(
  conversationId: string,
  assets: ImagePicker.ImagePickerAsset[],
  epoch: number,
  onPrepared?: () => void,
  replyTo?: string,
  threadRootId?: string,
) {
  requireMediaSession(epoch)
  const attachments: PreparedAttachment[] = []
  const createdBlobs: string[] = []
  try {
    for (const asset of assets) {
      const prepared = await prepareAttachment(asset)
      const variants: PreparedAttachment['variants'] = []
      for (const { bytes, ...variant } of prepared.variants) {
        const blobId = uuid()
        await putFrozenCiphertext(blobId, bytes)
        createdBlobs.push(blobId)
        variants.push({ ...variant, blobId, size: bytes.length })
      }
      attachments.push({ ...prepared, variants })
      requireMediaSession(epoch)
    }
  } catch (error) {
    for (const id of createdBlobs) await deleteFrozenCiphertext(id)
    throw error
  } finally {
    if (Platform.OS !== 'web') for (const asset of assets) removeTemporaryMedia(asset.uri)
  }
  const { storage } = await getE2EContext()
  requireMediaSession(epoch)
  const job: UploadJob = {
    roomId: conversationId,
    clientId: uuid(),
    attachments,
    replyTo,
    threadRootId,
  }
  if (await getPrivateMetadata(storage, UPLOADS_KEY)) {
    for (const id of createdBlobs) await deleteFrozenCiphertext(id)
    throw new Error('Resume or discard the paused attachment before sending another.')
  }
  // Persist keys, nonces, and exact encrypted bytes before the first network write.
  try {
    await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify([job]))
  } catch (error) {
    for (const id of createdBlobs) await deleteFrozenCiphertext(id)
    throw error
  }
  onPrepared?.()
  return (await drainUploads(epoch))[0] ?? null
}

export function sendMediaAssets(
  conversationId: string,
  assets: ImagePicker.ImagePickerAsset[],
  onPrepared?: () => void,
  replyTo?: string,
  threadRootId?: string,
) {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(async () => {
    if (assets.length < 1 || assets.length > 4)
      throw new Error('Send between 1 and 4 files at once')
    // A new drop must still be sent after older frozen jobs finish.
    await drainUploads(epoch)
    await publicOrigin()
    requireMediaSession(epoch)
    return persistAndSendAssets(conversationId, assets, epoch, onPrepared, replyTo, threadRootId)
  })
}

export async function sendVoiceRecording(
  conversationId: string,
  asset: ImagePicker.ImagePickerAsset,
  onPrepared?: () => void,
  replyTo?: string,
  threadRootId?: string,
) {
  const size = Platform.OS === 'web' ? (asset.file?.size ?? 0) : new File(asset.uri).size
  if (
    !size ||
    size > VOICE_MAX_BYTES ||
    !asset.mimeType?.startsWith('audio/') ||
    asset.duration == null ||
    !Number.isFinite(asset.duration) ||
    asset.duration < 0 ||
    asset.duration > VOICE_MAX_DURATION_MS
  )
    throw new Error('Voice messages must be audio, at most 5 minutes and 10 MiB.')
  return sendMediaAssets(conversationId, [asset], onPrepared, replyTo, threadRootId)
}

export async function pickAndSendFiles(
  conversationId: string,
  replyTo?: string,
  threadRootId?: string,
) {
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
  return sendMediaAssets(conversationId, assets, undefined, replyTo, threadRootId)
}

export async function captureAndSendMedia(
  conversationId: string,
  replyTo?: string,
  threadRootId?: string,
) {
  const epoch = mediaCacheEpoch()
  if (Platform.OS === 'web') {
    const file = await new Promise<globalThis.File | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.setAttribute('capture', 'environment')
      const done = (file: globalThis.File | null) => {
        input.remove()
        resolve(file)
      }
      input.onchange = () => done(input.files?.[0] ?? null)
      input.addEventListener('cancel', () => done(null), { once: true })
      input.style.display = 'none'
      document.body.append(input)
      input.click()
    })
    requireMediaSession(epoch)
    if (!file) return null
    const uri = URL.createObjectURL(file)
    try {
      return await sendMediaAssets(
        conversationId,
        [{ uri, file, fileName: file.name, mimeType: file.type, width: 0, height: 0 }],
        undefined,
        replyTo,
        threadRootId,
      )
    } finally {
      URL.revokeObjectURL(uri)
    }
  }
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  requireMediaSession(epoch)
  if (!permission.granted)
    throw new Error(
      permission.canAskAgain
        ? 'Camera permission is required to take a photo.'
        : 'Enable camera permission for MeApp in Settings.',
    )
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
  requireMediaSession(epoch)
  if (picked.canceled) return null
  return sendMediaAssets(conversationId, picked.assets, undefined, replyTo, threadRootId)
}

export function retryMediaUpload(id: string) {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(async () => {
    const { storage } = await getE2EContext()
    requireMediaSession(epoch)
    const raw = await getPrivateMetadata(storage, UPLOADS_KEY)
    const jobs: UploadJob[] = raw ? JSON.parse(raw) : []
    for (const job of jobs) if (job.clientId === id) job.paused = false
    if (jobs.length) await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(jobs))
    return drainUploads(epoch)
  })
}

export function discardMediaUpload(id: string) {
  const epoch = mediaCacheEpoch()
  return withUploadQueue(async () => {
    const { storage } = await getE2EContext()
    requireMediaSession(epoch)
    const raw = await getPrivateMetadata(storage, UPLOADS_KEY)
    const jobs: UploadJob[] = raw ? JSON.parse(raw) : []
    if (jobs.find((job) => job.clientId === id)?.sending)
      throw new Error('Delivery may have completed. Retry to confirm before discarding.')
    const remaining = jobs.filter((job) => job.clientId !== id)
    if (remaining.length) await setPrivateMetadata(storage, UPLOADS_KEY, JSON.stringify(remaining))
    else await deletePrivateMetadata(storage, UPLOADS_KEY)
    const removed = jobs.find((job) => job.clientId === id)
    if (removed) await removeFrozenJob(removed)
    removeMediaTransfer(id)
  })
}

export async function deleteMedia(id: string) {
  await deleteFetcher(`media/${id}`)
  await removeCachedAttachment(id)
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
type DownloadOptions = {
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
}
export function loadMedia(
  descriptor: MediaDescriptor,
  preferred: 'orig' | 'thumb' = 'orig',
  options?: DownloadOptions,
): Promise<string> {
  if (options) return loadMediaOnce(descriptor, preferred, options)
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
  options?: DownloadOptions,
): Promise<string> {
  options?.signal?.throwIfAborted()
  const epoch = mediaCacheEpoch()
  const parsed = mediaDescriptorSchema.parse(descriptor)
  const status = await getFetcher<{ available: boolean }>(
    `media/${parsed.id}/status`,
    undefined,
    options?.signal ? { signal: options.signal } : undefined,
  )
  requireMediaSession(epoch)
  if (!status.available) throw new Error('Attachment was deleted or expired')
  const variant = parsed.variants.find((item) => item.name === preferred)
  if (!variant) throw new Error('Media variant is missing')
  const name = attachmentCacheName(parsed.id, variant.mime, parsed.fileName, preferred === 'thumb')
  const cached = await getCachedMedia(name)
  if (cached) return cached
  const origin = await publicOrigin()
  const url = `${origin.replace(/\/$/, '')}/${parsed.base}/${variant.path}`
  const signal = options?.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(MEDIA_TRANSFER_TIMEOUT_MS)])
    : AbortSignal.timeout(MEDIA_TRANSFER_TIMEOUT_MS)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Media download failed')
  const encrypted = await readMediaResponse(response, variant.size, {
    signal,
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
  })
  const sealed = AESSealedData.fromCombined(encrypted)
  if ((await sealed.iv('base64')) !== variant.iv) throw new Error('Media nonce mismatch')
  const key = await AESEncryptionKey.import(parsed.key, 'base64')
  const plain = (await aesDecryptAsync(sealed, key)) as Uint8Array
  const hash = bytesToBase64(
    new Uint8Array(await digest(CryptoDigestAlgorithm.SHA512, new Uint8Array(plain))),
  )
  if (hash !== variant.digest) throw new Error('Media digest mismatch')
  signal.throwIfAborted()
  return cacheMedia(
    name,
    plain,
    parsed.kind === 'file' ? 'application/octet-stream' : variant.mime,
    epoch,
  )
}
