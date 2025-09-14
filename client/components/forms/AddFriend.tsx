import { theme } from '@/theme/theme';
import { TextInput, View, StyleSheet } from 'react-native';
import Button from '../common/Button';
import { Text } from '../common/Text';
import { useAddFriend } from '@/services/others';
import { useState } from 'react';
import { queryClient } from '@/lib/queryInit';
import { Keys } from '@/lib/keys';

export default function AddFriend() {
    const [inputData, setInputData] = useState('');

    const {
        mutate: handlePress,
        isError,
        isSuccess,
        error,
        reset,
    } = useAddFriend({
        onSuccess: () =>
            queryClient.refetchQueries({ queryKey: [Keys.Query.GET_FRIENDS] }),
    });

    return (
        <View>
            <View style={styles.container}>
                <TextInput
                    value={inputData}
                    placeholder="Enter username..."
                    placeholderTextColor={theme.colors.textSecondary}
                    style={styles.textInput}
                    onChangeText={setInputData}
                />
                <Button
                    style={styles.addButton}
                    variant="secondary"
                    title="Add friend"
                    onPress={() => {
                        handlePress(inputData, {
                            onSettled: () => {
                                setTimeout(() => reset(), 5000);
                            },
                        });
                    }}
                />
            </View>

            {isError && (
                <Text style={[styles.response, { color: theme.colors.error }]}>
                    {`${error.message}`}
                </Text>
            )}
            {isSuccess && (
                <Text
                    style={[styles.response, { color: theme.colors.success }]}
                >
                    Contact successfully added.
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.spacing.sm,
        justifyContent: 'center',
        marginVertical: theme.spacing.md,
        marginHorizontal: theme.spacing.sm,
    },
    responseContainer: {
        justifyContent: 'center',
        alignContent: 'center',
        marginVertical: theme.spacing.sm,
    },
    textInput: {
        color: theme.colors.text,
        backgroundColor: theme.colors.card,
        padding: theme.spacing.sm,
        borderRadius: theme.spacing.sm,
        flexGrow: 1,
    },
    response: {
        color: theme.colors.success,
        textAlign: 'center',
        ...theme.typography.caption,
        paddingBottom: theme.spacing.xs,
    },
    addButton: {
        borderRadius: theme.spacing.sm,
        padding: theme.spacing.sm,
    },
});
