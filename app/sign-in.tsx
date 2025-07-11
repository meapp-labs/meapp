import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import styles from '@/styles';
import { Button } from '@react-navigation/elements';
import { Link, useRouter } from 'expo-router';
import { TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function SignInScreen() {
    const router = useRouter();
    const handleSignIn = () => {
        /* Sign in logic*/
        router.navigate('/');
    };

    return (
        <ThemedView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <SafeAreaView
                    style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <View style={styles.formContainer}>
                        <ThemedText type="title" style={{ marginBottom: 20 }}>
                            Sign in to your account
                        </ThemedText>
                        <TextInput
                            style={styles.input}
                            placeholder="Username"
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Password"
                        />
                        <Button
                            style={styles.signButton}
                            color="#007AFF"
                            onPress={handleSignIn}
                        >
                            Confirm
                        </Button>
                        <Link href="/sign-up" style={{ paddingTop: 10 }}>
                            <ThemedText
                                style={{ color: '#007aff', fontSize: 14 }}
                            >
                                Sign up
                            </ThemedText>
                        </Link>
                    </View>
                </SafeAreaView>
            </SafeAreaProvider>
        </ThemedView>
    );
}
