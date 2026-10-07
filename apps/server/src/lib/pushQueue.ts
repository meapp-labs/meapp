import { getDbInstance } from '@meapp/db'
import { pushTokenSchema } from '@meapp/shared'
import { logger } from './logger.ts'
import type { ExpoPushNotificationOptions } from './notification.ts'

type Ticket = { status: 'ok' | 'error'; id?: string; details?: { error?: string } }
type Receipt = { token: string; createdAt: number; checkAt: number }
const ENDPOINT = 'https://exp.host/--/api/v2/push/'

export function createPushQueue(deps: {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  invalidateToken: (token: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}) {
  const now = deps.now ?? Date.now
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const queue: ExpoPushNotificationOptions[] = []
  const receipts = new Map<string, Receipt>()
  let flushing: Promise<void> | null = null
  let checking: Promise<void> | null = null
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let receiptTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function request(path: string, body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await deps.fetch(`${ENDPOINT}${path}`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        })
        if (response.ok) return await response.json()
        if (response.status !== 429 && response.status < 500)
          throw new Error(`Expo rejected request (${response.status})`)
        if (attempt === 2) throw new Error(`Expo unavailable (${response.status})`)
      } catch (err) {
        if (attempt === 2 || (err instanceof Error && err.message.startsWith('Expo rejected')))
          throw err
      }
      await sleep(1000 * 2 ** attempt)
    }
    throw new Error('Expo request exhausted retries')
  }

  function inspect(ticket: Ticket, token: string) {
    if (ticket.status === 'error') {
      if (ticket.details?.error === 'DeviceNotRegistered') deps.invalidateToken(token)
      logger.warn('push.rejected', { code: ticket.details?.error ?? 'Unknown' })
    }
  }

  function scheduleReceipts() {
    if (!stopped && !receiptTimer && receipts.size) {
      receiptTimer = setTimeout(() => {
        receiptTimer = undefined
        void checkReceipts().finally(scheduleReceipts)
      }, 60_000)
      receiptTimer.unref?.()
    }
  }

  async function receiptPass() {
    const due: [string, Receipt][] = []
    for (const [id, receipt] of receipts) {
      if (now() - receipt.createdAt >= 24 * 60 * 60_000) {
        receipts.delete(id)
        logger.warn('push.receipt_expired', { ticketId: id })
      } else if (receipt.checkAt <= now()) due.push([id, receipt])
    }
    for (let start = 0; start < due.length; start += 1000) {
      const batch = due.slice(start, start + 1000)
      try {
        const result = (await request('getReceipts', { ids: batch.map(([id]) => id) })) as {
          data?: Record<string, Ticket>
        }
        if (!result.data) throw new Error('Invalid Expo receipt response')
        for (const [id, receipt] of batch) {
          const ticket = result.data[id]
          if (ticket) {
            inspect(ticket, receipt.token)
            receipts.delete(id)
          } else receipt.checkAt = now() + 60_000
        }
      } catch (err) {
        logger.error('push.receipts_failed', { err, count: batch.length })
        for (const [, receipt] of batch) receipt.checkAt = now() + 60_000
      }
    }
  }

  function checkReceipts(): Promise<void> {
    checking ??= receiptPass().finally(() => {
      checking = null
    })
    return checking
  }

  async function drain() {
    while (!stopped && queue.length) {
      const batch = queue.splice(0, 100)
      const batchId = crypto.randomUUID()
      try {
        const result = (await request(
          'send',
          batch.map((options) => ({
            to: options.expoPushToken,
            title: options.senderUsername,
            body: options.messageText,
            data: {
              kind: options.kind,
              from: options.senderUsername,
              text: options.messageText,
              index: options.messageIndex,
              timestamp: options.timestamp,
              conversationId: options.conversationId,
              threadRootId: options.threadRootId,
            },
            channelId: options.channelId ?? 'messages',
          })),
        )) as { data?: Ticket[] }
        if (!Array.isArray(result.data) || result.data.length !== batch.length)
          throw new Error('Invalid Expo ticket response')
        result.data.forEach((ticket, index) => {
          const token = batch[index]?.expoPushToken
          if (!token) return
          inspect(ticket, token)
          if (ticket.status === 'ok' && ticket.id) {
            if (receipts.size >= 20_000) {
              logger.warn('push.receipt_queue_full', { batchId })
              return
            }
            receipts.set(ticket.id, { token, createdAt: now(), checkAt: now() + 15 * 60_000 })
          }
        })
        logger.info('push.batch_sent', { batchId, count: batch.length })
        scheduleReceipts()
      } catch (err) {
        logger.error('push.batch_failed', { batchId, count: batch.length, err })
      }
      // Single worker, at most 400 notifications/sec; retries wait longer.
      await sleep(250)
    }
  }

  function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    flushing ??= drain().finally(() => {
      flushing = null
      if (queue.length) scheduleFlush()
    })
    return flushing
  }

  function scheduleFlush() {
    if (!stopped && !flushTimer && !flushing) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        void flush()
      }, 0)
      flushTimer.unref?.()
    }
  }

  return {
    enqueue(options: ExpoPushNotificationOptions) {
      if (stopped) return
      if (!pushTokenSchema.safeParse({ token: options.expoPushToken }).success) {
        deps.invalidateToken(options.expoPushToken)
        return
      }
      if (queue.length >= 10_000) {
        logger.warn('push.queue_full', { conversationId: options.conversationId })
        return
      }
      queue.push(options)
      scheduleFlush()
    },
    flush,
    checkReceipts,
    stop() {
      stopped = true
      queue.length = 0
      receipts.clear()
      if (flushTimer) clearTimeout(flushTimer)
      if (receiptTimer) clearTimeout(receiptTimer)
    },
  }
}

export const pushQueue = createPushQueue({
  fetch: (...args) => fetch(...args),
  // Match the rejected token so a newly registered replacement is never cleared.
  invalidateToken: (token) => {
    getDbInstance().sqlite.query('UPDATE users SET push_token=NULL WHERE push_token=?').run(token)
  },
})
