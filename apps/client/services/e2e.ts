import {
  ProtocolAddress,
  type SignalProtocolLocalStore,
  createSignalProtocolClient,
} from '@open-e2ee/signal-protocol-sdk'
import type { SignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay'
import { Platform } from 'react-native'

import { getFetcher, isApiHttpError, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import {
  type EncryptedSend,
  type MediaDescriptor,
  type Message,
  decryptedContentSchema,
  encryptedSendSchema,
  mediaDescriptorSchema,
  verifyMediaIds,
} from '@meapp/shared'

import { decodeContent, encodeContent } from './e2eContent'
import { deletePrivateMetadata, getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { createMeappRelay } from './e2eRelay'
import { getE2EStore } from './e2eStore'
import { scheduleRecoveryBackup } from './recovery'

type ProtocolClient = Awaited<ReturnType<typeof createSignalProtocolClient>>
type Ciphertext = Parameters<ProtocolClient['decryptMessage']>[1]
export type SafetyNumber = Awaited<ReturnType<ProtocolClient['verify']>>

type E2EContext = {
  userId: string
  username: string
  installId: string
  storage: SignalProtocolLocalStore
  relay: SignalProtocolRelayServer
  client: ProtocolClient
  deviceId: number
}

const ACCOUNT_KEY = 'meapp:e2e:account'
const INSTALL_KEY = 'meapp:e2e:install'
const DEVICE_KEY = 'meapp:e2e:device-id'
const cacheKey = (messageId: string) => `meapp:e2e:message-content:v1:${messageId}`
const legacyCacheKey = (messageId: string) => `meapp:e2e:message:${messageId}`
const pendingKey = (clientId: string) => `meapp:e2e:pending:${clientId}`
const pendingTextKey = (clientId: string) => `meapp:e2e:pending-content:v1:${clientId}`
const legacyPendingTextKey = (clientId: string) => `meapp:e2e:pending-text:${clientId}`
const quarantinedKey = (clientId: string) => `meapp:e2e:quarantined:${clientId}`
const receiptKey = (clientId: string) => `meapp:e2e:receipt:${clientId}`
const OUTBOX_KEY = 'meapp:e2e:outbox'
async function pendingContent(storage: SignalProtocolLocalStore, clientId: string) {
  const current = await getPrivateMetadata(storage, pendingTextKey(clientId))
  if (current !== null) return current
  const legacy = await getPrivateMetadata(storage, legacyPendingTextKey(clientId))
  return legacy === null ? null : encodeContent(legacy)
}

let contextPromise: Promise<E2EContext> | null = null
let sendQueue = Promise.resolve()

async function flushOutbox(context: E2EContext): Promise<Map<string, Message>> {
  const { storage } = context
  const sent = new Map<string, Message>()
  const raw = await getPrivateMetadata(storage, OUTBOX_KEY)
  let ids: unknown
  try {
    ids = raw ? JSON.parse(raw) : []
  } catch {
    ids = null
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    await setPrivateMetadata(storage, `${OUTBOX_KEY}:quarantined`, raw ?? '')
    await setPrivateMetadata(storage, OUTBOX_KEY, '[]')
    console.warn('[E2E] Quarantined invalid outbox index')
    return sent
  }
  let remaining = ids as string[]
  for (const clientId of ids as string[]) {
    const pending = await getPrivateMetadata(storage, pendingKey(clientId))
    const text = await pendingContent(storage, clientId)
    let payload: EncryptedSend | null = null
    try {
      if (!pending || text === null) throw new Error('Encrypted outbox entry is incomplete')
      payload = encryptedSendSchema.parse(JSON.parse(pending))
      if (payload.clientId !== clientId || payload.installId !== context.installId) {
        throw new Error('Encrypted outbox entry belongs to another device')
      }
    } catch (error) {
      // Keep the original ciphertext for recovery, but let later sends proceed.
      await setPrivateMetadata(storage, quarantinedKey(clientId), JSON.stringify({ pending, text }))
      remaining = remaining.filter((id) => id !== clientId)
      await setPrivateMetadata(storage, OUTBOX_KEY, JSON.stringify(remaining))
      await deletePrivateMetadata(storage, pendingKey(clientId))
      await deletePrivateMetadata(storage, pendingTextKey(clientId))
      await deletePrivateMetadata(storage, legacyPendingTextKey(clientId))
      console.warn('[E2E] Quarantined invalid outbox entry:', clientId, error)
      continue
    }
    let response: Message
    try {
      response = await postFetcher<Message>('send-message', payload)
    } catch (error) {
      if (isApiHttpError(error) && error.status === 410 && payload.attachmentIds?.length) {
        remaining = remaining.filter((id) => id !== clientId)
        await setPrivateMetadata(storage, OUTBOX_KEY, JSON.stringify(remaining))
        await deletePrivateMetadata(storage, pendingKey(clientId))
        await deletePrivateMetadata(storage, pendingTextKey(clientId))
        await deletePrivateMetadata(storage, legacyPendingTextKey(clientId))
      }
      throw error
    }
    await setPrivateMetadata(storage, cacheKey(response.id), text)
    await setPrivateMetadata(
      storage,
      receiptKey(clientId),
      JSON.stringify({ response, content: text, conversationId: payload.conversationId }),
    )
    sent.set(clientId, response)
    remaining = remaining.filter((id) => id !== clientId)
    await setPrivateMetadata(storage, OUTBOX_KEY, JSON.stringify(remaining))
    await deletePrivateMetadata(storage, pendingKey(clientId))
    await deletePrivateMetadata(storage, pendingTextKey(clientId))
    await deletePrivateMetadata(storage, legacyPendingTextKey(clientId))
  }
  return sent
}

async function openContext(): Promise<E2EContext> {
  const me = await getFetcher<{ id: string; username: string }>('me')
  const storage = await getE2EStore(me.id)
  const accountId = await storage.getMetadata(ACCOUNT_KEY)
  if (accountId && accountId !== me.id) {
    throw new Error('This installation has encryption keys for another account')
  }

  let installId = await storage.getMetadata(INSTALL_KEY)
  if (!installId) {
    installId = uuid()
    await storage.setMetadata(INSTALL_KEY, installId)
  }
  const deviceId = Number((await storage.getMetadata(DEVICE_KEY)) ?? 1)
  if (!Number.isInteger(deviceId) || deviceId < 1 || deviceId > 5)
    throw new Error('Stored encryption device ID is invalid')
  const relay = createMeappRelay(me.id, installId, deviceId)
  await relay.registerDevice(me.id, {
    deviceId,
    deviceType: Platform.OS === 'web' ? 'web' : 'mobile',
  })

  const client = await createSignalProtocolClient({
    identity: { userId: me.id, deviceId },
    adapters: { storage, relay },
  })
  // The SDK can create an offline client when initial synchronization fails.
  // Require successful key publication before sending or receiving messages.
  await client.syncToServer()
  if (!accountId) await storage.setMetadata(ACCOUNT_KEY, me.id)
  if (!(await storage.getMetadata(DEVICE_KEY)))
    await storage.setMetadata(DEVICE_KEY, String(deviceId))
  const context = {
    userId: me.id,
    username: me.username,
    installId,
    storage,
    relay,
    client,
    deviceId,
  }
  // Reuse exactly the same envelopes after a lost response or app restart.
  await flushOutbox(context).catch((error: unknown) => {
    console.warn('[E2E] Encrypted outbox retry deferred:', error)
  })
  scheduleRecoveryBackup(context)
  return context
}

export function getE2EContext(): Promise<E2EContext> {
  contextPromise ??= openContext().catch((error: unknown) => {
    contextPromise = null
    throw error
  })
  return contextPromise
}

export function resetE2EContext(): void {
  contextPromise = null
}

export async function getE2EInstallId(): Promise<string> {
  return (await getE2EContext()).installId
}

export async function sendE2EMessage(
  conversationId: string,
  text: string,
  clientId: string,
  media: MediaDescriptor[] = [],
  signal?: AbortSignal,
): Promise<Message> {
  const previous = sendQueue
  let release: () => void = () => {}
  sendQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    signal?.throwIfAborted()
    return await sendE2EMessageSerial(conversationId, text, clientId, media, signal)
  } finally {
    release()
  }
}

async function sendE2EMessageSerial(
  conversationId: string,
  text: string,
  clientId: string,
  media: MediaDescriptor[],
  signal?: AbortSignal,
): Promise<Message> {
  if ((!text.trim() && media.length === 0) || text.length > 2000 || media.length > 4)
    throw new Error('Message must contain text or up to four media attachments')
  for (const descriptor of media) mediaDescriptorSchema.parse(descriptor)
  const storedContent = encodeContent(text, media)
  const context = await getE2EContext()
  signal?.throwIfAborted()
  const { client, installId, storage, relay, userId, username } = context
  const receipt = await getPrivateMetadata(storage, receiptKey(clientId))
  if (receipt) {
    const saved = JSON.parse(receipt) as {
      response: Message
      content: string
      conversationId: string
    }
    if (saved.content !== storedContent || saved.conversationId !== conversationId)
      throw new Error('Confirmed message content or conversation has changed')
    return {
      ...saved.response,
      clientId,
      roomId: conversationId,
      userId,
      from: username,
      ...(text ? { text } : {}),
      ...(media.length ? { media } : {}),
      type: media.length ? 'media' : 'text',
    }
  }
  const previouslySent = await flushOutbox(context)
  const recovered = previouslySent.get(clientId)
  if (recovered) {
    const savedReceipt = await getPrivateMetadata(storage, receiptKey(clientId))
    const saved = savedReceipt
      ? (JSON.parse(savedReceipt) as { content: string; conversationId: string })
      : null
    if (!saved || saved.content !== storedContent || saved.conversationId !== conversationId)
      throw new Error('Recovered message content or conversation has changed')
    return {
      ...recovered,
      clientId,
      roomId: conversationId,
      userId,
      from: username,
      ...(text ? { text } : {}),
      ...(media.length ? { media, attachmentIds: media.map((item) => item.id) } : {}),
    }
  }
  if (await getPrivateMetadata(storage, quarantinedKey(clientId))) {
    throw new Error('This encrypted send could not be recovered. Please send it again.')
  }
  let pending = await getPrivateMetadata(storage, pendingKey(clientId))
  if (!pending) {
    const recipients = await getFetcher<Array<{ userId: string; deviceId: number }>>(
      'e2e/relay/recipients',
      { conversationId, installId },
    )
    const content = JSON.stringify({
      conversationId,
      clientId,
      senderId: userId,
      ...(text ? { text } : {}),
      ...(media.length ? { media } : {}),
    })
    const envelopes: EncryptedSend['envelopes'] = []
    for (const recipient of recipients) {
      const address = ProtocolAddress.create(recipient.userId, recipient.deviceId)
      if (!(await client.hasSession(address))) {
        const bundle = await relay.fetchPreKeyBundle(recipient.userId, recipient.deviceId)
        if (!bundle) throw new Error('A recipient has no usable encryption keys')
        await client.establishSession(address, bundle)
      }
      const ciphertext = await client.encryptMessage(address, content)
      if (ciphertext.length > 12 * 1024) throw new Error('Encrypted message is too large')
      envelopes.push({
        targetUserId: recipient.userId,
        targetDeviceId: recipient.deviceId,
        ciphertext,
      })
    }
    pending = JSON.stringify({
      conversationId,
      clientId,
      installId,
      ...(media.length ? { attachmentIds: media.map((item) => item.id) } : {}),
      envelopes,
    } satisfies EncryptedSend)
    // Save the exact ciphertext before sending so a retry never advances the
    // ratchet twice or submits a new body under the same idempotency key.
    await setPrivateMetadata(storage, pendingTextKey(clientId), storedContent)
    await setPrivateMetadata(storage, pendingKey(clientId), pending)
    const rawOutbox = await getPrivateMetadata(storage, OUTBOX_KEY)
    const outbox: string[] = rawOutbox ? JSON.parse(rawOutbox) : []
    if (!outbox.includes(clientId)) {
      await setPrivateMetadata(storage, OUTBOX_KEY, JSON.stringify([...outbox, clientId]))
    }
  }

  const payload = encryptedSendSchema.parse(JSON.parse(pending))
  if (payload.conversationId !== conversationId || payload.clientId !== clientId) {
    throw new Error('Pending encrypted message does not match this send')
  }
  const pendingText = await pendingContent(storage, clientId)
  if (pendingText !== storedContent)
    throw new Error('Pending encrypted message content has changed')
  const rawOutbox = await getPrivateMetadata(storage, OUTBOX_KEY)
  const outbox: string[] = rawOutbox ? JSON.parse(rawOutbox) : []
  if (!outbox.includes(clientId)) {
    await setPrivateMetadata(storage, OUTBOX_KEY, JSON.stringify([...outbox, clientId]))
  }
  const sent = (await flushOutbox(context)).get(clientId)
  if (!sent) throw new Error('Encrypted message was not confirmed by the server')
  scheduleRecoveryBackup(context)
  return {
    id: sent.id,
    clientId,
    roomId: conversationId,
    userId,
    sequence: sent.sequence,
    index: sent.index,
    from: username,
    ...(text ? { text } : {}),
    ...(media.length ? { media, attachmentIds: media.map((item) => item.id) } : {}),
    type: media.length ? 'media' : 'text',
    timestamp: sent.timestamp,
  }
}

export async function decryptE2EMessage(message: Message): Promise<Message> {
  if (!message.ciphertext) return message
  const { client, storage, userId, deviceId, installId } = await getE2EContext()
  let cached = await getPrivateMetadata(storage, cacheKey(message.id))
  if (cached === null) {
    const legacy = await getPrivateMetadata(storage, legacyCacheKey(message.id))
    if (legacy !== null) cached = encodeContent(legacy)
  }
  if (cached !== null) {
    const { ciphertext: _ciphertext, ...rest } = message
    const content = decodeContent(cached)
    verifyMediaIds(message.attachmentIds, content.media)
    return { ...rest, ...content }
  }
  if (
    message.userId === userId &&
    message.fromProtocolDeviceId === deviceId &&
    !message.envelopeSourceDeviceId
  ) {
    const pendingText = message.clientId ? await pendingContent(storage, message.clientId) : null
    if (pendingText !== null) {
      await setPrivateMetadata(storage, cacheKey(message.id), pendingText)
      scheduleRecoveryBackup({ storage, userId, installId })
      const { ciphertext: _ciphertext, ...rest } = message
      const content = decodeContent(pendingText)
      verifyMediaIds(message.attachmentIds, content.media)
      return { ...rest, ...content }
    }
    return { ...message, type: 'undecryptable' }
  }
  if (!message.userId || !message.roomId || !message.clientId) {
    throw new Error('Encrypted message is missing routing metadata')
  }
  const address = ProtocolAddress.create(
    message.envelopeSourceUserId ?? message.userId,
    message.envelopeSourceDeviceId ?? message.fromProtocolDeviceId ?? 1,
  )
  const plaintext = await client.decryptMessage(address, message.ciphertext as Ciphertext)
  const decoded: unknown = JSON.parse(plaintext)
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !('conversationId' in decoded) ||
    decoded.conversationId !== message.roomId ||
    !('clientId' in decoded) ||
    decoded.clientId !== message.clientId ||
    !('senderId' in decoded) ||
    decoded.senderId !== message.userId ||
    !decryptedContentSchema.safeParse(decoded).success
  ) {
    throw new Error('Encrypted message metadata failed verification')
  }
  const contents = decryptedContentSchema.parse(decoded)
  const media =
    contents.media === undefined ? [] : mediaDescriptorSchema.array().max(4).parse(contents.media)
  verifyMediaIds(message.attachmentIds, media)
  await setPrivateMetadata(storage, cacheKey(message.id), encodeContent(contents.text ?? '', media))
  scheduleRecoveryBackup({ storage, userId, installId })
  const { ciphertext: _ciphertext, ...rest } = message
  return {
    ...rest,
    ...(contents.text ? { text: contents.text } : {}),
    ...(media.length ? { media, type: 'media' } : {}),
  }
}

export async function getConversationSafetyNumber(conversationId: string): Promise<SafetyNumber> {
  const { client, relay, installId, userId } = await getE2EContext()
  const recipients = await getFetcher<Array<{ userId: string; deviceId: number }>>(
    'e2e/relay/recipients',
    { conversationId, installId },
  )
  const recipient = recipients.find((entry) => entry.userId !== userId)
  if (!recipient) {
    throw new Error('Open a direct conversation to compare safety numbers')
  }
  const address = ProtocolAddress.create(recipient.userId, recipient.deviceId)
  if (!(await client.hasSession(address))) {
    const bundle = await relay.fetchPreKeyBundle(recipient.userId, recipient.deviceId)
    if (!bundle) throw new Error('This contact has no encryption keys yet')
    await client.establishSession(address, bundle)
  }
  return client.verify(recipient.userId)
}

export async function confirmConversationSafetyNumber(number: SafetyNumber): Promise<void> {
  const { client } = await getE2EContext()
  await client.confirmSafetyNumber(number.confirmation)
}
