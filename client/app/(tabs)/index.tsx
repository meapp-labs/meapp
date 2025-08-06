import MessageList from '@/components/chat/MessageList';
import FriendsScreen from '@/components/FriendsScreen';
import Toolbar from '@/components/Toolbar';
import { logoutUser } from '@/services/auth';
import { getMessages } from '@/services/messages';
import { useAuthStore } from '@/stores/authStore';
import { theme } from '@/theme/theme';
import Button from '@/components/common/Button';
import { Text } from '@/components/common/Text';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    TextInput,
    TouchableOpacity,
    View,
    StyleSheet,
    SafeAreaView,
} from 'react-native';

export default function ChatScreen() {
    const router = useRouter();

    const {
        data: messages,
        isPending: messagesPending,
        isSuccess: messagesSuccess,
    } = useQuery({
        queryKey: ['messages'],
        queryFn: async () => await getMessages(),
    });

    const {
        mutate: logout,
        isError: logoutError,
        isPending: logoutPending,
        error,
    } = useMutation({
        mutationFn: logoutUser,
        onSuccess: () => {
            router.replace('/(auth)/login');
        },
    });

    const [inputText, setInputText] = useState('');

    const username = useAuthStore((state: any) => state.username);

    const handleSend = () => {
        if (inputText.trim().length > 0) {
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
                    <View
                        style={{
                            alignSelf: 'center',
                            flexDirection: 'row',
                            gap: 5,
                        }}
                    >
                        <Text>Current user:</Text>
                        <Text style={{ fontWeight: 'bold', color: 'lime' }}>
                            {username}
                        </Text>
                    </View>
                    {logoutPending && (
                        <Text style={{ textAlign: 'center' }}>
                            Just a second...
                        </Text>
                    )}
                    {logoutError && (
                        <Text style={{ textAlign: 'center' }}>
                            Error: {error.message}
                        </Text>
                    )}
                    <Button
                        style={{ margin: 10, borderRadius: 25 }}
                        variant="secondary"
                        title="Logout"
                        onPress={logout}
                    />
                </View>
            )}

            <View style={{ flex: 5 }}>
                {messagesPending ? (
                    <Text>loading</Text>
                ) : (
                    messagesSuccess && (
                        <MessageList username={username} messages={messages} />
                    )
                )}
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
