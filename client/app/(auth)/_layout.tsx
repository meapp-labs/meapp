import { Stack } from 'expo-router';
import Toast from 'react-native-toast-message';

import { toastConfig } from '@/misc/toastConfig';

export default function AuthLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <Toast config={toastConfig} />
    </>
  );
}
