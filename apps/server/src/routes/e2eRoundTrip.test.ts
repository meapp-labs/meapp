import { afterAll, beforeAll, expect, it } from 'bun:test'
import { eq, getDbInstance, runMigrations, schema } from '@meapp/db'
import { ProtocolAddress, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk'
import {
  connectToProvisioningSession,
  generateProvisioningQR,
  provisionDevice,
  receiveProvisioningMessage,
} from '@open-e2ee/signal-protocol-sdk/device/provisioning'
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory'
import type { SignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay'

import { app } from '../index.ts'
import { resetInMemoryRateLimits } from '../plugins/rateLimit.ts'

type Relay = SignalProtocolRelayServer
const suffix = crypto.randomUUID().slice(-8)
const aliceName = `crypto_alice_${suffix}`
const bobName = `crypto_bob_${suffix}`
const charlieName = `crypto_charlie_${suffix}`
const password = 'secret123'
const testIp = '198.51.100.7'
const previousFlag = process.env.E2E_ENABLED

beforeAll(() => {
  process.env.E2E_ENABLED = 'true'
  runMigrations()
  resetInMemoryRateLimits()
})

afterAll(async () => {
  process.env.E2E_ENABLED = previousFlag
  const aliceId = getDbInstance()
    .sqlite.query('SELECT id FROM users WHERE username = ?')
    .get(aliceName) as { id: string } | null
  if (aliceId) {
    getDbInstance().sqlite.query('DELETE FROM rooms WHERE created_by = ?').run(aliceId.id)
  }
  await getDbInstance().db.delete(schema.users).where(eq(schema.users.username, aliceName))
  await getDbInstance().db.delete(schema.users).where(eq(schema.users.username, bobName))
  await getDbInstance().db.delete(schema.users).where(eq(schema.users.username, charlieName))
})

async function api<T>(path: string, cookie: string, body?: unknown): Promise<T> {
  const response = await app.handle(
    new Request(`http://localhost/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

async function account(username: string) {
  const created = await app.handle(
    new Request('http://localhost/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
      body: JSON.stringify({ username, password, confirmPassword: password, platform: 'web' }),
    }),
  )
  expect(created.status).toBe(201)
  const login = await app.handle(
    new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
      body: JSON.stringify({ username, password, platform: 'web' }),
    }),
  )
  expect(login.status).toBe(200)
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  const me = await api<{ id: string }>('me', cookie, {})
  return { id: me.id, cookie, username, installId: Bun.randomUUIDv7() }
}

type Account = Awaited<ReturnType<typeof account>>

function relayFor(current: Account): Relay {
  const localDeviceId = 'deviceId' in current ? (current.deviceId as number) : 1
  const own = (userId: string, deviceId = 1) => {
    if (userId !== current.id || deviceId !== localDeviceId)
      throw new Error('Invalid relay ownership')
  }
  const inventory = () =>
    api<Awaited<ReturnType<Relay['getPreKeyInventory']>>>(
      `e2e/relay/inventory?installId=${current.installId}`,
      current.cookie,
    )
  const relay: Partial<Relay> = {
    getPreKeyInventory: async (userId, deviceId) => {
      own(userId, deviceId)
      return inventory()
    },
    getPreKeyCount: async (userId, deviceId, type) => {
      own(userId, deviceId)
      const counts = await inventory()
      return type === 'ec' ? counts.ecOneTimePreKeyCount : counts.kemOneTimePreKeyCount
    },
    getEcSignedPreKeyMetadata: async (userId, deviceId) => {
      own(userId, deviceId)
      return (await inventory()).ecSignedPreKey
    },
    getKemLastResortPreKeyMetadata: async (userId, deviceId) => {
      own(userId, deviceId)
      return (await inventory()).kemLastResortPreKey
    },
    provisionIdentityKey: async (request) => {
      own(request.userId, request.deviceId)
      await api('e2e/relay/identity', current.cookie, {
        installId: current.installId,
        identity: request.identity,
        registrationId: request.registrationId,
      })
    },
    uploadPreKeys: async (userId, deviceId, keys) => {
      own(userId, deviceId)
      await api('e2e/relay/prekeys', current.cookie, { installId: current.installId, keys })
    },
    publishPlannedPreKeys: async (userId, deviceId, plan) => {
      own(userId, deviceId)
      const keys = await plan(await inventory())
      if (keys.length)
        await api('e2e/relay/prekeys', current.cookie, { installId: current.installId, keys })
    },
    getIdentityKey: async (userId) =>
      api<Awaited<ReturnType<Relay['getIdentityKey']>>>(
        `e2e/relay/identity?userId=${userId}`,
        current.cookie,
      ),
    getDevices: async (userId) =>
      api<Awaited<ReturnType<Relay['getDevices']>>>(
        `e2e/relay/devices?userId=${userId}`,
        current.cookie,
      ),
    fetchPreKeyBundle: async (userId, deviceId) =>
      api<Awaited<ReturnType<Relay['fetchPreKeyBundle']>>>('e2e/relay/bundle', current.cookie, {
        userId,
        deviceId,
      }),
    createProvisioningSession: async (_userId, ephemeralPublicKey) =>
      api<{ sessionId: string }>('e2e/link/start', current.cookie, {
        installId: current.installId,
        ephemeralPublicKey,
      }),
    connectNewDevice: async (sessionId, ephemeralPublicKey) => {
      await api('e2e/link/connect', current.cookie, {
        sessionId,
        installId: current.installId,
        ephemeralPublicKey,
        platform: 'web',
      })
    },
    sendProvisioningMessage: async (sessionId, encryptedMessage) => {
      await api('e2e/link/send', current.cookie, {
        sessionId,
        installId: current.installId,
        encryptedMessage,
      })
    },
    getProvisioningMessage: async (sessionId) => {
      const state = await api<{
        status: 'waiting' | 'connected' | 'ready' | 'linked_pending_ack' | 'completed'
        encryptedMessage: string | null
        expiresAt: number
      }>(`e2e/link/status?sessionId=${sessionId}&installId=${current.installId}`, current.cookie)
      return { status: state.status, message: state.encryptedMessage, expiresAt: state.expiresAt }
    },
    completeProvisioning: async (sessionId) =>
      api<{ deviceId: number }>('e2e/link/complete', current.cookie, {
        sessionId,
        installId: current.installId,
      }),
    acknowledgeProvisioning: async (sessionId) => {
      await api('e2e/link/ack', current.cookie, { sessionId, installId: current.installId })
    },
    rollbackProvisioning: async (sessionId) => {
      await api('e2e/link/cancel', current.cookie, { sessionId, installId: current.installId })
    },
  }
  return relay as Relay
}

it('encrypts DMs and groups for every recipient, and stores no plaintext', async () => {
  const alice = await account(aliceName)
  const bob = await account(bobName)
  const room = await api<{ id: string }>('conversations', alice.cookie, {
    type: 'dm',
    participants: [bobName],
  })

  const unsafeSend = await app.handle(
    new Request('http://localhost/api/send-message', {
      method: 'POST',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: room.id,
        clientId: crypto.randomUUID(),
        text: 'unsafe',
      }),
    }),
  )
  expect(unsafeSend.status).toBe(400)
  expect(
    getDbInstance()
      .sqlite.query('SELECT count(*) AS total FROM messages WHERE room_id = ?')
      .get(room.id) as { total: number },
  ).toEqual({ total: 0 })

  for (const accountInfo of [alice, bob]) {
    await api('e2e/relay/register', accountInfo.cookie, {
      installId: accountInfo.installId,
      platform: 'web',
    })
  }
  const aliceClient = await createSignalProtocolClient({
    identity: { userId: alice.id, deviceId: 1 },
    adapters: { storage: inMemoryStore(), relay: relayFor(alice) },
  })
  await aliceClient.syncToServer()
  const bobStorage = inMemoryStore()
  const bobClient = await createSignalProtocolClient({
    identity: { userId: bob.id, deviceId: 1 },
    adapters: { storage: bobStorage, relay: relayFor(bob) },
  })
  await bobClient.syncToServer()

  const recipient = ProtocolAddress.create(bob.id, 1)
  const bundle = await relayFor(alice).fetchPreKeyBundle(bob.id, 1)
  expect(bundle).not.toBeNull()
  if (!bundle) throw new Error('Missing Bob prekey bundle')
  await aliceClient.establishSession(recipient, bundle)
  const clientId = Bun.randomUUIDv7()
  const secretText = `private-${Bun.randomUUIDv7()}`
  const content = JSON.stringify({
    conversationId: room.id,
    clientId,
    senderId: alice.id,
    text: secretText,
  })
  const ciphertext = await aliceClient.encryptMessage(recipient, content)
  expect(ciphertext).not.toContain(secretText)
  const sent = await api<{ id: string; sequence: number }>('send-message', alice.cookie, {
    conversationId: room.id,
    clientId,
    installId: alice.installId,
    envelopes: [{ targetUserId: bob.id, targetDeviceId: 1, ciphertext }],
  })
  const history = await api<{ messages: Array<{ id: string; ciphertext: string }> }>(
    `get-messages?conversationId=${room.id}&installId=${bob.installId}`,
    bob.cookie,
  )
  const received = history.messages.find((item) => item.id === sent.id)
  expect(received?.ciphertext).toBe(ciphertext)
  const cleartext = await bobClient.decryptMessage(ProtocolAddress.create(alice.id, 1), ciphertext)
  expect(JSON.parse(cleartext).text).toBe(secretText)

  const replyText = `reply-${crypto.randomUUID()}`
  const replyCiphertext = await bobClient.encryptMessage(
    ProtocolAddress.create(alice.id, 1),
    replyText,
  )
  expect(await aliceClient.decryptMessage(ProtocolAddress.create(bob.id, 1), replyCiphertext)).toBe(
    replyText,
  )

  const dbMessage = getDbInstance()
    .sqlite.query('SELECT text, ciphertext FROM messages WHERE id = ?')
    .get(sent.id) as { text: string | null; ciphertext: string }
  expect(dbMessage.text).toBeNull()
  expect(dbMessage.ciphertext).not.toContain(secretText)
  expect(dbMessage.ciphertext).not.toBe(ciphertext)

  const linkedBob = { ...bob, installId: Bun.randomUUIDv7(), deviceId: 2 }
  const oldRelay = relayFor(bob)
  const newRelay = relayFor(linkedBob)
  const orphanInstallId = Bun.randomUUIDv7()
  getDbInstance()
    .sqlite.query(`INSERT INTO devices
    (user_id, device_id, protocol_device_id, platform, last_active_at, history_complete)
    VALUES (?, ?, 2, 'web', ?, 0)`)
    .run(bob.id, orphanInstallId, Math.floor(Date.now() / 1000) - 11 * 60)
  const qr = await generateProvisioningQR(oldRelay, bob.id)
  expect(
    getDbInstance()
      .sqlite.query('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?')
      .get(bob.id, orphanInstallId),
  ).toBeNull()
  const link = new URL(qr.qrCodeUrl)
  const linkedSession = link.searchParams.get('session')
  const primaryPublicKey = link.searchParams.get('key')
  if (!linkedSession || !primaryPublicKey) throw new Error('Provisioning link is malformed')
  const newEphemeral = await connectToProvisioningSession(newRelay, linkedSession, {
    deviceName: 'Test browser',
    platform: 'web',
    appVersion: '1',
    osVersion: 'test',
  })
  await provisionDevice(
    oldRelay,
    { username: bob.username },
    linkedSession,
    qr.ephemeralKeyPair.privateKey,
    newEphemeral.publicKey,
    bob.id,
    {
      identityStore: {
        getIdentityKey: bobStorage.getIdentityKey.bind(bobStorage),
        storeIdentityKey: bobStorage.storeIdentityKey.bind(bobStorage),
        deleteIdentityKey: async () => {},
      },
      identityTypes: ['aci'],
    },
  )
  const linkedStorage = inMemoryStore()
  const provisioned = await receiveProvisioningMessage(
    newRelay,
    linkedSession,
    newEphemeral.privateKey,
    primaryPublicKey,
    {
      identityStore: {
        getIdentityKey: linkedStorage.getIdentityKey.bind(linkedStorage),
        storeIdentityKey: linkedStorage.storeIdentityKey.bind(linkedStorage),
        deleteIdentityKey: async () => {},
      },
      deviceMetadata: {
        deviceName: 'Test browser',
        platform: 'web',
        appVersion: '1',
        osVersion: 'test',
      },
    },
  )
  expect(provisioned.deviceId).toBe(2)
  const linkedClient = await createSignalProtocolClient({
    identity: { userId: bob.id, deviceId: 2 },
    adapters: { storage: linkedStorage, relay: newRelay },
  })
  await linkedClient.syncToServer()

  const linkedAddress = ProtocolAddress.create(bob.id, 2)
  const linkedBundle = await oldRelay.fetchPreKeyBundle(bob.id, 2)
  expect(linkedBundle).not.toBeNull()
  if (!linkedBundle) throw new Error('New device did not publish prekeys')
  await bobClient.establishSession(linkedAddress, linkedBundle)
  const historyCiphertext = await bobClient.encryptMessage(linkedAddress, content)
  await api('e2e/link/history', bob.cookie, {
    installId: bob.installId,
    targetDeviceId: 2,
    envelopes: [{ messageId: sent.id, ciphertext: historyCiphertext }],
  })
  await api('e2e/link/history/done', bob.cookie, {
    targetDeviceId: 2,
    installId: bob.installId,
    unavailable: 0,
  })
  const completedLink = await api<{ historyDone: boolean; historyUnavailable: number }>(
    `e2e/link/history/status?installId=${linkedBob.installId}`,
    linkedBob.cookie,
  )
  expect(completedLink.historyDone).toBe(true)
  expect(completedLink.historyUnavailable).toBe(0)
  const linkedHistory = await api<{
    messages: Array<{
      id: string
      ciphertext: string
      envelopeSourceUserId: string
      envelopeSourceDeviceId: number
    }>
  }>(`get-messages?conversationId=${room.id}&installId=${linkedBob.installId}`, linkedBob.cookie)
  const copied = linkedHistory.messages.find((item) => item.id === sent.id)
  expect(copied?.envelopeSourceUserId).toBe(bob.id)
  expect(copied?.envelopeSourceDeviceId).toBe(1)
  expect(copied?.ciphertext).toBe(historyCiphertext)
  const copiedPlaintext = await linkedClient.decryptMessage(
    ProtocolAddress.create(bob.id, 1),
    historyCiphertext,
  )
  expect(JSON.parse(copiedPlaintext).text).toBe(secretText)

  const recipients = await api<Array<{ userId: string; deviceId: number }>>(
    `e2e/relay/recipients?conversationId=${room.id}&installId=${alice.installId}`,
    alice.cookie,
  )
  expect(recipients).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: bob.id, deviceId: 1 }),
      expect.objectContaining({ userId: bob.id, deviceId: 2 }),
    ]),
  )

  const charlie = await account(charlieName)
  await api('e2e/relay/register', charlie.cookie, {
    installId: charlie.installId,
    platform: 'web',
  })
  const charlieClient = await createSignalProtocolClient({
    identity: { userId: charlie.id, deviceId: 1 },
    adapters: { storage: inMemoryStore(), relay: relayFor(charlie) },
  })
  await charlieClient.syncToServer()
  const group = await api<{ id: string }>('conversations', alice.cookie, {
    type: 'group',
    participants: [bobName, charlieName],
    name: 'Encrypted group',
  })
  const groupClientId = Bun.randomUUIDv7()
  const groupSecret = `group-private-${crypto.randomUUID()}`
  const groupContent = JSON.stringify({
    conversationId: group.id,
    clientId: groupClientId,
    senderId: alice.id,
    text: groupSecret,
  })
  const envelopes: Array<{ targetUserId: string; targetDeviceId: number; ciphertext: string }> = []
  for (const recipientAccount of [bob, linkedBob, charlie]) {
    const recipientDeviceId = 'deviceId' in recipientAccount ? Number(recipientAccount.deviceId) : 1
    const address = ProtocolAddress.create(recipientAccount.id, recipientDeviceId)
    if (!(await aliceClient.hasSession(address))) {
      const keyBundle = await relayFor(alice).fetchPreKeyBundle(
        recipientAccount.id,
        recipientDeviceId,
      )
      expect(keyBundle).not.toBeNull()
      if (!keyBundle) throw new Error('Missing group member prekey bundle')
      await aliceClient.establishSession(address, keyBundle)
    }
    envelopes.push({
      targetUserId: recipientAccount.id,
      targetDeviceId: recipientDeviceId,
      ciphertext: await aliceClient.encryptMessage(address, groupContent),
    })
  }
  const groupSent = await api<{ id: string }>('send-message', alice.cookie, {
    conversationId: group.id,
    clientId: groupClientId,
    installId: alice.installId,
    envelopes,
  })
  for (const [accountInfo, recipientClient] of [
    [bob, bobClient],
    [linkedBob, linkedClient],
    [charlie, charlieClient],
  ] as const) {
    const page = await api<{ messages: Array<{ id: string; ciphertext: string }> }>(
      `get-messages?conversationId=${group.id}&installId=${accountInfo.installId}`,
      accountInfo.cookie,
    )
    const envelope = page.messages.find((item) => item.id === groupSent.id)
    expect(envelope).toBeDefined()
    if (!envelope) throw new Error('Missing recipient envelope')
    const clear = await recipientClient.decryptMessage(
      ProtocolAddress.create(alice.id, 1),
      envelope.ciphertext as typeof ciphertext,
    )
    expect(JSON.parse(clear).text).toBe(groupSecret)
  }
  const storedGroup = getDbInstance()
    .sqlite.query('SELECT text FROM messages WHERE id = ?')
    .get(groupSent.id) as { text: string | null }
  expect(storedGroup.text).toBeNull()

  const linkedReplyId = Bun.randomUUIDv7()
  const linkedReplyText = `from-linked-${crypto.randomUUID()}`
  const linkedReply = JSON.stringify({
    conversationId: room.id,
    clientId: linkedReplyId,
    senderId: bob.id,
    text: linkedReplyText,
  })
  const replyEnvelopes = []
  for (const recipientInfo of [
    { userId: alice.id, deviceId: 1 },
    { userId: bob.id, deviceId: 1 },
  ]) {
    const address = ProtocolAddress.create(recipientInfo.userId, recipientInfo.deviceId)
    if (!(await linkedClient.hasSession(address))) {
      const bundle = await newRelay.fetchPreKeyBundle(recipientInfo.userId, recipientInfo.deviceId)
      if (!bundle) throw new Error('Missing linked reply bundle')
      await linkedClient.establishSession(address, bundle)
    }
    replyEnvelopes.push({
      targetUserId: recipientInfo.userId,
      targetDeviceId: recipientInfo.deviceId,
      ciphertext: await linkedClient.encryptMessage(address, linkedReply),
    })
  }
  const linkedSent = await api<{ id: string }>('send-message', linkedBob.cookie, {
    conversationId: room.id,
    clientId: linkedReplyId,
    installId: linkedBob.installId,
    envelopes: replyEnvelopes,
  })
  const oldBobPage = await api<{
    messages: Array<{ id: string; ciphertext: string; fromProtocolDeviceId: number }>
  }>(`get-messages?conversationId=${room.id}&installId=${bob.installId}`, bob.cookie)
  const oldBobEnvelope = oldBobPage.messages.find((message) => message.id === linkedSent.id)
  expect(oldBobEnvelope?.fromProtocolDeviceId).toBe(2)
  if (!oldBobEnvelope) throw new Error('Old browser did not receive linked-device send')
  const oldBobPlaintext = await bobClient.decryptMessage(
    ProtocolAddress.create(bob.id, 2),
    oldBobEnvelope.ciphertext as typeof ciphertext,
  )
  expect(JSON.parse(oldBobPlaintext).text).toBe(linkedReplyText)

  await api('e2e/link/revoke', bob.cookie, { installId: bob.installId, deviceId: 2 })
  const revokedRead = await app.handle(
    new Request(
      `http://localhost/api/get-messages?conversationId=${room.id}&installId=${linkedBob.installId}`,
      { headers: { cookie: linkedBob.cookie } },
    ),
  )
  expect(revokedRead.status).toBe(401)
  expect(
    (
      getDbInstance()
        .sqlite.query(
          'SELECT count(*) AS total FROM message_envelopes WHERE target_user_id = ? AND target_device_id = 2',
        )
        .get(bob.id) as { total: number }
    ).total,
  ).toBe(0)
}, 120_000)
