// Disposable peer for actual browser encryption/attachment checks. Run separately;
// these platform/API shims must never affect the normal client test process.
import { mock } from 'bun:test'
import type { Message, MessagesResponse } from '@meapp/shared'
import {
  type Ciphertext,
  ProtocolAddress,
  createSignalProtocolClient,
} from '@open-e2ee/signal-protocol-sdk'
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory'

const login = await fetch('http://127.0.0.1:18080/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'emil2', password: 'Validation2026Local' }),
})
if (!login.ok) throw new Error('Start the isolated validation server first')
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
async function api<T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
  const url = new URL(`http://127.0.0.1:18080/api/${path}`)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json() as Promise<T>
}
mock.module('react-native', () => ({ Platform: { OS: 'web' } }))
mock.module('@/lib/api', () => ({
  getFetcher: <T>(path: string, params?: Record<string, unknown>) =>
    api<T>(path, undefined, params),
  postFetcher: api,
}))
const { createMeappRelay } = await import('./e2eRelay')
const me = await api<{ id: string }>('me')
const installId = crypto.randomUUID()
const relay = createMeappRelay(me.id, installId)
await relay.registerDevice(me.id, { deviceId: 1, deviceType: 'web' })
const client = await createSignalProtocolClient({
  identity: { userId: me.id, deviceId: 1 },
  adapters: { storage: inMemoryStore(), relay },
})
await client.syncToServer()
const room = await api<{ id: string }>('conversations', { type: 'dm', participants: ['emil1'] })
const seen = new Map<string, { text?: string; media?: unknown[] }>()
async function receive() {
  const page = await api<MessagesResponse>('get-messages', undefined, {
    conversationId: room.id,
    installId,
    limit: 100,
  })
  for (const message of page.messages) {
    if (!message.ciphertext || seen.has(message.id) || message.from === 'emil2') continue
    const address = ProtocolAddress.create(
      message.userId as string,
      message.fromProtocolDeviceId ?? 1,
    )
    const text = await client.decryptMessage(address, message.ciphertext as Ciphertext)
    seen.set(message.id, JSON.parse(text))
  }
  return [...seen.values()].map((content) => ({
    text: content.text,
    attachments: content.media?.length ?? 0,
  }))
}
async function send() {
  const clientId = crypto.randomUUID()
  const recipients = await api<Array<{ userId: string; deviceId: number }>>(
    'e2e/relay/recipients',
    undefined,
    { conversationId: room.id, installId },
  )
  const text = JSON.stringify({
    conversationId: room.id,
    clientId,
    senderId: me.id,
    text: 'Live validation from the encrypted peer',
  })
  const envelopes = []
  for (const target of recipients) {
    const address = ProtocolAddress.create(target.userId, target.deviceId)
    if (!(await client.hasSession(address))) {
      const bundle = await relay.fetchPreKeyBundle(target.userId, target.deviceId)
      if (!bundle) throw new Error('Missing peer keys')
      await client.establishSession(address, bundle)
    }
    envelopes.push({
      targetUserId: target.userId,
      targetDeviceId: target.deviceId,
      ciphertext: await client.encryptMessage(address, text),
    })
  }
  const message = await api<Message>('send-message', {
    conversationId: room.id,
    clientId,
    installId,
    envelopes,
  })
  return { sent: message.id }
}
Bun.serve({
  hostname: '127.0.0.1',
  port: 18084,
  async fetch(request) {
    try {
      const path = new URL(request.url).pathname
      if (path === '/receive' && request.method === 'GET') return Response.json(await receive())
      if (path === '/send' && request.method === 'POST') return Response.json(await send())
      return new Response('Not found', { status: 404 })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Peer error' },
        { status: 500 },
      )
    }
  },
})
console.log('Disposable encrypted peer ready on 127.0.0.1:18084')
