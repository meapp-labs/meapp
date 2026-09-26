import {
  ProtocolAddress,
  type SignalProtocolLocalStore,
  createSignalProtocolClient,
} from '@open-e2ee/signal-protocol-sdk'
import type { SignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay'
import { Platform } from 'react-native'

import { getFetcher, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import { type EncryptedSend, type Message, encryptedSendSchema } from '@meapp/shared'

import { deletePrivateMetadata, getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { createMeappRelay } from './e2eRelay'
import { getE2EStore } from './e2eStore'

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
const cacheKey = (messageId: string) => `meapp:e2e:message:${messageId}`
const pendingKey = (clientId: string) => `meapp:e2e:pending:${clientId}`
const pendingTextKey = (clientId: string) => `meapp:e2e:pending-text:${clientId}`
const OUTBOX_KEY = 'meapp:e2e:outbox'

let contextPromise: Promise<E2EContext> | null = null
let sendQueue = Promise.resolve()

async function flushOutbox(context: E2EContext): Promise<Map<string, Message>> {
  const { storage } = context
  const sent = new Map<string, Message>()
  const raw = await getPrivateMetadata(storage, OUTBOX_KEY)
  const ids: unknown = raw ? JSON.parse(raw) : []
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('Encrypted outbox index is invalid')
  }
  for (const clientId of ids as string[]) {
    const pending = await getPrivateMetadata(storage, pendingKey(clientId))
    const text = await getPrivateMetadata(storage, pendingTextKey(clientId))
    if (!pending || text === null) throw new Error('Encrypted outbox entry is incomplete')
    const payload = encryptedSendSchema.parse(JSON.parse(pending))
    if (payload.clientId !== clientId || payload.installId !== context.installId) {
      throw new Error('Encrypted outbox entry belongs to another device')
    }
    const response = await postFetcher<Message>('send-message', payload)
    await setPrivateMetadata(storage, cacheKey(response.id), text)
    sent.set(clientId, response)
    await setPrivateMetadata(
      storage,
      OUTBOX_KEY,
      JSON.stringify((ids as string[]).filter((id) => id !== clientId)),
    )
    await deletePrivateMetadata(storage, pendingKey(clientId))
    await deletePrivateMetadata(storage, pendingTextKey(clientId))
  }
  return sent
}

async function openContext(): Promise<E2EContext> {
  const me = await postFetcher<{ id: string; username: string }>('me', {})
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
): Promise<Message> {
  const previous = sendQueue
  let release: () => void = () => {}
  sendQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await sendE2EMessageSerial(conversationId, text, clientId)
  } finally {
    release()
  }
}

async function sendE2EMessageSerial(
  conversationId: string,
  text: string,
  clientId: string,
): Promise<Message> {
  if (!text.trim() || text.length > 2000)
    throw new Error('Message must contain 1 to 2000 characters')
  const context = await getE2EContext()
  const { client, installId, storage, relay, userId, username } = context
  const previouslySent = await flushOutbox(context)
  const recovered = previouslySent.get(clientId)
  if (recovered) {
    return { ...recovered, clientId, roomId: conversationId, userId, from: username, text }
  }
  let pending = await getPrivateMetadata(storage, pendingKey(clientId))
  if (!pending) {
    const recipients = await getFetcher<Array<{ userId: string; deviceId: number }>>(
      'e2e/relay/recipients',
      { conversationId, installId },
    )
    const content = JSON.stringify({ conversationId, clientId, senderId: userId, text })
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
      envelopes,
    } satisfies EncryptedSend)
    // Save the exact ciphertext before sending so a retry never advances the
    // ratchet twice or submits a new body under the same idempotency key.
    await setPrivateMetadata(storage, pendingTextKey(clientId), text)
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
  const pendingText = await getPrivateMetadata(storage, pendingTextKey(clientId))
  if (pendingText !== text) throw new Error('Pending encrypted message text has changed')
  const rawOutbox = await getPrivateMetadata(storage, OUTBOX_KEY)
  const outbox: string[] = rawOutbox ? JSON.parse(rawOutbox) : []
  if (!outbox.includes(clientId)) {
    await setPrivateMetadata(storage, OUTBOX_KEY, JSON.stringify([...outbox, clientId]))
  }
  const sent = (await flushOutbox(context)).get(clientId)
  if (!sent) throw new Error('Encrypted message was not confirmed by the server')
  return {
    id: sent.id,
    clientId,
    roomId: conversationId,
    userId,
    sequence: sent.sequence,
    index: sent.index,
    from: username,
    text,
    type: 'text',
    timestamp: sent.timestamp,
  }
}

export async function decryptE2EMessage(message: Message): Promise<Message> {
  if (!message.ciphertext) return message
  const { client, storage, userId, deviceId } = await getE2EContext()
  const cached = await getPrivateMetadata(storage, cacheKey(message.id))
  if (cached !== null) {
    const { ciphertext: _ciphertext, ...rest } = message
    return { ...rest, text: cached }
  }
  if (
    message.userId === userId &&
    message.fromProtocolDeviceId === deviceId &&
    !message.envelopeSourceDeviceId
  ) {
    const pendingText = message.clientId
      ? await getPrivateMetadata(storage, pendingTextKey(message.clientId))
      : null
    if (pendingText !== null) {
      await setPrivateMetadata(storage, cacheKey(message.id), pendingText)
      const { ciphertext: _ciphertext, ...rest } = message
      return { ...rest, text: pendingText }
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
    !('text' in decoded) ||
    typeof decoded.text !== 'string' ||
    decoded.text.length < 1 ||
    decoded.text.length > 2000
  ) {
    throw new Error('Encrypted message metadata failed verification')
  }
  await setPrivateMetadata(storage, cacheKey(message.id), decoded.text)
  const { ciphertext: _ciphertext, ...rest } = message
  return { ...rest, text: decoded.text }
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
