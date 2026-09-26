import { useEffect, useRef } from 'react'

export type UseWebSocketOptions = {
  onMessage: (data: unknown) => void
  getAuthMessage: (signal: AbortSignal) => Promise<string>
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
  { onMessage, getAuthMessage, enabled }: UseWebSocketOptions,
): WebSocketHandle | null {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  const getAuthMessageRef = useRef(getAuthMessage)
  onMessageRef.current = onMessage
  getAuthMessageRef.current = getAuthMessage

  useEffect(() => {
    if (!enabled || !url) return

    let cancelled = false
    let attempt = 0
    const controller = new AbortController()

    const connect = async () => {
      if (cancelled) return

      try {
        // Ticket latency is outside the server's two-second auth window.
        const authMessage = await getAuthMessageRef.current(controller.signal)
        if (cancelled) return
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (cancelled) {
            ws.close()
            return
          }
          ws.send(authMessage)
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
          // Auth and permission failures need a new login or room selection.
          if (event.code >= 4400 && event.code < 4500 && event.code !== 4429) {
            console.warn('[WebSocket] Connection rejected:', event.code, event.reason)
            return
          }
          if (event.code !== 1000) {
            console.warn('[WebSocket] Closed:', event.code, event.reason)
          }
          const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30000)
          attempt++
          timerRef.current = setTimeout(() => void connect(), delay)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch (err) {
        console.error('[useWebSocket] Connection error:', err)
        if (cancelled) return
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30000)
        attempt++
        timerRef.current = setTimeout(() => void connect(), delay)
      }
    }

    void connect()

    return () => {
      cancelled = true
      controller.abort()
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
