/** Authentication loss, throttling and request timeouts must retain the exact operation. */
export function permanentReactionFailure(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status)
}
import type { ReactionOperation } from '@meapp/shared'

export async function drainReactionOutbox(
  entries: ReactionOperation[],
  send: (entry: ReactionOperation) => Promise<unknown>,
  persist: (remaining: ReactionOperation[]) => Promise<void>,
  statusOf: (error: unknown) => number | undefined,
): Promise<void> {
  let pending = [...entries]
  for (const entry of entries) {
    try {
      await send(entry)
    } catch (error) {
      const status = statusOf(error)
      if (status !== undefined && permanentReactionFailure(status)) {
        pending = pending.filter((item) => item.operationId !== entry.operationId)
        await persist(pending)
      }
      throw error
    }
    pending = pending.filter((item) => item.operationId !== entry.operationId)
    await persist(pending)
  }
}
