import { theme } from '@/theme/theme';
import { TextInput, View, StyleSheet } from 'react-native';
import Button from '../common/Button';
import { Text } from '../common/Text';
import { useMutation } from '@tanstack/react-query';
import { addOther } from '@/services/others';
import { useState } from 'react';

export default function AddFriend() {
    const [inputData, setInputData] = useState('');

    const {
        mutate: handlePress,
        isError,
        isSuccess,
        error,
    } = useMutation({
        mutationFn: addOther,
        onSuccess: (data) => {
            console.log('Success: ', data);
            setInputData('');
        },
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
                    style={{ borderRadius: theme.spacing.lg }}
                    variant="secondary"
                    title="Add friend"
                    onPress={() => handlePress(inputData)}
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
    },
    response: {
        color: theme.colors.success,
        textAlign: 'center',
        ...theme.typography.caption,
    },
});
