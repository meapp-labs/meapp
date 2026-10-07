/** Checks local pending work independently of WebSocket-backed query polling. */
export function startReactionOutboxRetry(
  flush: (shouldContinue: () => boolean) => Promise<number>,
  onSent: () => void,
  intervalMs = 15_000,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = async () => {
    try {
      const sent = await flush(() => !stopped)
      if (!stopped && sent > 0) onSent()
    } catch {
      // Failed operations stay in durable storage for the next foreground pass.
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), intervalMs)
    }
  }

  void run()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
