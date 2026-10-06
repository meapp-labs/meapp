import { Keys } from '@/lib/keys'
import { droppedMediaTypes, optimizedImageMime } from '@/services/droppedMedia'
import { sendMediaAssets } from '@/services/media'
import { mediaCacheEpoch } from '@/services/mediaCache'
import { theme } from '@/theme/theme'
import { useQueryClient } from '@tanstack/react-query'
import type { ImagePickerAsset } from 'expo-image-picker'
import { type DragEvent, type ReactNode, useRef, useState } from 'react'
import Toast from 'react-native-toast-message'

function dimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new globalThis.Image()
    const timer = setTimeout(() => {
      image.src = ''
      reject(new Error('Image could not be opened'))
    }, 15_000)
    image.onload = () => {
      clearTimeout(timer)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Image could not be opened'))
    }
    image.src = uri
  })
}

export function MediaDropZone({
  conversationId,
  children,
}: { conversationId: string; children: ReactNode }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const busy = useRef(false)
  const depth = useRef(0)
  const queryClient = useQueryClient()

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    depth.current = 0
    setDragging(false)
    if (busy.current) return
    const files = Array.from(event.dataTransfer.files)
    const epoch = mediaCacheEpoch()
    const urls: string[] = []
    busy.current = true
    setUploading(true)
    try {
      const types = droppedMediaTypes(files)
      const assets: ImagePickerAsset[] = []
      for (const [index, file] of files.entries()) {
        const uri = URL.createObjectURL(file)
        urls.push(uri)
        const size = optimizedImageMime(types[index] as string)
          ? await dimensions(uri)
          : { width: 0, height: 0 }
        assets.push({ uri, ...size, file, fileName: file.name, mimeType: types[index] as string })
      }
      if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
      await sendMediaAssets(conversationId, assets)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_MESSAGES, conversationId] }),
        queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] }),
      ])
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Files not sent',
        text2: error instanceof Error ? error.message : 'Please try again',
      })
    } finally {
      for (const uri of urls) URL.revokeObjectURL(uri)
      busy.current = false
      setUploading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
      }}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        depth.current++
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = busy.current ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(event) => void onDrop(event)}
    >
      {children}
      {(dragging || uploading) && (
        <output
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.background,
            opacity: 0.9,
            border: `2px dashed ${theme.colors.primary}`,
            borderRadius: 12,
            color: theme.colors.text,
          }}
        >
          {uploading ? 'Sending files…' : 'Drop files to send'}
        </output>
      )}
    </div>
  )
}
