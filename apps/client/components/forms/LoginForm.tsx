import { MaterialIcons } from '@expo/vector-icons'
import { zodResolver } from '@hookform/resolvers/zod'
import { router } from 'expo-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Pressable, StyleSheet, View } from 'react-native'
import Toast from 'react-native-toast-message'

import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { FormContainer } from '@/components/forms/FormContainer'
import { FormField } from '@/components/forms/FormInput'
import { AuthStorage } from '@/lib/authStorage'
import { queryClient } from '@/lib/queryInit'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useLoginUser } from '@/services/auth'
import { resetE2EContext } from '@/services/e2e'
import { ConversationStorage, RememberMeStorage } from '@/services/storage'
import { theme } from '@/theme/theme'
import { LoginSchema, type LoginType } from '@meapp/shared'

export function LoginForm() {
  const setUsername = useAuthStore((state) => state.setUsername)
  const { mutate, isPending } = useLoginUser()
  const [rememberMe, setRememberMe] = useState(false)

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginType>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  })

  const onSubmit = handleSubmit((data: LoginType) => {
    mutate(
      { ...data, rememberMe },
      {
        onSuccess: async (res) => {
          if (useAuthStore.getState().username !== data.username) {
            resetE2EContext()
            queryClient.clear()
            useConversationStore.getState().setSelectedConversationId(null)
            await ConversationStorage.clear()
          }

          if (typeof res === 'object' && res && 'token' in res) {
            await AuthStorage.setToken(res.token, rememberMe)
          }

          if (rememberMe) {
            await RememberMeStorage.save()
          } else {
            await RememberMeStorage.clear()
          }

          setUsername(data.username)
          router.replace('/')
        },
        onError(error) {
          Toast.show({
            type: 'error',
            text1: 'Login Failed',
            text2: error.message,
          })
        },
      },
    )
  })

  return (
    <FormContainer>
      <View style={styles.brand}>
        <MaterialIcons name="chat-bubble-outline" size={25} color={theme.colors.primary} />
        <Text style={styles.brandName}>MeApp</Text>
      </View>
      <Text style={styles.header}>Welcome back.</Text>
      <Text style={styles.subtitle}>Your people. Your conversations. Your space.</Text>

      <View style={styles.accountLink}>
        <Text>Don&apos;t have an account? </Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/register')}>
          <Text style={styles.link}>Sign up</Text>
        </Pressable>
      </View>

      <View style={styles.inputContainer}>
        <FormField
          control={control}
          name="username"
          label="Username"
          placeholder="Enter username"
          error={errors.username}
          editable={!isPending}
          onSubmitEditing={() => {
            void onSubmit()
          }}
        />
        <FormField
          control={control}
          name="password"
          label="Password"
          placeholder="Enter password"
          error={errors.password}
          isPassword
          editable={!isPending}
          onSubmitEditing={() => {
            void onSubmit()
          }}
        />
        <View style={styles.container}>
          <Pressable
            accessibilityRole="checkbox"
            aria-checked={rememberMe}
            accessibilityState={{ checked: rememberMe }}
            accessibilityLabel="Remember me"
            disabled={isPending}
            style={styles.optionTouch}
            onPress={() => setRememberMe(!rememberMe)}
          >
            <View style={styles.checkboxContainer}>
              <MaterialIcons
                name={rememberMe ? 'check-box' : 'check-box-outline-blank'}
                size={22}
                color={rememberMe ? theme.colors.primary : theme.colors.textSecondary}
              />
              <Text selectable={false}>Remember me</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            style={styles.optionTouch}
            onPress={() => router.push('/forgot-password')}
          >
            <Text selectable={false} style={styles.link}>
              Forgot password?
            </Text>
          </Pressable>
        </View>
      </View>

      <Button
        title="Sign in"
        onPress={() => {
          void onSubmit()
        }}
        loading={isPending}
        variant="primary"
        size="large"
      />
    </FormContainer>
  )
}

const styles = StyleSheet.create({
  header: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 32 },
  brandName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textSecondary, lineHeight: 24, marginTop: 8 },
  accountLink: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 16 },
  link: { color: theme.colors.primary, fontWeight: '600', fontSize: 14 },
  optionTouch: { minHeight: 44, justifyContent: 'center' },
  inputContainer: {
    marginTop: 28,
    marginBottom: 20,
    rowGap: 18,
  },
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
    alignItems: 'center',
  },
  checkboxContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
})
