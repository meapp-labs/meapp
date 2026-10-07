import { expect, it } from 'bun:test'
import { createPushQueue } from './pushQueue.ts'

const notification = (token: string) => ({
  expoPushToken: token,
  senderUsername: 'alice',
  messageText: 'New message',
  messageIndex: 1,
  timestamp: '2026-10-07T00:00:00Z',
})

it('batches off the caller path, cleans dead tokens from tickets and delayed receipts', async () => {
  let now = 0
  const calls: { path: string; body: unknown }[] = []
  const invalidated: string[] = []
  const queue = createPushQueue({
    now: () => now,
    sleep: async () => {},
    invalidateToken: (token) => {
      invalidated.push(token)
    },
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body))
      calls.push({ path: String(url), body })
      if (String(url).endsWith('getReceipts'))
        return Response.json({
          data: { 'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } } },
        })
      return Response.json({
        data: (body as { to: string }[]).map(({ to }) =>
          to === 'ExpoPushToken[dead]'
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `ticket-${to.match(/\[(.*)\]/)?.[1]}` },
        ),
      })
    },
  })
  try {
    queue.enqueue(notification('ExpoPushToken[dead]'))
    for (let i = 1; i <= 100; i++) queue.enqueue(notification(`ExpoPushToken[${i}]`))
    expect(calls).toHaveLength(0)
    await queue.flush()
    expect(calls.map((call) => (call.body as unknown[]).length)).toEqual([100, 1])
    expect(invalidated).toEqual(['ExpoPushToken[dead]'])
    await queue.checkReceipts()
    expect(calls).toHaveLength(2)
    now = 15 * 60_000
    await queue.checkReceipts()
    expect(invalidated).toEqual(['ExpoPushToken[dead]', 'ExpoPushToken[1]'])
  } finally {
    queue.stop()
  }
})

it('retries transient failures and drains notifications added during a send', async () => {
  let calls = 0
  const waits: number[] = []
  const queue = createPushQueue({
    invalidateToken: () => {},
    sleep: async (ms) => {
      waits.push(ms)
    },
    fetch: async () => {
      calls++
      if (calls === 1) return new Response('', { status: 429 })
      if (calls === 2) queue.enqueue(notification('ExponentPushToken[second]'))
      return Response.json({ data: [{ status: 'ok' }] })
    },
  })
  try {
    queue.enqueue(notification('ExpoPushToken[first]'))
    await queue.flush()
    expect(calls).toBe(3)
    expect(waits).toEqual([1000, 250, 250])
  } finally {
    queue.stop()
  }
})

it('rejects invalid saved tokens and does not retry permanent HTTP failures', async () => {
  let calls = 0
  const invalidated: string[] = []
  const queue = createPushQueue({
    invalidateToken: (token) => {
      invalidated.push(token)
    },
    sleep: async () => {},
    fetch: async () => {
      calls++
      return new Response('', { status: 400 })
    },
  })
  try {
    queue.enqueue(notification('invalid'))
    queue.enqueue(notification('ExpoPushToken[valid]'))
    await queue.flush()
    expect(invalidated).toEqual(['invalid'])
    expect(calls).toBe(1)
  } finally {
    queue.stop()
  }
})

it('schedules notifications enqueued while an empty flush is finishing', async () => {
  let sent = 0
  const queue = createPushQueue({
    invalidateToken: () => {},
    sleep: async () => {},
    fetch: async () => {
      sent++
      return Response.json({ data: [{ status: 'ok' }] })
    },
  })
  try {
    const empty = queue.flush()
    queue.enqueue(notification('ExpoPushToken[late]'))
    await empty
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toBe(1)
  } finally {
    queue.stop()
  }
})
