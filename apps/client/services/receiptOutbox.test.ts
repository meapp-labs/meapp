import { expect, test } from 'bun:test'
import { type ReceiptJob, createReceiptOutbox } from './receiptOutbox'

const room = crypto.randomUUID()
const first = crypto.randomUUID()
const second = crypto.randomUUID()
const job = (ids = [first]): ReceiptJob => ({
  conversationId: room,
  messageIds: ids,
})

test('private read state survives recreation and offline retries', async () => {
  let stored: string | null = null
  let online = false
  const sent: ReceiptJob[] = []
  const adapter = {
    load: async () => stored,
    save: async (value: string) => {
      stored = value
    },
    active: () => true,
    permanentFailure: () => false,
    send: async (value: ReceiptJob) => {
      sent.push(value)
      if (!online) throw new Error('Offline')
    },
  }
  const original = createReceiptOutbox(adapter)
  await original.enqueue(job())
  await expect(original.flush()).rejects.toThrow('Offline')
  online = true
  const restored = createReceiptOutbox(adapter)
  await restored.flush()
  expect(sent).toEqual([job(), job()])
  expect(String(stored)).toBe('[]')
})

test('persisting new receipts during a slow send cannot lose them or block storage writes', async () => {
  let stored: string | null = null
  let release = () => {}
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = () => {}
  const sending = new Promise<void>((resolve) => {
    started = resolve
  })
  const sent: ReceiptJob[] = []
  const outbox = createReceiptOutbox({
    load: async () => stored,
    save: async (value) => {
      stored = value
    },
    active: () => true,
    permanentFailure: () => false,
    send: async (value) => {
      sent.push(value)
      if (sent.length === 1) {
        started()
        await waiting
      }
    },
  })
  await outbox.enqueue(job())
  const flushing = outbox.flush()
  await sending
  await outbox.enqueue(job([second]))
  expect(JSON.parse(stored ?? '[]')[0].messageIds).toEqual([first, second])
  release()
  await flushing
  expect(sent.map((value) => value.messageIds)).toEqual([[first], [second]])
  expect(String(stored)).toBe('[]')
})

test('account switching leaves queued jobs intact and stale targets do not block valid ones', async () => {
  let stored: string | null = null
  let active = true
  const accepted: string[] = []
  const outbox = createReceiptOutbox({
    load: async () => stored,
    save: async (value) => {
      stored = value
    },
    active: () => active,
    permanentFailure: (error) => error === 'stale',
    send: async (value) => {
      if (value.messageIds.includes(first)) throw 'stale'
      accepted.push(...value.messageIds)
    },
  })
  await outbox.enqueue(job([first, second]))
  active = false
  expect(await outbox.flush()).toBe(0)
  expect(JSON.parse(stored ?? '[]')).toHaveLength(1)
  active = true
  await outbox.flush()
  expect(accepted).toEqual([second])
  expect(String(stored)).toBe('[]')
})

test('legacy queues discard delivery jobs and strip sharing flags from read jobs', async () => {
  let stored = JSON.stringify([
    { ...job(), kind: 'delivered', shareRead: true },
    { ...job([second]), kind: 'read', shareRead: true },
  ])
  const sent: ReceiptJob[] = []
  const outbox = createReceiptOutbox({
    load: async () => stored,
    save: async (value) => {
      stored = value
    },
    active: () => true,
    permanentFailure: () => false,
    send: async (value) => {
      sent.push(value)
    },
  })
  await outbox.flush()
  expect(sent).toEqual([job([second])])
  expect(stored).toBe('[]')
})
