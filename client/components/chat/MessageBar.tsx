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
import { MessageData, useSendMessage } from '@/services/messages';
import MoreIcon from './MoreIcon';
import { usePressedStore } from '@/stores/pressedFriendStore';

export default function MessageBar({ refetch }: { refetch: () => void }) {
    const { pressed } = usePressedStore();
    const [inputData, setInputData] = useState('');
    const [showModal, setShowModal] = useState(false);

    const { mutate } = useSendMessage(() => refetch());

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
            <View style={styles.inputContainer}>
                <View style={styles.borderWrapper}>
                    <TextInput
                        style={styles.inputField}
                        value={inputData}
                        onChangeText={setInputData}
                        placeholder="Type a message..."
                        placeholderTextColor="#9BA1A6"
                        onSubmitEditing={handleSend}
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
        marginRight: theme.spacing.sm,
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
