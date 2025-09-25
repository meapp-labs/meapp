import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { sharedStyles } from './Message';

type SentMessageProps = {
    message: {
        index: string;
        fromOther: boolean;
        text: string;
        timestamp: string;
        prevTimestamp?: string;
    };
    time: string;
};

export function SentMessage({ message, time }: SentMessageProps) {
    return (
        <View
            style={[
                sharedStyles.messageGroupContainer,
                { alignSelf: 'flex-end' },
            ]}
        >
            <Text style={sharedStyles.time}>{time}</Text>
            <Text style={styles.sentMessageContainer}>{message.text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    sentMessageContainer: {
        backgroundColor: theme.colors.surface,
        borderBottomRightRadius: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: 20,
    },
});
