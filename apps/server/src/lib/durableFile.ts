import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Publish a complete, flushed journal before any related database mutation. */
export async function writeDurableJson(path: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value)
  const directory = dirname(path)
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(content)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
    // POSIX needs the directory entry flushed as well. Windows cannot open a
    // directory this way; file flushing works, but power-loss rename durability
    // must be validated on the intended Windows filesystem separately.
    if (process.platform !== 'win32') {
      // A newly created recovery directory also needs its entry in the parent
      // flushed; syncing only the journal's directory can lose the entire tree.
      let current = directory
      while (true) {
        const parent = await open(current, 'r')
        try {
          await parent.sync()
        } finally {
          await parent.close()
        }
        if (!firstCreated || current === dirname(firstCreated)) break
        const next = dirname(current)
        if (next === current) break
        current = next
      }
    }
  } finally {
    await rm(temporary, { force: true })
  }
}
