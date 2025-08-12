import {
    KeyboardAvoidingView,
    Platform,
    TextInput,
    StyleSheet,
    View,
} from 'react-native';
import { useState } from 'react';
import { theme } from '@/theme/theme';
import Button from '../common/Button';
import { useMutation } from '@tanstack/react-query';
import { MessageData, sendMessage } from '@/services/messages';
import { useAuthStore } from '@/stores/authStore';

export default function MessageBar() {
    const { username } = useAuthStore();
    const [inputData, setInputData] = useState('');

    //////////////////
    //not fully working, gives 401
    const { mutate } = useMutation({
        mutationFn: (messageData: MessageData) => {
            return sendMessage(messageData);
        },
        onSuccess: (data) => {
            console.log('Success:', data.message);
        },
        onError: (error: any) => {
            console.log('Error:', error.message);
        },
    });

    const handleSend = () => {
        if (inputData.trim().length > 0) {
            const messageData: MessageData = {
                from: username,
                text: inputData,
            };
            mutate(messageData);
            setInputData('');
        }
    };
    //////////////////

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.inputField}
                    value={inputData}
                    onChangeText={setInputData}
                    placeholder="Type a message..."
                    placeholderTextColor="#9BA1A6"
                />
                <Button variant="secondary" title="Send" onPress={handleSend} />
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    inputContainer: {
        gap: theme.spacing.sm,
        marginVertical: theme.spacing.sm,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    inputField: {
        backgroundColor: theme.colors.surface,
        padding: theme.spacing.md,
        borderRadius: theme.spacing.sm,
        color: theme.colors.text,
        width: '100%',
    },
    sendButton: {
        padding: theme.spacing.md,
        alignSelf: 'center',
        backgroundColor: theme.colors.secondary,
        borderRadius: theme.spacing.sm,
    },
});
