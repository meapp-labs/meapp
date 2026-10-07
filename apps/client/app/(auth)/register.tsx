import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { RegisterForm } from '@/components/forms/RegisterForm'
import { DocumentTitle } from '@/misc/DocumentTitle'
import { theme } from '@/theme/theme'

export default function RegisterScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Register" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RegisterForm />
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
