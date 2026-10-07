// Metro selects the platform implementation. Only ciphertext goes here.
export async function putFrozenCiphertext(_id: string, _bytes: Uint8Array): Promise<void> {
  throw new Error('Upload storage unavailable')
}
export async function getFrozenCiphertext(_id: string): Promise<Uint8Array> {
  throw new Error('Upload storage unavailable')
}
export async function deleteFrozenCiphertext(_id: string): Promise<void> {
  throw new Error('Upload storage unavailable')
}
