import { theme } from '@/theme/theme';
import { Text } from './common/Text';
import { View, StyleSheet, Pressable } from 'react-native';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { removeOther } from '@/services/others';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryInit';
import { QueryKeys } from '@/lib/queryKeys';

type DeleteFriendProps = {
    friend: string;
    onClose: () => void;
};

export default function DeleteFriend({ friend, onClose }: DeleteFriendProps) {
    const { mutate, error, isError } = useMutation({
        mutationFn: () => {
            return removeOther(friend);
        },
        onSuccess: () => {
            queryClient.refetchQueries({
                queryKey: [QueryKeys.GET_OTHERS],
            });
        },
    });

    return (
        <View style={styles.container}>
            <Text style={styles.text}>Are you sure?</Text>
            <View style={styles.icons}>
                <Pressable
                    onPress={() => {
                        mutate();
                    }}
                >
                    <FontAwesome6
                        name="check-circle"
                        size={24}
                        color={theme.colors.success}
                    />
                </Pressable>
                <Pressable onPress={onClose}>
                    <FontAwesome6
                        name="xmark-circle"
                        size={24}
                        color={theme.colors.error}
                    />
                </Pressable>
            </View>
            {isError && `${error.message}`}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
    },
    text: {
        ...theme.typography.caption,
        color: theme.colors.warning,
    },
    icons: {
        alignItems: 'center',
        margin: theme.spacing.sm,
        flexDirection: 'row',
        gap: theme.spacing.md,
        backgroundColor: theme.colors.card,
        borderRadius: theme.spacing.lg,
    },
});
