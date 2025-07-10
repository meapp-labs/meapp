import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { Colors } from '@/constants/Colors'
import React, { useEffect, useRef, useState } from 'react'
import WS from 'react-native-websocket'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

export default function ChatScreen() {
  const [messages, setMessages] = useState<
    { id: string; text: string; sender: string }[]
  >([])
  const [inputText, setInputText] = useState('')
  const flatListRef = useRef<FlatList>(null)
  const webSocketRef = useRef<WebSocket>(null)

  const handleSend = () => {
    if (inputText.trim().length > 0 && webSocketRef.current) {
      webSocketRef.current.send(inputText)
      // Optimistically add the message to the UI
      const newMessage = {
        id: (messages.length + 1).toString(),
        text: inputText,
        sender: 'me',
      }
      setMessages([...messages, newMessage])
      setInputText('')
    }
  }

  const handleMessage = (event: { data: string }) => {
    const newMessage = {
      id: (messages.length + 1).toString(),
      text: event.data,
      sender: 'them',
    }
    setMessages((prevMessages) => [...prevMessages, newMessage])
  }

  useEffect(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true })
    }
  }, [messages])

  const renderMessage = ({
    item,
  }: {
    item: { id: string; text: string; sender: string }
  }) => (
    <View
      style={[
        styles.messageContainer,
        item.sender === 'me'
          ? styles.myMessageContainer
          : styles.theirMessageContainer,
      ]}
    >
      <ThemedText
        style={item.sender === 'me' ? styles.myMessageText : undefined}
      >
        {item.text}
      </ThemedText>
    </View>
  )

  return (
    <ThemedView style={styles.container}>
      <WS
        ref={webSocketRef}
        url='ws://localhost:8080'
        onMessage={handleMessage}
        onError={() => console.log('WebSocket Error:')}
        onClose={() => console.log('WebSocket Closed')}
        reconnect
      />
      <View style={{ flex: 5 }}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder='Type a message...'
              placeholderTextColor='#9BA1A6'
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  messageContainer: {
    borderRadius: 20,
    padding: 15,
    marginVertical: 5,
    maxWidth: '80%',
  },
  myMessageContainer: {
    backgroundColor: '#007AFF',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 5,
  },
  theirMessageContainer: {
    backgroundColor: '#2C2C2E',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 5,
  },
  myMessageText: {
    color: '#fff',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
  },
  input: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    color: Colors.text,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
})
