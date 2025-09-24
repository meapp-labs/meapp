import { Dimensions, StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function Message(message: {
    index: string;
    fromOther: boolean;
    text: string;
    timestamp: string;
}) {
    const iso = message.timestamp;
    const date = new Date(iso);

    const time = new Intl.DateTimeFormat('default', {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);

    return (
        <View
            style={[
                styles.container,
                message.fromOther && { alignSelf: 'flex-end' },
            ]}
        >
            {!message.fromOther && (
                <MaterialIcons
                    name="face"
                    color={theme.colors.text}
                    size={34}
                />
            )}
            {message.fromOther && <Text style={styles.timestamp}>{time}</Text>}
            <View
                style={[
                    styles.messageContainer,
                    message.fromOther
                        ? styles.myMessageContainer
                        : styles.theirMessageContainer,
                ]}
                key={message.index}
            >
                <Text>{message.text}</Text>
            </View>
            {!message.fromOther && <Text style={styles.timestamp}>{time}</Text>}
        </View>
    );
}

const SCREEN_WIDTH = Dimensions.get('screen').width;

const styles = StyleSheet.create({
    messageContainer: {
        borderRadius: 20,
        padding: 15,
        marginTop: theme.spacing.xs,
        marginHorizontal: theme.spacing.sm,
        flexShrink: 1,
        maxWidth: SCREEN_WIDTH * 0.35,
    },
    myMessageContainer: {
        backgroundColor: theme.colors.surface,
        borderBottomRightRadius: theme.spacing.sm,
    },
    theirMessageContainer: {
        backgroundColor: theme.colors.card,
        borderBottomLeftRadius: theme.spacing.sm,
    },
    timestamp: {
        ...theme.typography.caption,
        alignSelf: 'center',
        color: 'gray',
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: theme.spacing.sm,
    },
});
