import { MaterialIcons } from '@expo/vector-icons'
import { TouchableOpacity } from 'react-native'

import { useLogoutUser } from '@/services/auth'
import { theme } from '@/theme/theme'

export function Logout() {
  const { mutate: logout } = useLogoutUser()
  return (
    <TouchableOpacity onPress={() => logout()}>
      <MaterialIcons name="logout" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  )
}
