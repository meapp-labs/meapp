import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { sharedStyles } from './Message';

type ReceivedMessageProps = {
    message: {
        index: string;
        fromOther: boolean;
        text: string;
        timestamp: string;
        prevTimestamp?: string;
    };
    time: string;
};

export function ReceivedMessage({ message, time }: ReceivedMessageProps) {
    return (
        <View style={sharedStyles.messageGroupContainer}>
            <MaterialIcons name="face" color={theme.colors.text} size={34} />
            <Text style={styles.receivedMessageContainer}>{message.text}</Text>
            <Text style={sharedStyles.time}>{time}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    receivedMessageContainer: {
        backgroundColor: theme.colors.card,
        borderBottomLeftRadius: theme.spacing.sm,
        borderRadius: 20,
        padding: theme.spacing.md,
    },
});
