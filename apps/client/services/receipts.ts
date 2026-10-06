import { isApiHttpError, postFetcher } from '@/lib/api'
import { Keys } from '@/lib/keys'
import { queryClient } from '@/lib/queryInit'
import { useAuthStore } from '@/lib/stores'
import type { MessagesResponse } from '@meapp/shared'
import { getE2EContext } from './e2e'
import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { type ReceiptJob, createReceiptOutbox } from './receiptOutbox'

const OUTBOX_KEY = 'meapp:receipts:outbox:v1'
let activeOutbox: {
  userId: string
  installId: string
  storage: Awaited<ReturnType<typeof getE2EContext>>['storage']
  outbox: ReturnType<typeof createReceiptOutbox>
} | null = null
async function receiptOutbox() {
  const context = await getE2EContext()
  if (
    activeOutbox?.userId === context.userId &&
    activeOutbox.installId === context.installId &&
    activeOutbox.storage === context.storage
  )
    return activeOutbox.outbox
  const entry = {
    userId: context.userId,
    installId: context.installId,
    storage: context.storage,
    outbox: createReceiptOutbox({
      load: () => getPrivateMetadata(context.storage, OUTBOX_KEY),
      save: (value) => setPrivateMetadata(context.storage, OUTBOX_KEY, value),
      active: (): boolean =>
        activeOutbox === entry && useAuthStore.getState().username === context.username,
      send: async (job) => {
        await postFetcher(
          'read',
          { ...job, installId: context.installId },
          { signal: AbortSignal.timeout(10000) },
        )
        if (activeOutbox === entry && useAuthStore.getState().username === context.username) {
          void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
          void queryClient.invalidateQueries({
            queryKey: [Keys.Query.GET_MESSAGES, job.conversationId],
          })
        }
      },
      permanentFailure: (error) =>
        isApiHttpError(error) && [400, 403, 404, 410].includes(error.status),
    }),
  }
  activeOutbox = entry
  return entry.outbox
}
export async function queueReceipt(job: ReceiptJob) {
  const username = useAuthStore.getState().username
  await (await receiptOutbox()).enqueue(job)
  if (useAuthStore.getState().username !== username) return
  const readIds = new Set(job.messageIds)
  queryClient.setQueryData<{ pages: MessagesResponse[]; pageParams: unknown[] }>(
    [Keys.Query.GET_MESSAGES, job.conversationId],
    (old) => {
      if (!old) return old
      const pages = old.pages.map((page) => ({
        ...page,
        messages: page.messages.map((m) =>
          readIds.has(m.id) ? { ...m, acknowledgedRead: true } : m,
        ),
      }))
      const openingBoundary = old.pages[0]?.firstUnreadSequence
      const boundaryRead = old.pages.some((page) =>
        page.messages.some((m) => m.sequence === openingBoundary && readIds.has(m.id)),
      )
      if (boundaryRead && pages[0]) {
        const unread = pages
          .flatMap((page) => page.messages)
          .filter((m) => m.from !== username && m.sequence !== undefined && !m.acknowledgedRead)
        pages[0].firstUnreadSequence = unread.length
          ? Math.min(...unread.map((m) => m.sequence as number))
          : null
      }
      return { ...old, pages }
    },
  )
}
export async function flushReceiptQueue() {
  return (await receiptOutbox()).flush()
}
