import { ProtocolAddress } from '@open-e2ee/signal-protocol-sdk'
import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'
import {
  type ProvisioningKeyPair,
  connectToProvisioningSession,
  generateProvisioningQR,
  parseProvisioningQR,
  provisionDevice,
  receiveProvisioningMessage,
} from '@open-e2ee/signal-protocol-sdk/device/provisioning'
import * as ExpoCrypto from 'expo-crypto'
import { Platform } from 'react-native'

import { getFetcher, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import { decryptE2EMessage, getE2EContext, resetE2EContext } from './e2e'
import { deletePrivateMetadata, getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { createMeappRelay } from './e2eRelay'
import { getE2EStore } from './e2eStore'

const INSTALL_KEY = 'meapp:e2e:install'
const DEVICE_KEY = 'meapp:e2e:device-id'
const ACCOUNT_KEY = 'meapp:e2e:account'
const LINK_PREFIX = 'meapp://link-device'
const HISTORY_READY_KEY = 'meapp:e2e:history-ready'

export async function linkVerificationCode(
  sessionId: string,
  primaryPublicKey: string,
  newPublicKey: string,
): Promise<string> {
  const hex = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    `${sessionId}:${primaryPublicKey}:${newPublicKey}`,
  )
  return String(Number.parseInt(hex.slice(0, 8), 16) % 1_000_000).padStart(6, '0')
}

async function installation() {
  const me = await postFetcher<{ id: string; username: string }>('me', {})
  const storage = await getE2EStore(me.id)
  let installId = await storage.getMetadata(INSTALL_KEY)
  if (!installId) {
    installId = uuid()
    await storage.setMetadata(INSTALL_KEY, installId)
  }
  return { me, storage, installId }
}

function identityStore(storage: SignalProtocolLocalStore) {
  return {
    getIdentityKey: storage.getIdentityKey.bind(storage),
    storeIdentityKey: storage.storeIdentityKey.bind(storage),
    deleteIdentityKey: async (identityType: 'aci' | 'pni') => {
      const method = Reflect.get(storage, 'deleteIdentityKey')
      if (typeof method === 'function') {
        await method.call(storage, identityType)
        return
      }
      const db = Reflect.get(storage, 'db')
      if (db && typeof db.delete === 'function') {
        await db.delete('identity', `keyPair:${identityType}`)
        return
      }
      throw new Error('This browser cannot roll back a failed device link')
    },
  }
}

export async function startDeviceLink() {
  const context = await getE2EContext()
  const qr = await generateProvisioningQR(context.relay, context.userId, undefined, LINK_PREFIX)
  return qr
}

export async function listLinkedDevices() {
  const { installId } = await getE2EContext()
  return getFetcher<{
    currentDeviceId: number
    devices: Array<{
      deviceId: number
      platform: string
      createdAt: number
      lastActiveAt: number | null
      historyComplete: boolean
    }>
  }>('e2e/link/devices', { installId })
}

export async function revokeLinkedDevice(deviceId: number): Promise<void> {
  const { installId } = await getE2EContext()
  await postFetcher('e2e/link/revoke', { installId, deviceId })
}

export async function deviceLinkStatus(sessionId: string) {
  const { installId } = await installation()
  return getFetcher<{
    status: 'waiting' | 'connected' | 'ready' | 'linked_pending_ack' | 'completed'
    deviceId: number
    newDeviceEphemeralPublicKey: string | null
    expiresAt: number
    platform: string | null
  }>('e2e/link/status', { sessionId, installId })
}

export async function approveDeviceLink(
  sessionId: string,
  ephemeralKeyPair: ProvisioningKeyPair,
  newDevicePublicKey: string,
) {
  const context = await getE2EContext()
  await provisionDevice(
    context.relay,
    { username: context.username },
    sessionId,
    ephemeralKeyPair.privateKey,
    newDevicePublicKey,
    context.userId,
    { identityStore: identityStore(context.storage), identityTypes: ['aci'] },
  )
}

export async function connectDeviceLink(code: string) {
  const parsed = parseProvisioningQR(code.trim(), undefined, LINK_PREFIX)
  const { me, storage, installId } = await installation()
  if (await storage.getIdentityKey('aci'))
    throw new Error('This browser already has encryption keys. Open its linked devices instead.')
  const relay = createMeappRelay(me.id, installId)
  const deviceMetadata = {
    deviceName: Platform.OS === 'web' ? 'Web browser' : 'Android device',
    platform: Platform.OS,
    appVersion: '1',
    osVersion: Platform.OS,
  }
  const ephemeralKeyPair = await connectToProvisioningSession(
    relay,
    parsed.sessionId,
    deviceMetadata,
  )
  return { ...parsed, ephemeralKeyPair, deviceMetadata, relay, storage, me, installId }
}

export async function finishDeviceLink(
  connected: Awaited<ReturnType<typeof connectDeviceLink>>,
  onProgress?: (message: string) => void,
): Promise<{ deviceId: number; unavailable: number }> {
  const {
    sessionId,
    primaryEphemeralPublicKey,
    ephemeralKeyPair,
    relay,
    storage,
    me,
    deviceMetadata,
  } = connected
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = await relay.getProvisioningMessage(sessionId)
    if (status.status === 'ready') break
    if (status.expiresAt !== null && status.expiresAt < Date.now())
      throw new Error('Device link expired. Start a new link on the approving device.')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const result = await receiveProvisioningMessage(
    relay,
    sessionId,
    ephemeralKeyPair.privateKey,
    primaryEphemeralPublicKey,
    {
      identityStore: identityStore(storage),
      localStateStore: {
        setItemAsync: (key, value) => storage.setMetadata(key, value),
        deleteItemAsync: (key) => storage.deleteMetadata(key),
      },
      deviceMetadata,
    },
  )
  if (result.userId !== me.id) throw new Error('The approving device belongs to another account')
  await storage.setMetadata(DEVICE_KEY, String(result.deviceId))
  await storage.setMetadata(ACCOUNT_KEY, me.id)
  resetE2EContext()
  await getE2EContext()
  const unavailable = await ensureLinkedHistoryReady(onProgress)
  return { deviceId: result.deviceId, unavailable }
}

export async function ensureLinkedHistoryReady(
  onProgress?: (message: string) => void,
): Promise<number> {
  const context = await getE2EContext()
  if (context.deviceId === 1) return 0
  if ((await getPrivateMetadata(context.storage, HISTORY_READY_KEY)) === '1') return 0
  onProgress?.('Waiting for encrypted history transfer…')
  let unavailable = 0
  for (;;) {
    const status = await getFetcher<{ historyDone: boolean; historyUnavailable: number }>(
      'e2e/link/history/status',
      { installId: context.installId },
    )
    if (status.historyDone) {
      unavailable = status.historyUnavailable
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  onProgress?.('Decrypting transferred history…')
  await hydrateEncryptedHistory()
  await setPrivateMetadata(context.storage, HISTORY_READY_KEY, '1')
  return unavailable
}

type HistoryRow = {
  cursor: number
  id: string
  clientId: string
  roomId: string
  userId: string
  fromProtocolDeviceId: number
  envelopeSourceUserId: string | null
  envelopeSourceDeviceId: number | null
  ciphertext: string | null
}

/** Re-encrypts old plaintext on the approving device; the server sees only Signal ciphertext. */
export async function copyHistoryToDevice(
  targetDeviceId: number,
): Promise<{ copied: number; unavailable: number }> {
  const context = await getE2EContext()
  const address = ProtocolAddress.create(context.userId, targetDeviceId)
  let target: Awaited<ReturnType<typeof listLinkedDevices>>['devices'][number] | undefined
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    target = (await listLinkedDevices()).devices.find(
      (device) => device.deviceId === targetDeviceId,
    )
    if (!target) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (!target) throw new Error('The new device has not published encryption keys yet')
  const transferKey = `${targetDeviceId}:${target.createdAt}`
  const progressKey = `meapp:e2e:history-progress:${transferKey}`
  const pendingKey = `meapp:e2e:history-pending:${transferKey}`
  const unavailableKey = `meapp:e2e:history-unavailable:${transferKey}`
  let cursor = Number((await getPrivateMetadata(context.storage, progressKey)) ?? 0)
  let copied = 0
  let unavailable = Number((await getPrivateMetadata(context.storage, unavailableKey)) ?? 0)
  const upload = async (
    envelopes: Array<{ messageId: string; ciphertext: string }>,
    nextCursor: number,
  ) => {
    if (!envelopes.length) {
      cursor = nextCursor
      await setPrivateMetadata(context.storage, progressKey, String(cursor))
      return
    }
    await setPrivateMetadata(
      context.storage,
      pendingKey,
      JSON.stringify({ envelopes, cursor: nextCursor }),
    )
    await postFetcher('e2e/link/history', {
      installId: context.installId,
      targetDeviceId,
      envelopes,
    })
    cursor = nextCursor
    copied += envelopes.length
    await setPrivateMetadata(context.storage, progressKey, String(cursor))
    await deletePrivateMetadata(context.storage, pendingKey)
  }
  const pending = await getPrivateMetadata(context.storage, pendingKey)
  if (pending) {
    const batch = JSON.parse(pending) as {
      envelopes: Array<{ messageId: string; ciphertext: string }>
      cursor: number
    }
    await upload(batch.envelopes, batch.cursor)
  }
  for (;;) {
    const page = await getFetcher<{ messages: HistoryRow[]; hasMore: boolean }>(
      'e2e/link/history',
      {
        installId: context.installId,
        after: String(cursor),
      },
    )
    const envelopes: Array<{ messageId: string; ciphertext: string }> = []
    let pageCursor = cursor
    for (const row of page.messages) {
      pageCursor = row.cursor
      const message = await decryptE2EMessage({
        id: row.id,
        clientId: row.clientId,
        roomId: row.roomId,
        userId: row.userId,
        ciphertext: row.ciphertext ?? 'unavailable',
        fromProtocolDeviceId: row.fromProtocolDeviceId,
        envelopeSourceUserId: row.envelopeSourceUserId ?? undefined,
        envelopeSourceDeviceId: row.envelopeSourceDeviceId ?? undefined,
        type: 'text',
      }).catch(() => null)
      if (!message?.text) {
        unavailable++
        await setPrivateMetadata(context.storage, unavailableKey, String(unavailable))
        continue
      }
      if (!(await context.client.hasSession(address))) {
        let bundle = null
        for (let attempt = 0; attempt < 60 && !bundle; attempt++) {
          bundle = await context.relay.fetchPreKeyBundle(context.userId, targetDeviceId)
          if (!bundle) await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        if (!bundle) throw new Error('The new device has not published encryption keys yet')
        await context.client.establishSession(address, bundle)
      }
      const ciphertext = await context.client.encryptMessage(
        address,
        JSON.stringify({
          conversationId: row.roomId,
          clientId: row.clientId,
          senderId: row.userId,
          text: message.text,
        }),
      )
      envelopes.push({ messageId: row.id, ciphertext })
      if (envelopes.length === 25) {
        await upload([...envelopes], pageCursor)
        envelopes.length = 0
      }
    }
    await upload(envelopes, pageCursor)
    if (!page.hasMore) {
      await postFetcher('e2e/link/history/done', {
        targetDeviceId,
        installId: context.installId,
        unavailable,
      })
      return { copied, unavailable }
    }
  }
}

/** Process transferred envelopes in global send order before opening paginated chats. */
async function hydrateEncryptedHistory(): Promise<void> {
  const context = await getE2EContext()
  let cursor = 0
  for (;;) {
    const page = await getFetcher<{ messages: HistoryRow[]; hasMore: boolean }>(
      'e2e/link/history',
      { installId: context.installId, after: String(cursor) },
    )
    for (const row of page.messages) {
      cursor = row.cursor
      if (!row.ciphertext) continue
      await decryptE2EMessage({
        id: row.id,
        clientId: row.clientId,
        roomId: row.roomId,
        userId: row.userId,
        ciphertext: row.ciphertext,
        fromProtocolDeviceId: row.fromProtocolDeviceId,
        envelopeSourceUserId: row.envelopeSourceUserId ?? undefined,
        envelopeSourceDeviceId: row.envelopeSourceDeviceId ?? undefined,
        type: 'text',
      })
    }
    if (!page.hasMore) return
  }
}
