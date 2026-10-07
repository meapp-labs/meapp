import { expect, mock, test } from 'bun:test'
import type { MediaDescriptor, Message } from '@meapp/shared'

const metadata = new Map<string, string>()
const frozenCiphertexts = new Map<string, Uint8Array>()
mock.module('./mediaUploadStore', () => ({
  putFrozenCiphertext: async (id: string, bytes: Uint8Array) => {
    frozenCiphertexts.set(id, new Uint8Array(bytes))
  },
  getFrozenCiphertext: async (id: string) => {
    const bytes = frozenCiphertexts.get(id)
    if (!bytes) throw new Error('Missing frozen ciphertext')
    return new Uint8Array(bytes)
  },
  deleteFrozenCiphertext: async (id: string) => {
    frozenCiphertexts.delete(id)
  },
}))
const intents = new Map<string, { id: string; base: string; committed: boolean }>()
const uploads: Uint8Array[] = []
const sent: Message[] = []
const cachedFiles: { bytes: Uint8Array; mime: string }[] = []
const gif = new Uint8Array([71, 73, 70, 56, 57, 97])
let loseUploadResponse = true
let expireIntent = false
let picks = 0
let sessionEpoch = 0
let onPick: (() => void) | null = null
let failMessageSend = false
let onMetadataWrite: ((value: string) => void) | null = null
const platform = { OS: 'web' }
class HttpError extends Error {
  constructor(readonly status: number) {
    super(String(status))
  }
}

class Key {
  constructor(readonly bytes: Uint8Array) {}
  static async generate() {
    return new Key(crypto.getRandomValues(new Uint8Array(32)))
  }
  static async import(value: string) {
    return new Key(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))
  }
  async encoded() {
    return btoa(String.fromCharCode(...this.bytes))
  }
}
class Sealed {
  constructor(readonly bytes: Uint8Array) {}
  static fromCombined(bytes: Uint8Array) {
    return new Sealed(bytes)
  }
  async combined(format?: string) {
    return format === 'base64' ? btoa(String.fromCharCode(...this.bytes)) : this.bytes
  }
  async iv() {
    return btoa(String.fromCharCode(...this.bytes.slice(0, 12)))
  }
}
mock.module('react-native', () => ({
  Platform: platform,
  Image: {
    getSize: (_uri: string, resolve: (width: number, height: number) => void) => resolve(10, 10),
  },
}))
mock.module('expo-file-system', () => ({
  File: class {},
  Paths: { cache: { uri: 'file:///cache' } },
}))
mock.module('expo-image', () => ({ Image: {} }))
mock.module('expo-image-manipulator', () => ({}))
mock.module('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => {
    picks++
    onPick?.()
    return {
      canceled: false,
      assets: [
        { uri: 'test.gif', mimeType: 'image/gif', width: 10, height: 10, file: new Blob([gif]) },
      ],
    }
  },
}))
mock.module('expo-document-picker', () => ({
  getDocumentAsync: async () => ({ canceled: true, assets: null }),
}))
mock.module('expo-crypto', () => ({
  AESEncryptionKey: Key,
  AESSealedData: Sealed,
  CryptoDigestAlgorithm: { SHA512: 'SHA-512' },
  digest: (algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
    crypto.subtle.digest(algorithm, bytes),
  aesEncryptAsync: async (plain: Uint8Array<ArrayBuffer>, key: Key) => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const imported = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(key.bytes),
      'AES-GCM',
      false,
      ['encrypt'],
    )
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, imported, plain),
    )
    const bytes = new Uint8Array(12 + cipher.length)
    bytes.set(iv)
    bytes.set(cipher, 12)
    return new Sealed(bytes)
  },
  aesDecryptAsync: async (sealed: Sealed, key: Key) => {
    const imported = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(key.bytes),
      'AES-GCM',
      false,
      ['decrypt'],
    )
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(sealed.bytes.slice(0, 12)) },
        imported,
        new Uint8Array(sealed.bytes.slice(12)),
      ),
    )
  },
}))
mock.module('@/lib/api', () => ({
  deleteFetcher: async () => ({ ok: true }),
  isApiHttpError: (error: unknown) => error instanceof HttpError,
  getFetcher: async (path: string) =>
    path.endsWith('/status') ? { available: true } : { publicUrl: 'https://media.example.test' },
  postFetcher: async (path: string, body: { clientId: string }) => {
    if (path === 'media/intent') {
      if (expireIntent && intents.has(body.clientId)) {
        expireIntent = false
        throw new HttpError(410)
      }
      let item = intents.get(body.clientId)
      if (!item) {
        item = {
          id: crypto.randomUUID(),
          base: `cap/${crypto.randomUUID().replaceAll('-', '')}`,
          committed: false,
        }
        intents.set(body.clientId, item)
      }
      return {
        attachmentId: item.id,
        base: item.base,
        uploads: item.committed
          ? []
          : [{ name: 'orig', url: `https://upload.example.test/${item.id}`, headers: {} }],
      }
    }
    if (path.endsWith('/commit')) {
      const item = intents.get(body.clientId)
      if (!item) throw new Error('Missing intent')
      item.committed = true
      return { ok: true }
    }
    throw new Error(`Unexpected request: ${path}`)
  },
}))
mock.module('./e2e', () => ({
  getE2EContext: async () => ({ storage: {} }),
  sendE2EMessage: async (
    roomId: string,
    _text: string,
    clientId: string,
    media: MediaDescriptor[],
  ) => {
    if (failMessageSend) throw new Error('Lost message response')
    const message: Message = { id: crypto.randomUUID(), roomId, clientId, media, type: 'media' }
    sent.push(message)
    return message
  },
}))
mock.module('./e2ePrivateMetadata', () => ({
  getPrivateMetadata: async (_store: unknown, key: string) => metadata.get(key) ?? null,
  setPrivateMetadata: async (_store: unknown, key: string, value: string) => {
    metadata.set(key, value)
    onMetadataWrite?.(value)
  },
  deletePrivateMetadata: async (_store: unknown, key: string) => {
    metadata.delete(key)
  },
}))
mock.module('./mediaCache', () => ({
  removeCachedAttachment: async () => {},
  cacheMedia: async (_name: string, bytes: Uint8Array, mime: string) => {
    cachedFiles.push({ bytes, mime })
    return 'blob:verified'
  },
  getCachedMedia: async () => null,
  mediaCacheEpoch: () => sessionEpoch,
}))

const {
  pickAndSendMedia,
  sendMediaAssets,
  sendVoiceRecording,
  resumeMediaUploads,
  loadMedia,
  retryMediaUpload,
  discardMediaUpload,
} = await import('./media')
const { mediaTransferSnapshot, pauseMediaTransfer, clearMediaTransfers, uploadMediaBytes } =
  await import('./mediaTransfers')

test('native PUT sends an ArrayBuffer view through XHR without constructing a binary Blob', async () => {
  const previousXHR = globalThis.XMLHttpRequest
  const previousBlob = globalThis.Blob
  let uploaded: ArrayBuffer | null = null
  class FakeXHR {
    timeout = 0
    status = 201
    upload = { onprogress: null as ((event: { loaded: number }) => void) | null }
    onload: (() => void) | null = null
    open() {}
    setRequestHeader() {}
    send(body: ArrayBuffer) {
      uploaded = body
      this.upload.onprogress?.({ loaded: body.byteLength })
      this.onload?.()
    }
  }
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
  globalThis.Blob = class {
    constructor() {
      throw new Error('Native Blob cannot accept binary views')
    }
  } as unknown as typeof Blob
  platform.OS = 'android'
  try {
    const values: number[] = []
    const source = new Uint8Array([0, 1, 2, 3, 4])
    await uploadMediaBytes(
      'https://upload.example.test',
      {},
      source.subarray(1, 4),
      new AbortController().signal,
      (n) => values.push(n),
    )
    expect(uploaded).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(uploaded as unknown as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
    expect(values.at(-1)).toBe(3)
  } finally {
    platform.OS = 'web'
    globalThis.XMLHttpRequest = previousXHR
    globalThis.Blob = previousBlob
  }
})

test('logout while saving delivery state cannot start a message send in the new session', async () => {
  const originalFetch = globalThis.fetch
  const before = sent.length
  const previousPicks = picks
  const previousIntents = new Map(intents)
  globalThis.fetch = Object.assign(async () => new Response(null, { status: 200 }), {
    preconnect: originalFetch.preconnect,
  })
  onMetadataWrite = (value) => {
    if (JSON.parse(value)[0]?.sending) sessionEpoch++
  }
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Media session ended')
    expect(sent.length).toBe(before)
  } finally {
    onMetadataWrite = null
    globalThis.fetch = originalFetch
    picks = previousPicks
    intents.clear()
    for (const [id, intent] of previousIntents) intents.set(id, intent)
    metadata.clear()
    frozenCiphertexts.clear()
    clearMediaTransfers()
  }
})

test('lost upload response resumes frozen bytes, then verifies receiver integrity', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).startsWith('https://upload.example.test')) {
        expect(metadata.size).toBe(1)
        const bytes = new Uint8Array(await (options?.body as Blob).arrayBuffer())
        uploads.push(bytes)
        if (loseUploadResponse) {
          loseUploadResponse = false
          throw new Error('Lost response')
        }
        return new Response(null, { status: 412 })
      }
      return new Response(new Uint8Array(uploads[0] ?? []))
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Lost response')
    expect(sent).toHaveLength(0)
    const resumed = await resumeMediaUploads()
    expect(resumed).toHaveLength(1)
    expect(uploads[1]).toEqual(uploads[0])
    expect(intents.size).toBe(1)
    expect(metadata.size).toBe(0)
    expect(picks).toBe(1)
    const descriptor = sent[0]?.media?.[0]
    if (!descriptor) throw new Error('Missing descriptor')
    expect(await loadMedia(descriptor)).toBe('blob:verified')
    const corrupt = new Uint8Array(uploads[0] ?? [])
    corrupt[13] = (corrupt[13] ?? 0) ^ 1
    globalThis.fetch = Object.assign(async () => new Response(corrupt), {
      preconnect: originalFetch.preconnect,
    })
    await expect(loadMedia(descriptor)).rejects.toThrow()
    expect(await resumeMediaUploads()).toHaveLength(0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('expired upload creates a fresh intent, key, nonce and ciphertext', async () => {
  const originalFetch = globalThis.fetch
  const attempted: Uint8Array[] = []
  let failed = false
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, options?: RequestInit) => {
      attempted.push(new Uint8Array(await (options?.body as Blob).arrayBuffer()))
      if (!failed) {
        failed = true
        throw new Error('Offline')
      }
      return new Response(null, { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Offline')
    const previousIds = [...intents.keys()]
    expireIntent = true
    expect(await resumeMediaUploads()).toHaveLength(1)
    expect(intents.size).toBe(previousIds.length + 1)
    expect(attempted[1]).not.toEqual(attempted[0])
    expect(metadata.size).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('logout during media selection cancels the send before persisting another account job', async () => {
  const before = sent.length
  onPick = () => {
    sessionEpoch++
  }
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Media session ended')
    expect(metadata.size).toBe(0)
    expect(sent).toHaveLength(before)
  } finally {
    onPick = null
  }
})

test('logout during upload keeps the frozen job but stops commit and message send', async () => {
  const originalFetch = globalThis.fetch
  const before = sent.length
  globalThis.fetch = Object.assign(
    async () => {
      sessionEpoch++
      return new Response(null, { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Media session ended')
    expect(metadata.size).toBe(1)
    expect(sent).toHaveLength(before)
    const lastIntent = [...intents.values()].at(-1)
    expect(lastIntent?.committed).toBe(false)
  } finally {
    globalThis.fetch = originalFetch
    metadata.clear()
  }
})

test('dropped media resumes frozen jobs and still sends the new drop without opening the picker', async () => {
  const originalFetch = globalThis.fetch
  const before = sent.length
  const picksBefore = picks
  const assets = [
    {
      uri: 'drop.gif',
      mimeType: 'image/gif',
      width: 10,
      height: 10,
      file: new File([gif], 'drop.gif', { type: 'image/gif' }),
    },
  ]
  let fail = true
  globalThis.fetch = Object.assign(
    async () => {
      if (fail) {
        fail = false
        throw new Error('Offline')
      }
      return new Response(null, { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    const room = crypto.randomUUID()
    await expect(sendMediaAssets(room, assets)).rejects.toThrow('Offline')
    expect(metadata.size).toBe(1)
    const message = await sendMediaAssets(room, assets)
    expect(sent.length - before).toBe(2)
    expect(message?.media?.[0]?.kind).toBe('gif')
    expect(sent[before]?.clientId).not.toBe(message?.clientId)
    expect(picks).toBe(picksBefore)
    expect(metadata.size).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    metadata.clear()
  }
})

test('pause preserves the frozen job, automatic retries skip it, and explicit resume sends once', async () => {
  clearMediaTransfers()
  const originalFetch = globalThis.fetch
  const before = sent.length
  let first = true
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, options?: RequestInit) => {
      if (first) {
        first = false
        const id = mediaTransferSnapshot().find((item) => item.phase === 'uploading')?.id
        if (!id) throw new Error('Missing transfer')
        pauseMediaTransfer(id)
        options?.signal?.throwIfAborted()
      }
      return new Response(null, { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow()
    const job = JSON.parse([...metadata.values()][0] ?? '[]')[0] as {
      clientId: string
      paused: boolean
    }
    expect(job.paused).toBe(true)
    const frozen = [...metadata.values()][0]
    expect(await resumeMediaUploads()).toHaveLength(0)
    expect([...metadata.values()][0]).toBe(frozen)
    expect(await retryMediaUpload(job.clientId)).toHaveLength(1)
    expect(sent.length - before).toBe(1)
    expect(metadata.size).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    metadata.clear()
    clearMediaTransfers()
  }
})

test('discard removes a paused upload and voice limits reject oversized or overlong recordings', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = Object.assign(
    async () => {
      throw new Error('Offline')
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Offline')
    const job = JSON.parse([...metadata.values()][0] ?? '[]')[0] as { clientId: string }
    await discardMediaUpload(job.clientId)
    expect(metadata.size).toBe(0)
    const asset = {
      uri: 'unused',
      file: new File([gif], 'voice.webm', { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      duration: 300001,
      width: 0,
      height: 0,
    }
    await expect(sendVoiceRecording(crypto.randomUUID(), asset)).rejects.toThrow('5 minutes')
    await expect(
      sendVoiceRecording(crypto.randomUUID(), {
        ...asset,
        duration: 1000,
        file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'voice.webm', {
          type: 'audio/webm',
        }),
      }),
    ).rejects.toThrow('10 MiB')
  } finally {
    globalThis.fetch = originalFetch
    metadata.clear()
    clearMediaTransfers()
  }
})

test('delivery confirmation jobs cannot be discarded and retry without changing the client ID', async () => {
  const originalFetch = globalThis.fetch
  clearMediaTransfers()
  globalThis.fetch = Object.assign(async () => new Response(null, { status: 200 }), {
    preconnect: originalFetch.preconnect,
  })
  try {
    failMessageSend = true
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Lost message response')
    const job = JSON.parse([...metadata.values()][0] ?? '[]')[0] as {
      clientId: string
      sending: boolean
    }
    expect(job.sending).toBe(true)
    expect(
      mediaTransferSnapshot().find((transfer) => transfer.id === job.clientId)?.canDiscard,
    ).toBe(false)
    await expect(discardMediaUpload(job.clientId)).rejects.toThrow('Delivery may have completed')
    // Confirmation only needs the saved descriptor and idempotency key.
    frozenCiphertexts.clear()
    failMessageSend = false
    const resumed = await resumeMediaUploads()
    expect(resumed[0]?.clientId).toBe(job.clientId)
    expect(metadata.size).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    failMessageSend = false
    metadata.clear()
    clearMediaTransfers()
  }
})

test('new frozen manifests contain binary references and legacy base64 jobs still resume unchanged', async () => {
  const originalFetch = globalThis.fetch
  let failed = false
  const writes: Uint8Array[] = []
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, options?: RequestInit) => {
      writes.push(new Uint8Array(await (options?.body as Blob).arrayBuffer()))
      if (!failed) {
        failed = true
        throw new Error('Offline')
      }
      return new Response(null, { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    await expect(pickAndSendMedia(crypto.randomUUID())).rejects.toThrow('Offline')
    const raw = [...metadata.values()][0] ?? '[]'
    expect(raw.length).toBeLessThan(4096)
    const jobs = JSON.parse(raw) as {
      attachments: { variants: { blobId?: string; bytes?: string; size?: number }[] }[]
    }[]
    const variant = jobs[0]?.attachments[0]?.variants[0]
    if (!variant?.blobId) throw new Error('Missing binary reference')
    expect(variant.bytes).toBeUndefined()
    variant.bytes = btoa(String.fromCharCode(...(frozenCiphertexts.get(variant.blobId) ?? [])))
    const { blobId: _blobId, size: _size, ...legacy } = variant
    const attachment = jobs[0]?.attachments[0]
    if (!attachment) throw new Error('Missing frozen attachment')
    attachment.variants[0] = legacy
    metadata.set('meapp:media:uploads:v1', JSON.stringify(jobs))
    expect(await resumeMediaUploads()).toHaveLength(1)
    expect(writes[1]).toEqual(writes[0])
  } finally {
    globalThis.fetch = originalFetch
    metadata.clear()
    clearMediaTransfers()
  }
})

test('MP4, MP3, ZIP and arbitrary files round-trip original bytes with encrypted filenames', async () => {
  const originalFetch = globalThis.fetch
  const stored = new Map<string, Uint8Array>()
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input)
      if (options?.method === 'PUT') {
        stored.set(
          url.split('/').at(-1) as string,
          new Uint8Array(await (options.body as Blob).arrayBuffer()),
        )
        return new Response(null, { status: 200 })
      }
      const intent = [...intents.values()].find((item) => url.includes(item.base))
      return new Response(new Uint8Array(stored.get(intent?.id ?? '') ?? []))
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch
  const large = new Uint8Array(12 * 1024 * 1024).fill(7)
  const files = [
    new File([large], 'movie.mp4', { type: 'video/mp4' }),
    new File([gif], 'music.mp3', { type: 'audio/mpeg' }),
    new File([gif], 'backup.zip', { type: 'application/zip' }),
    new File([gif], 'page.html', { type: 'text/html' }),
  ]
  try {
    const message = await sendMediaAssets(
      crypto.randomUUID(),
      files.map((file) => ({
        uri: 'unused',
        width: 0,
        height: 0,
        file,
        fileName: file.name,
        mimeType: file.type,
      })),
    )
    expect(message?.media?.map((media) => media.kind)).toEqual(['video', 'audio', 'file', 'file'])
    for (const [index, descriptor] of (message?.media ?? []).entries()) {
      expect(descriptor.fileName).toBe(files[index]?.name)
      expect(descriptor.width).toBeUndefined()
      expect(descriptor.variants).toHaveLength(1)
      expect(descriptor.variants[0]?.size).toBe((files[index]?.size ?? 0) + 28)
      expect(await loadMedia(descriptor)).toBe('blob:verified')
      expect(cachedFiles.at(-1)?.bytes).toEqual(index === 0 ? large : gif)
      expect(cachedFiles.at(-1)?.mime).toBe(
        index < 2 ? files[index]?.type : 'application/octet-stream',
      )
    }
    expect(metadata.size).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    metadata.clear()
  }
})
