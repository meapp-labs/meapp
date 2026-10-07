import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(tmpdir(), 'meapp-built-validation-20261007')
await mkdir(root, { recursive: true })
const login = await fetch('http://127.0.0.1:18080/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'emil3', password: 'Validation2026Local' }),
})
if (!login.ok) throw new Error(`Fixture login failed: ${login.status}`)
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
const response = await fetch('http://127.0.0.1:18080/api/profile', { headers: { cookie } })
const profile = (await response.json()) as { avatarUrl: string }
const avatar = await fetch(profile.avatarUrl)
if (!avatar.ok) throw new Error('Fixture avatar unavailable')
await Bun.write(join(root, 'avatar.webp'), await avatar.arrayBuffer())
await Bun.write(join(root, 'sample.txt'), 'MeApp isolated attachment validation\n')
await Bun.write(join(root, 'large.bin'), new Uint8Array(100 * 1024 * 1024 - 28).fill(42))
console.log(`Disposable fixture files created in ${root}`)
