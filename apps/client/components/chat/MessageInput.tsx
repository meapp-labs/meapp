import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import Toast from 'react-native-toast-message'

import { Attachment } from '@/components/chat/Attachment'
import { Keys } from '@/lib/keys'
import { uuid } from '@/lib/uuid'
import { pickAndSendFiles, pickAndSendMedia } from '@/services/media'
import { useSendMessage } from '@/services/messages'
import { theme } from '@/theme/theme'
import { MESSAGE_MAX_LENGTH } from '@meapp/shared'

export function MessageInput({ conversationId }: { conversationId: string }) {
  const [inputData, setInputData] = useState('')
  const [mediaPending, setMediaPending] = useState(false)
  const queryClient = useQueryClient()
  const inputRef = useRef<TextInput>(null)
  const lastSubmitted = useRef<string | null>(null)
  const retry = useRef<{ roomId: string; text: string; clientId: string } | null>(null)

  const { mutateAsync, isPending } = useSendMessage({ conversationId })

  const handleMedia = async (picker = pickAndSendMedia) => {
    if (mediaPending || isPending) return
    setMediaPending(true)
    try {
      const sent = await picker(conversationId)
      if (sent) {
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
    if (!submitted || isPending || lastSubmitted.current === submitted) return
    lastSubmitted.current = submitted
    const clientId =
      retry.current?.roomId === conversationId && retry.current.text === submitted
        ? retry.current.clientId
        : uuid()
    retry.current = { roomId: conversationId, text: submitted, clientId }
    try {
      await mutateAsync({ text: submitted, clientId })
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
    <View style={styles.container}>
      <View style={styles.attachment}>
        <Attachment
          onPress={() => void handleMedia(pickAndSendFiles)}
          onImagePress={() => void handleMedia()}
          disabled={mediaPending || isPending}
        />
      </View>
      <TextInput
        ref={inputRef}
        style={styles.inputField}
        value={inputData}
        editable={!isPending}
        placeholder="Type a message..."
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
      <TouchableOpacity style={styles.send} disabled={isPending} onPress={() => void handleSend()}>
        <MaterialIcons name="send" size={24} color={theme.colors.text} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
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
