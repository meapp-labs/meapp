import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { completePasswordReset, requestPasswordReset } from '@/services/accountRecovery'
import { theme } from '@/theme/theme'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
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
    borderColor: theme.colors.secondary,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 480, gap: 16 }}>
          <Text style={theme.typography.h2}>Recover account access</Text>
          <Text>
            Use the email you verified in settings. Password recovery signs out existing sessions.
            Your encrypted history still needs your recovery key or original device.
          </Text>
          {!done &&
            (enterCode ? (
              <>
                <TextInput
                  accessibilityLabel="Recovery code"
                  placeholder="Recovery code from email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={token}
                  onChangeText={setToken}
                  style={inputStyle}
                />
                <TextInput
                  accessibilityLabel="New password"
                  placeholder="New password"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  style={inputStyle}
                />
                <TextInput
                  accessibilityLabel="Confirm new password"
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
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          <Button
            title="Back to sign in"
            variant="outline"
            onPress={() => router.replace('/login')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
