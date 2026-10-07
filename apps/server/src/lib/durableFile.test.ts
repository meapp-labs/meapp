import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDurableJson } from './durableFile'

test('durable replacement preserves the previous journal when serialization fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meapp-durable-journal-'))
  try {
    const path = join(directory, 'backup.json')
    await writeDurableJson(path, { owner: 'old' })
    await expect(writeDurableJson(path, { invalid: 1n })).rejects.toThrow()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ owner: 'old' })
    await writeDurableJson(path, { owner: 'new', pending: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ owner: 'new', pending: true })
    expect(await readdir(directory)).toEqual(['backup.json'])
    const nested = join(directory, 'new', 'recovery', 'backup.json')
    await writeDurableJson(nested, { owner: 'nested' })
    expect(JSON.parse(await readFile(nested, 'utf8'))).toEqual({ owner: 'nested' })
  } finally {
    // Only the absolute directory freshly allocated by this test is removed.
    await rm(directory, { recursive: true, force: true })
  }
})
