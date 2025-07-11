import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import styles from '@/styles';
import React, { useEffect, useRef, useState } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import useWebSocket, { ReadyState } from 'react-use-websocket';

export default function ChatScreen() {
    const [messages, setMessages] = useState<
        { id: string; text: string; sender: string }[]
    >([]);
    const [inputText, setInputText] = useState('');
    const flatListRef = useRef<FlatList>(null);
    const [socketUrl] = useState('ws://localhost:8080');

    const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl, {
        shouldReconnect: () => true,
    });

    useEffect(() => {
        if (lastMessage !== null) {
            const newMessage = {
                id: `${Date.now()}`,
                text: lastMessage.data,
                sender: 'them',
            };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
        }
    }, [lastMessage]);

    const handleSend = () => {
        if (inputText.trim().length > 0 && readyState === ReadyState.OPEN) {
            sendMessage(inputText);
            // Optimistically add the message to the UI
            const newMessage = {
                id: `${Date.now()}`,
                text: inputText,
                sender: 'me',
            };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
            setInputText('');
        }
    };

    useEffect(() => {
        if (flatListRef.current) {
            flatListRef.current.scrollToEnd({ animated: true });
        }
    }, [messages]);

    const renderMessage = ({
        item,
    }: {
        item: { id: string; text: string; sender: string };
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
    );

    const connectionStatus = {
        [ReadyState.CONNECTING]: 'Connecting...',
        [ReadyState.OPEN]: 'Connected',
        [ReadyState.CLOSING]: 'Closing...',
        [ReadyState.CLOSED]: 'Disconnected',
        [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
    }[readyState];

    return (
        <ThemedView style={{ flex: 1 }}>
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
                        placeholder="Type a message..."
                        placeholderTextColor="#9BA1A6"
                    />
                    <TouchableOpacity
                        style={styles.sendButton}
                        onPress={handleSend}
                    >
                        <Text style={styles.sendButtonText}>Send</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </ThemedView>
    );
}
