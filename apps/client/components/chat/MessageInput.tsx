import { MaterialIcons } from '@expo/vector-icons'
import { useRef, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'

import { Attachment } from '@/components/chat/Attachment'
import { useSendMessage } from '@/services/messages'
import { theme } from '@/theme/theme'
import { MESSAGE_MAX_LENGTH } from '@meapp/shared'

export function MessageInput({ conversationId }: { conversationId: string }) {
  const [inputData, setInputData] = useState('')
  const [showModal, setShowModal] = useState(false)
  const inputRef = useRef<TextInput>(null)

  const { mutate } = useSendMessage({ conversationId })

  const handleSend = () => {
    if (inputData.trim().length > 0) {
      mutate({ text: inputData })
      setInputData('')
      inputRef.current?.focus()
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.attachment}>
        <Attachment showModal={showModal} setShowModal={setShowModal} />
      </View>
      <TextInput
        ref={inputRef}
        style={styles.inputField}
        value={inputData}
        placeholder="Type a message..."
        placeholderTextColor="#9BA1A6"
        onChangeText={setInputData}
        onSubmitEditing={handleSend}
        blurOnSubmit={false} //this is deprecated but the newer submitBehavior doesn't work on pc🤷‍♂️
        submitBehavior="submit"
        multiline
        numberOfLines={1}
        maxLength={MESSAGE_MAX_LENGTH}
      />
      <TouchableOpacity style={styles.send} onPress={handleSend}>
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
    left: theme.spacing.md,
  },
})
