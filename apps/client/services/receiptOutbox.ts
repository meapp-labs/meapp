import { z } from 'zod'

const jobSchema = z.object({
  conversationId: z.string().uuid(),
  messageIds: z.array(z.string().uuid()).min(1).max(100),
})
export type ReceiptJob = z.infer<typeof jobSchema>
type Adapter = {
  load: () => Promise<string | null>
  save: (value: string) => Promise<void>
  send: (job: ReceiptJob) => Promise<void>
  active: () => boolean
  permanentFailure: (error: unknown) => boolean
}

/** Serialize read-modify-write operations so concurrent previews cannot lose jobs. */
export function createReceiptOutbox(adapter: Adapter) {
  let work = Promise.resolve()
  let flushing: Promise<number> | null = null
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = work.then(operation)
    work = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  // Discard old delivery jobs and strip sharing consent from pre-removal queues.
  const load = async () =>
    z
      .array(jobSchema.extend({ kind: z.enum(['delivered', 'read']).optional() }))
      .parse(JSON.parse((await adapter.load()) ?? '[]'))
      .filter((job) => job.kind !== 'delivered')
      .map(({ conversationId, messageIds }) => ({ conversationId, messageIds }))
  return {
    enqueue(job: ReceiptJob) {
      return serial(async () => {
        if (!adapter.active()) throw new Error('Receipt account changed')
        const jobs = await load()
        for (let offset = 0; offset < job.messageIds.length; offset += 100) {
          const next = jobSchema.parse({
            ...job,
            messageIds: [...new Set(job.messageIds.slice(offset, offset + 100))],
          })
          const existing = jobs.find(
            (item) =>
              item.conversationId === next.conversationId &&
              new Set([...item.messageIds, ...next.messageIds]).size <= 100,
          )
          if (existing)
            existing.messageIds = [...new Set([...existing.messageIds, ...next.messageIds])]
          else jobs.push(next)
        }
        await adapter.save(JSON.stringify(jobs))
      })
    },
    flush(): Promise<number> {
      if (flushing) return flushing
      const run = async () => {
        let delivered = 0
        while (adapter.active()) {
          const job = await serial(async () => (await load())[0])
          if (!job) break
          try {
            await adapter.send(job)
          } catch (error) {
            if (!adapter.permanentFailure(error)) throw error
            // A stale/deleted target must not strand later valid acknowledgements.
            if (job.messageIds.length > 1) {
              for (const id of job.messageIds) {
                if (!adapter.active()) return delivered
                try {
                  await adapter.send({ ...job, messageIds: [id] })
                } catch (singleError) {
                  if (!adapter.permanentFailure(singleError)) throw singleError
                }
              }
            }
          }
          if (!adapter.active()) return delivered
          await serial(async () => {
            const jobs = await load()
            const sent = new Set(job.messageIds)
            const remaining = jobs.flatMap((current) => {
              if (current.conversationId !== job.conversationId) return [current]
              const messageIds = current.messageIds.filter((id) => !sent.has(id))
              return messageIds.length ? [{ ...current, messageIds }] : []
            })
            await adapter.save(JSON.stringify(remaining))
          })
          delivered++
        }
        return delivered
      }
      flushing = run().finally(() => {
        flushing = null
      })
      return flushing
    },
  }
}
