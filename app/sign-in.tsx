import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Button } from '@react-navigation/elements';
import { router } from 'expo-router';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';


export default function SignInScreen() {

    const handleSignIn = () => {
        /* Sign in logic*/
        router.navigate('/');
    }

    const handleSignUp = () => {
        router.navigate('/sign-up');
    }

    return (
        <ThemedView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <SafeAreaView style={styles.container}>
                    <View style={styles.formContainer}>
                        <ThemedText type='title' style={{ marginBottom: 20 }}>
                            Sign in to your account</ThemedText>
                        <TextInput style={styles.input} placeholder='Username' />
                        <TextInput style={styles.input} placeholder='Password' />
                        <Button style={styles.signInButton} color='#007AFF' onPress={handleSignIn}>
                            Sign in
                        </Button>
                        <TouchableOpacity onPress={handleSignUp}>
                            <ThemedText style={{color:'#007aff', paddingTop: 10, fontSize:14}}>Sign up</ThemedText>
                            </TouchableOpacity>
                    </View>
                </SafeAreaView>
            </SafeAreaProvider>
        </ThemedView>
    );
} 

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center'
    },
    formContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        borderStartWidth: 1,
        borderEndWidth: 1,
        borderColor: '#2c2c2e',
        borderRadius: 25,
        paddingHorizontal: 20,
        paddingVertical: 25
    },
    input: {
        color: '#fff',
        padding: 15,
        marginBottom: 15,
        borderRadius: 10,
        backgroundColor: '#2C2C2E'
    },
    signInButton: {
        marginTop: 5,
        padding: 10,
    },
});