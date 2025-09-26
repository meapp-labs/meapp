import { theme } from '@/theme/theme';
import { TextInput, View, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
        <View style={{ flex: 1 }}>
            <View style={styles.container}>
                <TextInput
                    value={inputData}
                    placeholder="Enter username..."
                    placeholderTextColor={theme.colors.textSecondary}
                    style={styles.textInput}
                    onChangeText={setInputData}
                />

                <TouchableOpacity
                    style={styles.searchIcon}
                    onPress={() => {
                        handlePress(inputData, {
                            onSettled: () => {
                                setTimeout(() => reset(), 5000);
                            },
                        });
                    }}
                >
                    <MaterialIcons
                        name="search"
                        size={24}
                        color={theme.colors.text}
                    />
                </TouchableOpacity>
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
        padding: theme.spacing.md,
        borderRadius: theme.spacing.lg,
        flex: 1,
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
    searchIcon: {
        alignSelf: 'center',
        position: 'absolute',
        right: theme.spacing.md,
    },
});
