import { logger } from './logger.ts'

/** Runs immediately, serializes passes, and retries failures with capped backoff. */
export function startBackgroundTask(name: string, task: () => Promise<void>, intervalMs: number) {
  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    const runId = crypto.randomUUID()
    try {
      await task()
      failures = 0
      logger.info('sweep.completed', { task: name, runId })
    } catch (err) {
      failures++
      logger.error('sweep.failed', { task: name, runId, err, failures })
    }
    if (!stopped) {
      timer = setTimeout(
        () => void run(),
        failures ? Math.min(30_000 * 2 ** Math.min(failures - 1, 5), intervalMs) : intervalMs,
      )
      timer.unref?.()
    }
  }
  void run()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
