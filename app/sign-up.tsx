import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Button } from '@react-navigation/elements';
import { router } from 'expo-router';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';


export default function SignUpScreen() {

    const handleSignIn = () => {
        router.navigate('/sign-in');
    }

    const handleSignUp = () => {
        /*Sign up logic*/
        router.navigate('/sign-in');
    }

    return (
        <ThemedView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <SafeAreaView style={styles.container}>
                    <View style={styles.formContainer}>
                        <ThemedText type='title' style={{ marginBottom: 20 }}>
                            Create your account</ThemedText>
                        <TextInput style={styles.input} placeholder='Username' />
                        <TextInput style={styles.input} placeholder='E-mail' />
                        <TextInput style={styles.input} placeholder='Password' />
                        <TextInput style={styles.input} placeholder='Confirm Password' />
                        <Button style={styles.signUpButton} color='#007AFF' onPress={handleSignUp}>
                            Confirm</Button>  
                        <TouchableOpacity onPress={handleSignIn}>
                            <ThemedText style={{color:'#007aff', paddingTop: 10, fontSize:14}}>Sign in</ThemedText>
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
    signUpButton: {
        marginTop: 5,
        padding: 10,
    },
});