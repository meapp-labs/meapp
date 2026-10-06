import { Directory, File, Paths } from 'expo-file-system'

const directory = new Directory(Paths.cache, 'meapp-media')
const MAX_BYTES = 100 * 1024 * 1024
const accessed = new Map<string, number>()
let epoch = 0
export const mediaCacheEpoch = () => epoch

function ensureDirectory() {
  if (!directory.exists) directory.create()
}

function fileFor(name: string) {
  if (!/^[a-f0-9-]{36}(?:-thumb)?\.[a-z0-9]{1,16}$/.test(name))
    throw new Error('Invalid media cache name')
  ensureDirectory()
  return new File(directory, name)
}

export async function cacheMedia(
  name: string,
  bytes: Uint8Array,
  _mime: string,
  expectedEpoch = epoch,
): Promise<string> {
  if (epoch !== expectedEpoch) throw new Error('Media session ended')
  const file = fileFor(name)
  file.create({ overwrite: true })
  file.write(bytes)
  accessed.set(file.uri, Date.now())
  const files = directory.list().filter((item): item is File => item instanceof File)
  let total = files.reduce((sum, item) => sum + item.size, 0)
  for (const old of files.sort(
    (a, b) =>
      (accessed.get(a.uri) ?? a.modificationTime ?? 0) -
      (accessed.get(b.uri) ?? b.modificationTime ?? 0),
  )) {
    if (total <= MAX_BYTES) break
    if (old.uri === file.uri) continue
    total -= old.size
    old.delete()
    accessed.delete(old.uri)
  }
  return file.uri
}

export async function getCachedMedia(name: string): Promise<string | null> {
  const file = fileFor(name)
  if (file.exists) accessed.set(file.uri, Date.now())
  return file.exists ? file.uri : null
}

export async function clearMediaCache(): Promise<void> {
  epoch++
  accessed.clear()
  if (directory.exists) directory.delete()
}
