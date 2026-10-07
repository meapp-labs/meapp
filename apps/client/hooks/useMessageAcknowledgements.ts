import { Keys } from '@/lib/keys'
import { useAuthStore } from '@/lib/stores'
import { canAcknowledgeMessage, receiptForeground } from '@/services/messageReceipts'
import { flushReceiptQueue, queueReceipt } from '@/services/receipts'
import type { Message } from '@meapp/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { AppState, Platform, type ViewToken } from 'react-native'

const foreground = () =>
  receiptForeground(
    AppState.currentState,
    Platform.OS === 'web' ? document.visibilityState : 'visible',
    Platform.OS === 'web' ? document.hasFocus() : true,
  )

export function useMessageAcknowledgements(
  conversationId: string,
  messages: Message[],
  enabled = true,
) {
  const username = useAuthStore((state) => state.username)
  const queryClient = useQueryClient()
  const queue = useMemo(
    () => ({
      conversationId,
      username,
      readDone: new Set<string>(),
      visible: [] as Message[],
      running: false,
    }),
    [conversationId, username],
  )
  const latest = useRef({ queue, username })
  latest.current = { queue, username }
  const persistRead = (current: typeof queue, message: Message) => {
    if (
      !enabled ||
      !canAcknowledgeMessage(message, current.username) ||
      current.readDone.has(message.id) ||
      message.acknowledgedRead
    )
      return
    current.readDone.add(message.id)
    void queueReceipt({ conversationId: current.conversationId, messageIds: [message.id] }).catch(
      () => current.readDone.delete(message.id),
    )
  }
  const persist = useRef(persistRead)
  persist.current = persistRead

  useEffect(() => {
    queue.visible = queue.visible.flatMap((old) => {
      const message = messages.find((item) => item.id === old.id)
      return message ? [message] : []
    })
  }, [messages, queue])
  useEffect(() => {
    const markVisible = () => {
      if (foreground()) for (const message of queue.visible) persist.current(queue, message)
    }
    const flush = async () => {
      markVisible()
      if (queue.running) return
      queue.running = true
      try {
        if (await flushReceiptQueue()) {
          void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
          void queryClient.invalidateQueries({
            queryKey: [Keys.Query.GET_MESSAGES, conversationId],
          })
        }
      } catch {
        // The encrypted queue retains private read state until the connection returns.
      } finally {
        queue.running = false
      }
    }
    const timer = setInterval(() => void flush(), 1000)
    const subscription = AppState.addEventListener('change', () => {
      markVisible()
      if (foreground()) {
        void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
        void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_MESSAGES, conversationId] })
      }
    })
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', markVisible)
      window.addEventListener('focus', markVisible)
    }
    return () => {
      clearInterval(timer)
      subscription.remove()
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', markVisible)
        window.removeEventListener('focus', markVisible)
      }
    }
  }, [conversationId, queue, queryClient])
  return useRef(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
    const current = latest.current.queue
    current.visible = viewableItems.filter((token) => token.isViewable).map((token) => token.item)
    if (foreground()) for (const message of current.visible) persist.current(current, message)
  }).current
}
