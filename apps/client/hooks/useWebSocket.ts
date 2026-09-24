import { useEffect, useRef } from 'react'

export type UseWebSocketOptions = {
  onMessage: (data: unknown) => void
  onOpen?: (send: (data: string) => void) => void
  enabled: boolean
}

export type WebSocketHandle = {
  send: (data: string) => void
  close: () => void
}

/**
 * Reconnecting WebSocket hook with exponential backoff + jitter and full
 * cleanup. React Native's WebSocket does not auto-reconnect.
 */
export function useWebSocket(
  url: string,
  { onMessage, onOpen, enabled }: UseWebSocketOptions,
): WebSocketHandle | null {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  onMessageRef.current = onMessage
  onOpenRef.current = onOpen

  useEffect(() => {
    if (!enabled || !url) return

    let cancelled = false
    let attempt = 0

    const connect = () => {
      if (cancelled) return

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (cancelled) {
            ws.close()
            return
          }
          onOpenRef.current?.((data: string) => ws.send(data))
        }

        ws.onmessage = (event) => {
          if (cancelled) return
          try {
            const message: unknown = JSON.parse(event.data as string)
            if (
              typeof message === 'object' &&
              message !== null &&
              'type' in message &&
              message.type === 'authenticated'
            ) {
              attempt = 0
            }
            onMessageRef.current(message)
          } catch (e) {
            console.error('[useWebSocket] Failed to parse message:', e)
          }
        }

        ws.onclose = (event) => {
          // A prior room's close event can arrive after its replacement opens.
          // Keep the replacement's ref so cleanup can close the right socket.
          if (wsRef.current === ws) wsRef.current = null
          if (cancelled) return
          if (event.code !== 1000) {
            console.warn('[WebSocket] Closed:', event.code, event.reason)
          }
          const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30000)
          attempt++
          timerRef.current = setTimeout(connect, delay)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch (err) {
        console.error('[useWebSocket] Connection error:', err)
        if (cancelled) return
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30000)
        attempt++
        timerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [url, enabled])

  return {
    send: (data: string) => wsRef.current?.send(data),
    close: () => wsRef.current?.close(),
  }
}
