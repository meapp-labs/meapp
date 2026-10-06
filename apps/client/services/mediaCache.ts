// Metro selects the native or web implementation.
export async function cacheMedia(
  _name: string,
  _bytes: Uint8Array,
  _mime: string,
  _expectedEpoch?: number,
): Promise<string> {
  throw new Error('Media cache unavailable')
}
export const mediaCacheEpoch = () => 0
export async function getCachedMedia(_name: string): Promise<string | null> {
  throw new Error('Media cache unavailable')
}
export async function clearMediaCache(): Promise<void> {
  throw new Error('Media cache unavailable')
}
