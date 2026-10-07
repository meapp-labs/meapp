import { sendVoiceRecording } from '@/services/media'
import { mediaCacheEpoch } from '@/services/mediaCache'
import { mediaTransferSnapshot } from '@/services/mediaTransfers'
import { theme } from '@/theme/theme'
import { VOICE_MAX_BYTES, VOICE_MAX_DURATION_MS } from '@meapp/shared'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { File } from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Modal, Platform, Pressable, Text, View } from 'react-native'
import { AudioPlayback } from './AudioPlayback'

function removeRecording(uri: string | null) {
  if (!uri) return
  if (Platform.OS === 'web') URL.revokeObjectURL(uri)
  else {
    const file = new File(uri)
    if (file.exists) file.delete()
  }
}

export function VoiceRecorder({
  conversationId,
  onClose,
  onSent,
}: { conversationId: string; onClose: () => void; onSent: () => void }) {
  const [uri, setUri] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'ready' | 'recording' | 'preview'>('ready')
  const live = useRef(true)
  const recordingUri = useRef<string | null>(null)
  const epoch = useRef(mediaCacheEpoch())
  const lastDuration = useRef(0)
  const recorder = useAudioRecorder(
    {
      ...RecordingPresets.HIGH_QUALITY,
      numberOfChannels: 1,
      bitRate: 64000,
      android: { ...RecordingPresets.HIGH_QUALITY.android, maxFileSize: VOICE_MAX_BYTES },
      web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
    },
    (status) => {
      if (status.hasError && live.current) setError(status.error ?? 'Recording interrupted')
    },
  )
  const state = useAudioRecorderState(recorder, 200)
  const stopping = useRef(false)
  const finish = useCallback(async () => {
    if (stopping.current) return
    stopping.current = true
    setBusy(true)
    try {
      const measured = Math.max(recorder.getStatus().durationMillis, lastDuration.current)
      if (recorder.isRecording) await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      const value = recorder.uri
      recordingUri.current = value
      if (!live.current || mediaCacheEpoch() !== epoch.current) {
        removeRecording(value)
        return
      }
      if (!value) throw new Error('No recording was created. Try again.')
      const size =
        Platform.OS === 'web' ? (await (await fetch(value)).blob()).size : new File(value).size
      if (!size || size > VOICE_MAX_BYTES || measured > VOICE_MAX_DURATION_MS + 1000)
        throw new Error('Voice messages must be non-empty, at most 5 minutes and 10 MiB.')
      setDuration(Math.min(measured, VOICE_MAX_DURATION_MS))
      setUri(value)
      setPhase('preview')
    } catch (error) {
      if (live.current) {
        setError(error instanceof Error ? error.message : 'Recording failed')
        setPhase('ready')
      }
      removeRecording(recordingUri.current)
      recordingUri.current = null
    } finally {
      stopping.current = false
      if (live.current) setBusy(false)
    }
  }, [recorder])
  useEffect(() => {
    live.current = true
    if (phase === 'recording') {
      lastDuration.current = Math.max(lastDuration.current, state.durationMillis)
      if (
        state.durationMillis >= VOICE_MAX_DURATION_MS - 200 ||
        (!state.isRecording && lastDuration.current > 0)
      )
        void finish()
    }
  })
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (value) => {
      if (value !== 'active' && recorder.isRecording) void finish()
    })
    return () => {
      live.current = false
      subscription.remove()
      void Promise.resolve()
        .then(() => recorder.stop())
        .catch(() => undefined)
        .finally(() => {
          removeRecording(recordingUri.current)
          void setAudioModeAsync({ allowsRecording: false })
        })
    }
  }, [recorder, finish])
  const start = async () => {
    lastDuration.current = 0
    setBusy(true)
    setError('')
    try {
      const permission = await requestRecordingPermissionsAsync()
      if (!permission.granted)
        throw new Error(
          permission.canAskAgain
            ? 'Microphone permission is required.'
            : 'Enable microphone permission for MeApp in Settings.',
        )
      if (!live.current || mediaCacheEpoch() !== epoch.current) return
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recordingUri.current = recorder.uri
      if (!live.current || mediaCacheEpoch() !== epoch.current) {
        await recorder.stop()
        return
      }
      if (AppState.currentState !== 'active')
        throw new Error('Return to MeApp before starting a recording.')
      recorder.record({ forDuration: VOICE_MAX_DURATION_MS / 1000 })
      setPhase('recording')
    } catch (error) {
      await recorder.stop().catch(() => undefined)
      await setAudioModeAsync({ allowsRecording: false })
      if (live.current) setError(error instanceof Error ? error.message : 'Cannot start recording')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  const send = async () => {
    if (!uri || busy) return
    setBusy(true)
    try {
      if (mediaCacheEpoch() !== epoch.current) throw new Error('Media session ended')
      const webFile = Platform.OS === 'web' ? await (await fetch(uri)).blob() : null
      await sendVoiceRecording(
        conversationId,
        {
          uri,
          width: 0,
          height: 0,
          duration,
          mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4',
          fileName: Platform.OS === 'web' ? 'voice.webm' : 'voice.m4a',
          ...(webFile
            ? { file: new globalThis.File([webFile], 'voice.webm', { type: 'audio/webm' }) }
            : {}),
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
      animationType="slide"
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
          {phase === 'recording' && (
            <Text style={{ color: theme.colors.text }}>
              Recording {Math.floor(state.durationMillis / 1000)} s
            </Text>
          )}
          {uri && <AudioPlayback uri={uri} />}
          {error && <Text style={{ color: theme.colors.text }}>{error}</Text>}
          {phase === 'ready' && (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void start()}>
              <Text style={{ color: theme.colors.text }}>Start recording</Text>
            </Pressable>
          )}
          {phase === 'recording' && (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void finish()}>
              <Text style={{ color: theme.colors.text }}>Stop and preview</Text>
            </Pressable>
          )}
          {phase === 'preview' && (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send()}>
              <Text style={{ color: theme.colors.text }}>
                {busy ? 'Sending…' : 'Send voice message'}
              </Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" disabled={busy} onPress={onClose}>
            <Text style={{ color: theme.colors.text }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
