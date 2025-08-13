import { TextInput, TouchableHighlight, View } from 'react-native';
import { theme } from '@/theme/theme';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../common/Text';
import { router } from 'expo-router';

export default function DLoginForm() {
    const registerRoute = () => {
        router.replace('/dForm/dRegister');
    };

    return (
        <View style={styles.container}>
            <View style={styles.formContainer}>
                <Text style={styles.header}>Login to your account</Text>
                <View style={{ flexDirection: 'row' }}>
                    <Text>Don't have an account? </Text>
                    <TouchableHighlight onPress={registerRoute}>
                        <Text style={{ color: theme.colors.secondary }}>
                            Sign up
                        </Text>
                    </TouchableHighlight>
                </View>
                <View style={styles.inputContainer}>
                    <Text>Username</Text>

                    <TextInput
                        style={styles.formInput}
                        placeholder="Enter username"
                        placeholderTextColor={'#959595'}
                    />
                    <Text>Password</Text>
                    <TextInput
                        secureTextEntry={true}
                        style={styles.formInput}
                        placeholder="Enter password"
                        placeholderTextColor={'#959595'}
                    />
                    <TouchableOpacity style={styles.submitButton}>
                        <Text style={{ color: 'black', fontWeight: 'bold' }}>
                            Login
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
