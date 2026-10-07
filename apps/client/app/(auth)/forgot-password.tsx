import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { FormContainer } from '@/components/forms/FormContainer'
import { DocumentTitle } from '@/misc/DocumentTitle'
import { completePasswordReset, requestPasswordReset } from '@/services/accountRecovery'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [enterCode, setEnterCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')
  const run = async () => {
    setBusy(true)
    setMessage('')
    try {
      if (enterCode) {
        await completePasswordReset({ token: token.trim(), password, confirmPassword })
        setPassword('')
        setConfirmPassword('')
        setToken('')
        setDone(true)
        setMessage('Password reset. Sign in with your new password.')
      } else {
        const result = await requestPasswordReset({ email })
        setMessage(result.message)
        setEnterCode(true)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to recover account')
    } finally {
      setBusy(false)
    }
  }
  const inputStyle = {
    color: theme.colors.text,
    backgroundColor: theme.colors.backgroundSecondary,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    minHeight: 50,
    fontSize: 16,
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <DocumentTitle title="Recover account" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormContainer>
          <View style={{ gap: 18 }}>
            <View style={styles.brand}>
              <MaterialIcons name="chat-bubble-outline" size={25} color={theme.colors.primary} />
              <Text style={styles.brandName}>MeApp</Text>
            </View>
            <Text style={styles.heading}>
              {done
                ? 'You’re all set.'
                : enterCode
                  ? 'Check your inbox.'
                  : 'Let’s get you back in.'}
            </Text>
            <Text style={styles.description}>
              Use the email you verified in settings. Password recovery signs out existing sessions.
              Your encrypted history still needs your recovery key or original device.
            </Text>
            {!done &&
              (enterCode ? (
                <>
                  <TextInput
                    accessibilityLabel="Recovery code"
                    placeholderTextColor={theme.colors.textTertiary}
                    editable={!busy}
                    placeholder="Recovery code from email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={token}
                    onChangeText={setToken}
                    style={inputStyle}
                  />
                  <TextInput
                    accessibilityLabel="New password"
                    placeholderTextColor={theme.colors.textTertiary}
                    editable={!busy}
                    placeholder="New password"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    style={inputStyle}
                  />
                  <TextInput
                    accessibilityLabel="Confirm new password"
                    placeholderTextColor={theme.colors.textTertiary}
                    editable={!busy}
                    placeholder="Confirm new password"
                    secureTextEntry
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    style={inputStyle}
                  />
                </>
              ) : (
                <TextInput
                  accessibilityLabel="Verified email"
                  placeholderTextColor={theme.colors.textTertiary}
                  editable={!busy}
                  placeholder="Verified email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  style={inputStyle}
                />
              ))}
            {!done && (
              <Button
                title={enterCode ? 'Reset password' : 'Send recovery code'}
                loading={busy}
                size="large"
                onPress={() => {
                  void run()
                }}
              />
            )}
            {!done && (
              <Button
                title={enterCode ? 'Request another code' : 'Enter recovery code'}
                disabled={busy}
                variant="outline"
                onPress={() => {
                  setEnterCode(!enterCode)
                  setMessage('')
                }}
              />
            )}
            {!!message && (
              <Text style={styles.description} accessibilityLiveRegion="polite">
                {message}
              </Text>
            )}
            <Button
              title="Back to sign in"
              variant="outline"
              onPress={() => router.replace('/login')}
            />
          </View>
        </FormContainer>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingVertical: 40,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  brandName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8 },
  description: { color: theme.colors.textSecondary, lineHeight: 24, fontSize: 14 },
})
