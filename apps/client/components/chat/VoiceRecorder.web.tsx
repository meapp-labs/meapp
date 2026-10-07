import { sendVoiceRecording } from '@/services/media'
import { mediaCacheEpoch } from '@/services/mediaCache'
import { mediaTransferSnapshot } from '@/services/mediaTransfers'
import { theme } from '@/theme/theme'
import { VOICE_MAX_BYTES, VOICE_MAX_DURATION_MS } from '@meapp/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'

export function VoiceRecorder({
  conversationId,
  onClose,
  onSent,
}: { conversationId: string; onClose: () => void; onSent: () => void }) {
  const [preview, setPreview] = useState<{ uri: string; blob: Blob; duration: number } | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const objectUrl = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const live = useRef(true)
  const epoch = useRef(mediaCacheEpoch())
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])
  useEffect(() => {
    live.current = true
    const background = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', background)
    return () => {
      live.current = false
      stop()
      for (const track of stream.current?.getTracks() ?? []) track.stop()
      if (timer.current) clearInterval(timer.current)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      document.removeEventListener('visibilitychange', background)
    }
  }, [stop])
  const start = async () => {
    setBusy(true)
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw new Error('Voice recording requires a supported browser and HTTPS (or localhost).')
      const tracks = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!live.current || mediaCacheEpoch() !== epoch.current) {
        for (const track of tracks.getTracks()) track.stop()
        return
      }
      stream.current = tracks
      if (document.hidden) throw new Error('Return to MeApp before starting a recording.')
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((value) =>
        MediaRecorder.isTypeSupported(value),
      )
      if (!mime) {
        for (const track of tracks.getTracks()) track.stop()
        throw new Error('This browser has no supported audio recording format.')
      }
      const active = new MediaRecorder(tracks, { mimeType: mime, audioBitsPerSecond: 64000 })
      recorder.current = active
      const chunks: Blob[] = []
      let size = 0
      let oversized = false
      const started = Date.now()
      active.ondataavailable = (event) => {
        size += event.data.size
        if (size > VOICE_MAX_BYTES) {
          oversized = true
          chunks.length = 0
          stop()
        } else if (!oversized) chunks.push(event.data)
      }
      active.onerror = () => {
        if (live.current) setError('Recording interrupted. Please try again.')
        stop()
      }
      active.onstop = () => {
        for (const track of tracks.getTracks()) track.stop()
        if (timer.current) clearInterval(timer.current)
        if (!live.current || mediaCacheEpoch() !== epoch.current) return
        setRecording(false)
        if (oversized || !size) {
          setError('Voice messages must be non-empty and at most 10 MiB.')
          return
        }
        const blob = new Blob(chunks, { type: mime })
        const duration = Date.now() - started
        if (duration > VOICE_MAX_DURATION_MS + 1000) {
          setError('Recording exceeded 5 minutes. Please record a shorter message.')
          return
        }
        const uri = URL.createObjectURL(blob)
        objectUrl.current = uri
        setPreview({ uri, blob, duration: Math.min(duration, VOICE_MAX_DURATION_MS) })
      }
      active.start(250)
      setRecording(true)
      timer.current = setInterval(() => {
        const elapsed = Date.now() - started
        if (live.current) setSeconds(Math.floor(elapsed / 1000))
        if (elapsed >= VOICE_MAX_DURATION_MS || mediaCacheEpoch() !== epoch.current) stop()
      }, 200)
    } catch (error) {
      for (const track of stream.current?.getTracks() ?? []) track.stop()
      if (live.current)
        setError(
          error instanceof Error ? error.message : 'Allow microphone access in browser settings.',
        )
    } finally {
      if (live.current) setBusy(false)
    }
  }
  const send = async () => {
    if (!preview || busy) return
    setBusy(true)
    try {
      if (mediaCacheEpoch() !== epoch.current) throw new Error('Media session ended')
      const extension =
        preview.blob.type === 'audio/mp4'
          ? 'm4a'
          : preview.blob.type === 'audio/ogg'
            ? 'ogg'
            : 'webm'
      const file = new File([preview.blob], `voice.${extension}`, { type: preview.blob.type })
      await sendVoiceRecording(
        conversationId,
        {
          uri: preview.uri,
          file,
          fileName: file.name,
          mimeType: file.type,
          width: 0,
          height: 0,
          duration: preview.duration,
        },
        onClose,
      )
      onSent()
      onClose()
    } catch (error) {
      if (mediaTransferSnapshot().some((job) => job.roomId === conversationId)) {
        onClose()
        return
      }
      if (live.current) setError(error instanceof Error ? error.message : 'Voice message not sent')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  return (
    <Modal
      visible
      transparent
      onRequestClose={() => {
        if (!busy) onClose()
      }}
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          backgroundColor: theme.colors.overlay,
          padding: 24,
        }}
      >
        <View
          style={{ padding: 24, gap: 20, backgroundColor: theme.colors.card, borderRadius: 20 }}
        >
          <Text style={{ color: theme.colors.text }}>Voice message · up to 5 minutes / 10 MiB</Text>
          {error && <Text style={{ color: theme.colors.text }}>{error}</Text>}
          {preview ? (
            <>
              <audio src={preview.uri} controls>
                <track kind="captions" />
              </audio>
              <Pressable disabled={busy} accessibilityRole="button" onPress={() => void send()}>
                <Text style={{ color: theme.colors.text }}>
                  {busy ? 'Sending…' : 'Send voice message'}
                </Text>
              </Pressable>
            </>
          ) : recording ? (
            <>
              <Text style={{ color: theme.colors.text }}>Recording {seconds} s</Text>
              <Pressable accessibilityRole="button" onPress={stop}>
                <Text style={{ color: theme.colors.text }}>Stop and preview</Text>
              </Pressable>
            </>
          ) : (
            <Pressable disabled={busy} accessibilityRole="button" onPress={() => void start()}>
              <Text style={{ color: theme.colors.text }}>Start recording</Text>
            </Pressable>
          )}
          <Pressable disabled={busy} accessibilityRole="button" onPress={onClose}>
            <Text style={{ color: theme.colors.text }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
