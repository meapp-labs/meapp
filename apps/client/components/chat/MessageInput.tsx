import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import Toast from 'react-native-toast-message'

import { Attachment } from '@/components/chat/Attachment'
import { Text } from '@/components/common/Text'
import { Keys } from '@/lib/keys'
import { useAuthStore } from '@/lib/stores'
import { uuid } from '@/lib/uuid'
import { useSelectedConversation } from '@/services/conversations'
import { captureAndSendMedia, pickAndSendFiles, pickAndSendMedia } from '@/services/media'
import { useSendMessage } from '@/services/messages'
import { useIgnoredUsers } from '@/services/others'
import { theme } from '@/theme/theme'
import { MESSAGE_MAX_LENGTH } from '@meapp/shared'
import { MediaTransferPanel } from './MediaTransferPanel'
import { VoiceRecorder } from './VoiceRecorder'
import { useComposerDraft, useReplyDraft } from './replyDraft'

export function MessageInput({
  conversationId,
  threadRootId,
}: { conversationId: string; threadRootId?: string | undefined }) {
  const draft = useReplyDraft()
  const reply =
    draft.roomId === conversationId && draft.threadRootId === (threadRootId ?? null)
      ? draft.message
      : null
  useEffect(() => {
    if (reply || threadRootId) inputRef.current?.focus()
  }, [reply, threadRootId])
  const username = useAuthStore((state) => state.username)
  const conversation = useSelectedConversation()
  const ignored = useIgnoredUsers()
  const blocked =
    conversation?.id === conversationId &&
    !conversation.isGroup &&
    conversation.participants.some((name) => name !== username && ignored.data?.includes(name))
  const scope = `${username}:${conversationId}:${threadRootId ?? 'main'}`
  const inputData = useComposerDraft((state) => state.texts[scope] ?? '')
  const setText = useComposerDraft((state) => state.setText)
  const setInputData = (text: string) => setText(scope, text)
  const [mediaPending, setMediaPending] = useState(false)
  const [recording, setRecording] = useState(false)
  const queryClient = useQueryClient()
  const inputRef = useRef<TextInput>(null)
  const lastSubmitted = useRef<string | null>(null)
  const retry = useRef<{
    roomId: string
    text: string
    clientId: string
    replyTo?: string | undefined
  } | null>(null)

  const { mutateAsync, isPending } = useSendMessage({ conversationId, threadRootId })

  const handleMedia = async (picker = pickAndSendMedia) => {
    if (blocked || mediaPending || isPending) return
    setMediaPending(true)
    try {
      const sent = await picker(conversationId, reply?.id, threadRootId)
      if (sent) {
        if (sent.replyTo === reply?.id && useReplyDraft.getState().message?.id === reply?.id)
          draft.clear()
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_MESSAGES, conversationId] }),
          queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] }),
        ])
      }
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Attachment not sent',
        text2: error instanceof Error ? error.message : 'Please try again',
      })
    } finally {
      setMediaPending(false)
    }
  }

  const handleSend = async () => {
    const submitted = inputData.trim()
    if (blocked || !submitted || isPending || lastSubmitted.current === submitted) return
    lastSubmitted.current = submitted
    const clientId =
      retry.current?.roomId === conversationId &&
      retry.current.text === submitted &&
      retry.current.replyTo === reply?.id
        ? retry.current.clientId
        : uuid()
    retry.current = { roomId: conversationId, text: submitted, clientId, replyTo: reply?.id }
    try {
      await mutateAsync({ text: submitted, clientId, replyTo: reply?.id })
      if (useReplyDraft.getState().message?.id === reply?.id) draft.clear()
      retry.current = null
      setInputData('')
      inputRef.current?.focus()
    } catch (error) {
      lastSubmitted.current = null
      Toast.show({
        type: 'error',
        text1: 'Message not sent',
        text2: error instanceof Error ? error.message : 'Please try again',
      })
    }
  }

  return (
    <View>
      {blocked && (
        <Text>
          This account is blocked. Unblock it from the chat menu or settings to send messages.
        </Text>
      )}
      <MediaTransferPanel conversationId={conversationId} />
      {recording && !blocked && (
        <VoiceRecorder
          conversationId={conversationId}
          replyTo={reply?.id}
          threadRootId={threadRootId}
          onClose={() => setRecording(false)}
          onSent={() => {
            void queryClient.invalidateQueries()
          }}
        />
      )}
      {reply && (
        <View style={styles.replyDraft}>
          <MaterialIcons name="reply" size={22} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyAuthor}>Replying to {reply.from}</Text>
            <Text numberOfLines={2} style={styles.replyPreview}>
              {reply.text ?? 'Attachment'}
            </Text>
          </View>
          <TouchableOpacity accessibilityLabel="Cancel reply" onPress={draft.clear} hitSlop={12}>
            <MaterialIcons name="close" size={22} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.container}>
        <View style={styles.attachment}>
          <Attachment
            onPress={() => void handleMedia(pickAndSendFiles)}
            onImagePress={() => void handleMedia()}
            onCameraPress={() => void handleMedia(captureAndSendMedia)}
            onVoicePress={() => setRecording(true)}
            disabled={blocked || mediaPending || isPending}
          />
        </View>
        <TextInput
          ref={inputRef}
          style={styles.inputField}
          value={inputData}
          editable={!blocked && !isPending}
          placeholder={threadRootId ? 'Reply in thread…' : 'Type a message...'}
          accessibilityLabel={threadRootId ? 'Reply in thread' : 'Message'}
          placeholderTextColor="#9BA1A6"
          onChangeText={(value) => {
            lastSubmitted.current = null
            setInputData(value)
          }}
          onSubmitEditing={() => void handleSend()}
          blurOnSubmit={false} //this is deprecated but the newer submitBehavior doesn't work on pc🤷‍♂️
          submitBehavior="submit"
          multiline
          numberOfLines={1}
          maxLength={MESSAGE_MAX_LENGTH}
        />
        <TouchableOpacity
          style={styles.send}
          accessibilityRole="button"
          accessibilityLabel={threadRootId ? 'Send thread reply' : 'Send message'}
          disabled={blocked || isPending}
          onPress={() => void handleSend()}
        >
          <MaterialIcons name="send" size={24} color={theme.colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  replyDraft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    marginHorizontal: 12,
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  replyAuthor: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  replyPreview: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 3 },
  container: {
    justifyContent: 'center',
    marginHorizontal: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  inputField: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: 48,
    color: theme.colors.text,
    width: '100%',
    borderRadius: theme.spacing.xl,
    backgroundColor: theme.colors.surface,
  },
  send: {
    position: 'absolute',
    right: theme.spacing.md,
  },
  attachment: {
    position: 'absolute',
    left: theme.spacing.xs,
    zIndex: 1,
  },
})
