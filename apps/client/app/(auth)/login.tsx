import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { LoginForm } from '@/components/forms/LoginForm'
import { DocumentTitle } from '@/misc/DocumentTitle'
import { theme } from '@/theme/theme'

export default function LoginScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Login" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LoginForm />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    paddingVertical: 40,
  },
})
