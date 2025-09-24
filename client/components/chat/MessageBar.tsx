import {
    KeyboardAvoidingView,
    Platform,
    TextInput,
    StyleSheet,
    View,
    TouchableOpacity,
} from 'react-native';
import { useState } from 'react';
import { theme } from '@/theme/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { MessageData, useSendMessage } from '@/services/messages';
import Attachment from '@/components/chat/Attachment';
import { usePressedStore } from '@/stores/pressedFriendStore';

export default function MessageBar({ refetch }: { refetch: () => void }) {
    const { pressed } = usePressedStore();
    const [inputData, setInputData] = useState('');
    const [showModal, setShowModal] = useState(false);

    const { mutate } = useSendMessage({ onSuccess: refetch });

    const handleSend = () => {
        if (inputData.trim().length > 0) {
            const messageData: MessageData = {
                to: `${pressed?.name}`,
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
            <View style={styles.container}>
                <View style={styles.attachment}>
                    <Attachment
                        showModal={showModal}
                        setShowModal={setShowModal}
                    />
                </View>
                <TextInput
                    style={styles.inputField}
                    value={inputData}
                    placeholder="Type a message..."
                    placeholderTextColor="#9BA1A6"
                    onChangeText={setInputData}
                    onSubmitEditing={handleSend}
                />
                <TouchableOpacity style={styles.send} onPress={handleSend}>
                    <MaterialIcons
                        name="send"
                        size={24}
                        color={theme.colors.text}
                    />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        marginHorizontal: theme.spacing.sm,
        marginTop: theme.spacing.sm,
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
});
