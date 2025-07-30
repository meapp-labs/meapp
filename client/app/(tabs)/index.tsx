import MessageList from '@/components/chat/MessageList';
import FriendsScreen from '@/components/FriendsScreen';
import Toolbar from '@/components/Toolbar';
import { useAuthStore } from '@/stores/authStore';
import { theme } from '@/theme/theme';
import { Button } from '@react-navigation/elements';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StyleSheet,
    SafeAreaView,
} from 'react-native';

export default function ChatScreen() {
    const [messages, setMessages] = useState<
        { id: string; text: string; sender: string }[]
    >([]);
    const [inputText, setInputText] = useState('');

    const username = useAuthStore((state: any) => state.username);

    const handleSend = () => {
        if (inputText.trim().length > 0) {
            const newMessage = {
                id: `${Date.now()}`,
                text: inputText,
                sender: 'me',
            };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
            setInputText('');
        }
    };

    return (
        <SafeAreaView
            style={[
                {
                    flex: 1,
                    flexDirection: 'row',
                    backgroundColor: theme.colors.background,
                },
            ]}
        >
            {Platform.OS === 'web' && (
                <View
                    style={{
                        flex: 1,
                        borderRightColor: '#2c2c2e',
                        borderRightWidth: 1,
                    }}
                >
                    <FriendsScreen />

                    <Button
                        style={{
                            margin: 10,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        onPress={() => router.navigate('/login')}
                    >
                        Logout
                    </Button>
                </View>
            )}

            <View style={{ flex: 5 }}>
                <MessageList username={username} messages={messages} />

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
                >
                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.messageInput}
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
            </View>
            <View>
                <Toolbar />
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
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
    messageInput: {
        flex: 1,
        backgroundColor: '#2C2C2E',
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 10,
        color: '#ffffff',
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
});
