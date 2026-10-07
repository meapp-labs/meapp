import { openDB } from 'idb'
const database = () =>
  openDB('meapp-ciphertext-uploads', 1, {
    upgrade(db) {
      db.createObjectStore('bytes')
    },
  })
export async function putFrozenCiphertext(id: string, bytes: Uint8Array) {
  const db = await database()
  try {
    await db.add('bytes', new Blob([new Uint8Array(bytes)]), id)
  } finally {
    db.close()
  }
}
export async function getFrozenCiphertext(id: string): Promise<Uint8Array> {
  const db = await database()
  try {
    const blob: Blob | undefined = await db.get('bytes', id)
    if (!blob)
      throw new Error(
        'Saved upload was removed by the browser. Discard it and select the file again.',
      )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    db.close()
  }
}
export async function deleteFrozenCiphertext(id: string) {
  const db = await database()
  try {
    await db.delete('bytes', id)
  } finally {
    db.close()
  }
}
