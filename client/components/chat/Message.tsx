import { StyleSheet, View } from 'react-native';
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
        <View style={!message.fromOther && styles.container}>
            {!message.fromOther && (
                <MaterialIcons
                    name="face"
                    color={theme.colors.text}
                    size={34}
                />
            )}
            <View
                style={[
                    styles.messageContainer,
                    message.fromOther
                        ? styles.myMessageContainer
                        : styles.theirMessageContainer,
                ]}
                key={message.index}
            >
                <Text
                    style={message.fromOther ? styles.myMessageText : undefined}
                >
                    {message.text}
                </Text>
                <Text style={styles.timestamp}>{time}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    messageContainer: {
        borderRadius: 20,
        padding: 15,
        marginVertical: 5,
        maxWidth: '80%',
        marginHorizontal: theme.spacing.sm,
        flexDirection: 'row',
    },
    myMessageContainer: {
        backgroundColor: theme.colors.surface,
        alignSelf: 'flex-end',
        borderBottomRightRadius: theme.spacing.xs,
    },
    theirMessageContainer: {
        backgroundColor: theme.colors.card,
        alignSelf: 'flex-start',
        borderBottomLeftRadius: theme.spacing.sm,
    },
    myMessageText: {
        color: theme.colors.text,
    },
    timestamp: {
        ...theme.typography.caption,
        paddingLeft: theme.spacing.sm,
        textAlign: 'right',
        alignSelf: 'flex-end',
        color: 'gray',
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: theme.spacing.sm,
    },
});
