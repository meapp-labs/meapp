import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import styles from '@/styles';
import { Button } from '@react-navigation/elements';
import { Link, useRouter } from 'expo-router';
import { TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function SignUpScreen() {
    const router = useRouter();

    const handleSignUp = () => {
        /*Sign up logic*/
        router.navigate('/sign-in');
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
                            Create your account
                        </ThemedText>
                        <TextInput
                            style={styles.input}
                            placeholder="Username"
                        />
                        <TextInput style={styles.input} placeholder="E-mail" />
                        <TextInput
                            style={styles.input}
                            placeholder="Password"
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Confirm Password"
                        />
                        <Button
                            style={styles.signButton}
                            color="#007AFF"
                            onPress={handleSignUp}
                        >
                            Confirm
                        </Button>
                        <Link href="/sign-in" style={{ paddingTop: 10 }}>
                            <ThemedText
                                style={{ color: '#007aff', fontSize: 14 }}
                            >
                                Sign in
                            </ThemedText>
                        </Link>
                    </View>
                </SafeAreaView>
            </SafeAreaProvider>
        </ThemedView>
    );
}
