import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from './config'
import { handleLocalMedia, localSignedPut } from './localMediaStorage'

test('an interrupted real HTTP upload publishes nothing and can retry the same reservation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meapp-media-network-'))
  const previous = { directory: env.MEDIA_LOCAL_DIRECTORY, url: env.MEDIA_LOCAL_PUBLIC_URL }
  env.MEDIA_LOCAL_DIRECTORY = directory
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      try {
        return await handleLocalMedia(request)
      } catch {
        return new Response('Interrupted', { status: 503 })
      }
    },
  })
  env.MEDIA_LOCAL_PUBLIC_URL = `http://127.0.0.1:${server.port}`
  try {
    const object = `cap/${crypto.randomUUID().replaceAll('-', '')}/orig.enc`
    const bytes = new Uint8Array(1024 * 1024).fill(42)
    const url = localSignedPut(object, 60, bytes.length, 'application/octet-stream')
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(bytes.subarray(0, 65536))
      },
    })
    const upload = fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body,
      signal: controller.signal,
    }).catch(() => null)
    // Wait for bytes to reach the filesystem before interrupting the socket.
    const objectDirectory = join(directory, 'cap', object.split('/')[1] as string)
    let started = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await readdir(objectDirectory).catch(() => [])).some((name) => name.endsWith('.partial'))
      ) {
        started = true
        break
      }
      await Bun.sleep(10)
    }
    expect(started).toBe(true)
    controller.abort()
    await upload
    let remaining = ['pending']
    for (let attempt = 0; attempt < 100; attempt++) {
      remaining = await readdir(objectDirectory)
      if (remaining.length === 0) break
      await Bun.sleep(10)
    }
    expect(remaining).toEqual([])
    expect((await fetch(`${env.MEDIA_LOCAL_PUBLIC_URL}/${object}`)).status).toBe(404)
    const retry = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    expect(retry.status).toBe(201)
    const downloaded = await fetch(`${env.MEDIA_LOCAL_PUBLIC_URL}/${object}`)
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes)
    expect((await readdir(objectDirectory)).filter((name) => name.endsWith('.partial'))).toEqual([])
  } finally {
    server.stop(true)
    env.MEDIA_LOCAL_DIRECTORY = previous.directory
    env.MEDIA_LOCAL_PUBLIC_URL = previous.url
    await rm(directory, { recursive: true, force: true })
  }
}, 10000)
