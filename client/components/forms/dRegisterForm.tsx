import { TextInput, TouchableHighlight, View } from 'react-native';
import { theme } from '@/theme/theme';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/common/Text';
import { router } from 'expo-router';

export default function DRegisterForm() {
    const registerRoute = () => {
        router.replace('/dForm/dLogin');
    };

    return (
        <View style={styles.container}>
            <View style={styles.formContainer}>
                <Text style={styles.header}>Create a new account</Text>
                <View style={{ flexDirection: 'row' }}>
                    <Text>Already have an account? </Text>
                    <TouchableHighlight onPress={registerRoute}>
                        <Text style={{ color: theme.colors.secondary }}>
                            Sign in
                        </Text>
                    </TouchableHighlight>
                </View>
                <View style={styles.inputContainer}>
                    <Text>Username</Text>

                    <TextInput
                        style={styles.formInput}
                        placeholder="Enter username*"
                        placeholderTextColor={theme.colors.textSecondary}
                    />
                    <Text>Email</Text>
                    <TextInput
                        style={styles.formInput}
                        placeholder="Enter email*"
                        placeholderTextColor={theme.colors.textSecondary}
                    />
                    <Text>Password</Text>
                    <TextInput
                        secureTextEntry={true}
                        style={styles.formInput}
                        placeholder="Enter password*"
                        placeholderTextColor={theme.colors.textSecondary}
                    />

                    <TextInput
                        secureTextEntry={true}
                        style={styles.formInput}
                        placeholder="Confirm password*"
                        placeholderTextColor={theme.colors.textSecondary}
                    />
                    <TouchableOpacity style={styles.submitButton}>
                        <Text style={{ color: 'black', fontWeight: 'bold' }}>
                            Register
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: theme.colors.background,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    formContainer: {
        padding: theme.spacing.md,
        borderRadius: theme.spacing.sm,
        borderWidth: 1,
        borderColor: theme.colors.secondary,
    },
    submitButton: {
        marginTop: theme.spacing.md,
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.backgroundSecondary,
        borderRadius: theme.spacing.xs,
        alignItems: 'center',
    },
    formInput: {
        padding: theme.spacing.sm,
        borderWidth: 1,
        borderRadius: theme.spacing.xs,
        borderColor: theme.colors.borderSecondary,
        color: theme.colors.text,
    },
    header: {
        ...theme.typography.h1,
        fontWeight: 'bold',
    },
    inputContainer: {
        marginTop: theme.spacing.md,
        rowGap: theme.spacing.sm,
    },
});
