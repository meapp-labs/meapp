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
import MoreIcon from './MoreIcon';

export default function MessageBar() {
    const [inputData, setInputData] = useState('');
    const [showModal, setShowModal] = useState(false);

    const { mutate } = useMutation({
        mutationFn: (messageData: MessageData) => {
            return sendMessage(messageData);
        },
        onSuccess: (data) => {
            console.log('Success:', data);
        },
        onError: (error: any) => {
            console.log('Error:', error.message);
        },
    });

    const handleSend = () => {
        if (inputData.trim().length > 0) {
            const messageData: MessageData = {
                to: 'dawid', // hardcoded, later pick from list of others
                text: inputData,
            };
            mutate(messageData);
            setInputData('');
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
            <View style={styles.inputContainer}>
                <View style={styles.borderWrapper}>
                    <TextInput
                        style={styles.inputField}
                        value={inputData}
                        onChangeText={setInputData}
                        placeholder="Type a message..."
                        placeholderTextColor="#9BA1A6"
                    />
                    <View style={styles.moreIcon}>
                        <MoreIcon
                            showModal={showModal}
                            setShowModal={setShowModal}
                        />
                    </View>
                </View>
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
        flex: 1,
        padding: theme.spacing.md,
        color: theme.colors.text,
        width: '100%',
        borderRadius: theme.spacing.sm,
    },
    sendButton: {
        padding: theme.spacing.md,
        alignSelf: 'center',
        backgroundColor: theme.colors.secondary,
        borderRadius: theme.spacing.sm,
    },
    borderWrapper: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
        borderRadius: theme.spacing.sm,
        alignItems: 'center',
        position: 'relative',
    },
    moreIcon: {
        position: 'absolute',
        right: theme.spacing.md,
    },
});
