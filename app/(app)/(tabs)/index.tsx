import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { Colors } from '@/constants/Colors'
import React, { useEffect, useRef, useState } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
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
import { router } from 'expo-router'
import FriendsScreen from '@/components/FriendsScreen'
import { Button } from '@react-navigation/elements'
import Toolbar from '@/components/Toolbar'

export default function ChatScreen() {
    const [messages, setMessages] = useState<
        { id: string; text: string; sender: string }[]
    >([])
    const [inputText, setInputText] = useState('')
    const flatListRef = useRef<FlatList>(null)
    const [socketUrl] = useState('ws://localhost:8080')

    const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl, {
        shouldReconnect: () => true,
    })

    useEffect(() => {
        if (lastMessage !== null) {
            const newMessage = {
                id: `${Date.now()}`,
                text: lastMessage.data,
                sender: 'them',
            }
            setMessages((prevMessages) => [...prevMessages, newMessage])
        }
    }, [lastMessage])

    const handleSend = () => {
        if (inputText.trim().length > 0 && readyState === ReadyState.OPEN) {
            sendMessage(inputText)
            // Optimistically add the message to the UI
            const newMessage = {
                id: `${Date.now()}`,
                text: inputText,
                sender: 'me',
            }
            setMessages((prevMessages) => [...prevMessages, newMessage])
            setInputText('')
        }
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

    const connectionStatus = {
        [ReadyState.CONNECTING]: 'Connecting...',
        [ReadyState.OPEN]: 'Connected',
        [ReadyState.CLOSING]: 'Closing...',
        [ReadyState.CLOSED]: 'Disconnected',
        [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
    }[readyState]

    return (
        <ThemedView
            style={[
                styles.container,
                {
                    flexDirection: 'row',
                },
            ]}
        >
            <View
                style={{
                    flex: 1,
                    borderRightColor: '#2c2c2e',
                    borderRightWidth: 1,
                }}
            >
                <FriendsScreen />

                {/*Mock logout button*/}
                <Button
                    style={{
                        margin: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onPress={() => router.navigate('/sign-in')}
                >
                    Logout
                </Button>
            </View>

            <View style={{ flex: 5 }}>
                <View style={styles.statusBar}>
                    <ThemedText style={styles.statusText}>
                        {connectionStatus}
                    </ThemedText>
                </View>
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
                    onLayout={() =>
                        flatListRef.current?.scrollToEnd({ animated: true })
                    }
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
                        <TouchableOpacity
                            style={styles.sendButton}
                            onPress={handleSend}
                        >
                            <Text style={styles.sendButtonText}>Send</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </View>
            <View>
                <Toolbar />
            </View>
        </ThemedView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    statusBar: {
        padding: 10,
        backgroundColor: '#1C1C1E',
        alignItems: 'center',
    },
    statusText: {
        color: '#9BA1A6',
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
