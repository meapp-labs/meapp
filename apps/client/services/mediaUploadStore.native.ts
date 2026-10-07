import { Directory, File, Paths } from 'expo-file-system'
const directory = new Directory(Paths.cache, 'meapp-ciphertext-uploads')
function fileFor(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid frozen upload ID')
  if (!directory.exists) directory.create()
  return new File(directory, `${id}.enc`)
}
export async function putFrozenCiphertext(id: string, bytes: Uint8Array) {
  const file = fileFor(id)
  file.create()
  file.write(bytes)
}
export async function getFrozenCiphertext(id: string) {
  const file = fileFor(id)
  if (!file.exists)
    throw new Error('Saved upload was removed by the device. Discard it and select the file again.')
  return file.bytes()
}
export async function deleteFrozenCiphertext(id: string) {
  const file = fileFor(id)
  if (file.exists) file.delete()
}
