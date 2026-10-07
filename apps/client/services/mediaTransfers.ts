import { MEDIA_TRANSFER_TIMEOUT_MS } from '@meapp/shared'
import { Platform } from 'react-native'

export type MediaTransfer = {
  id: string
  roomId: string
  phase: 'uploading' | 'sending' | 'paused' | 'failed'
  loaded: number
  total: number
  error?: string
  canDiscard?: boolean
}
let snapshot: MediaTransfer[] = []
const listeners = new Set<() => void>()
const controllers = new Map<string, AbortController>()
export const mediaTransferSnapshot = () => snapshot
export const subscribeMediaTransfers = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function updateMediaTransfer(transfer: MediaTransfer) {
  snapshot = [...snapshot.filter((item) => item.id !== transfer.id), transfer]
  for (const listener of listeners) listener()
}
export function removeMediaTransfer(id: string) {
  controllers.delete(id)
  snapshot = snapshot.filter((item) => item.id !== id)
  for (const listener of listeners) listener()
}
export function beginMediaTransfer(id: string) {
  const controller = new AbortController()
  controllers.set(id, controller)
  return controller
}
export function pauseMediaTransfer(id: string) {
  const item = snapshot.find((item) => item.id === id)
  if (item?.phase === 'uploading') controllers.get(id)?.abort()
}
export function clearMediaTransfers() {
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  snapshot = []
  for (const listener of listeners) listener()
}

/** XHR exposes PUT progress in both RN and browsers; fetch is the test fallback. */
export async function uploadMediaBytes(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  signal: AbortSignal,
  progress: (loaded: number) => void,
) {
  signal.throwIfAborted()
  // React Native's Blob constructor rejects ArrayBuffer views. Its networking
  // layer accepts them directly; browsers use Blob for an exact Content-Length.
  const body =
    Platform.OS === 'web' ? new Blob([new Uint8Array(bytes)]) : new Uint8Array(bytes).buffer
  if (typeof XMLHttpRequest === 'undefined') {
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(MEDIA_TRANSFER_TIMEOUT_MS)]),
    })
    if (!response.ok && response.status !== 412)
      throw new Error(`Media upload failed (${response.status})`)
    progress(bytes.length)
    return
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = (error?: Error) => {
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else {
        progress(bytes.length)
        resolve()
      }
    }
    xhr.open('PUT', url)
    xhr.timeout = MEDIA_TRANSFER_TIMEOUT_MS
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => progress(Math.min(event.loaded, bytes.length))
    xhr.onload = () =>
      finish(
        (xhr.status >= 200 && xhr.status < 300) || xhr.status === 412
          ? undefined
          : new Error(`Media upload failed (${xhr.status})`),
      )
    xhr.onerror = () =>
      finish(new Error('Connection interrupted. Retry to resume this attachment.'))
    xhr.ontimeout = () => finish(new Error('Upload timed out. Retry to resume this attachment.'))
    xhr.onabort = () => finish(new Error('Upload paused'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      finish(new Error('Upload paused'))
      return
    }
    xhr.send(body)
  })
}
