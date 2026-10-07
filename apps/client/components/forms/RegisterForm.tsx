import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { zodResolver } from '@hookform/resolvers/zod'
import { router } from 'expo-router'
import { useForm } from 'react-hook-form'
import { Pressable, StyleSheet, View } from 'react-native'
import Toast from 'react-native-toast-message'

import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { FormContainer } from '@/components/forms/FormContainer'
import { FormField } from '@/components/forms/FormInput'
import { useRegisterUser } from '@/services/auth'
import { theme } from '@/theme/theme'
import { RegisterSchema, type RegisterType } from '@meapp/shared'

export function RegisterForm() {
  const { mutate, isPending } = useRegisterUser()

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterType>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      username: '',
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = handleSubmit((data: RegisterType) =>
    mutate(data, {
      onSuccess: () => router.replace('/login'),
      onError(error) {
        Toast.show({
          type: 'error',
          text1: 'Registration Failed',
          text2: error.message,
        })
      },
    }),
  )

  return (
    <FormContainer>
      <View style={styles.brand}>
        <MaterialIcons name="chat-bubble-outline" size={25} color={theme.colors.primary} />
        <Text style={styles.brandName}>MeApp</Text>
      </View>
      <Text style={styles.header}>Make yourself at home.</Text>
      <Text style={styles.subtitle}>A little more connection starts right here.</Text>

      <View style={styles.accountLink}>
        <Text>Already have an account? </Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/login')}>
          <Text style={styles.link}>Sign in</Text>
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

        <FormField
          control={control}
          name="confirmPassword"
          label="Confirm Password"
          placeholder="Confirm password"
          error={errors.confirmPassword}
          isPassword
          editable={!isPending}
          onSubmitEditing={() => {
            void onSubmit()
          }}
        />
      </View>
      <Button
        title="Create account"
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
  inputContainer: {
    marginTop: 28,
    rowGap: 18,
    marginBottom: 24,
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.caption,
  },
})
