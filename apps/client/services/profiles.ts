import { getFetcher, postFetcher } from '@/lib/api'
import { usePollingInterval } from '@/lib/polling'
import { useAuthStore } from '@/lib/stores'
import {
  type Profile,
  contactAliasesSchema,
  editProfileSchema,
  encryptedAliasSchema,
  profileSchema,
} from '@meapp/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  aesDecryptAsync,
  aesEncryptAsync,
  digest,
} from 'expo-crypto'
import { type AliasCrypto, openAlias, sealAlias } from './aliasCodec'
import { getE2EContext } from './e2e'

export function base64(bytes: Uint8Array) {
  let value = ''
  for (let i = 0; i < bytes.length; i++) value += String.fromCharCode(bytes[i] ?? 0)
  return btoa(value)
}

// Provisioned devices share the account identity; secrets never go to the server.
// Domain separation keeps alias encryption independent of Signal protocol keys.
async function aliasSecret(ownerId: string) {
  const context = await getE2EContext()
  if (context.userId !== ownerId) throw new Error('Account changed')
  const identity = await context.storage.getIdentityKey('aci')
  if (!identity) throw new Error('Link this device to access encrypted aliases')
  return identity.dhKey.privateKey
}

const aliasCrypto: AliasCrypto = {
  hash: async (bytes) =>
    new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))),
  seal: async (bytes, key) =>
    (await aesEncryptAsync(bytes, await AESEncryptionKey.import(key))).combined('base64'),
  open: async (ciphertext, key) =>
    aesDecryptAsync(AESSealedData.fromCombined(ciphertext), await AESEncryptionKey.import(key)),
}

export function useOwnProfile() {
  const pollInterval = usePollingInterval(60_000)
  const account = useAuthStore((s) => s.username)
  return useQuery({
    queryKey: ['profiles', account, 'self'],
    queryFn: async () => profileSchema.parse(await getFetcher('profile')),
    enabled: !!account,
    refetchInterval: pollInterval,
  })
}

export function useProfile(value: string, byId = false) {
  const pollInterval = usePollingInterval(60_000)
  const account = useAuthStore((s) => s.username)
  return useQuery({
    queryKey: ['profiles', account, byId ? 'id' : 'username', value],
    enabled: !!account && !!value,
    queryFn: async () =>
      profileSchema.parse(
        await getFetcher(
          byId ? `profiles/${value}` : 'profiles',
          byId ? undefined : { username: value },
        ),
      ),
    refetchInterval: pollInterval,
  })
}

export function useAliases() {
  const pollInterval = usePollingInterval(30_000)
  const own = useOwnProfile()
  return useQuery({
    queryKey: ['aliases', own.data?.id],
    enabled: !!own.data?.id,
    refetchInterval: pollInterval,
    queryFn: async () => {
      const ownerId = own.data?.id
      if (!ownerId) throw new Error('Sign in to load aliases')
      const rows = contactAliasesSchema.parse(await getFetcher('contact-aliases'))
      if (!rows.some((row) => row.ciphertext)) return rows.map((row) => ({ ...row, alias: null }))
      const secret = await aliasSecret(ownerId)
      return Promise.all(
        rows.map(async (raw) => {
          const row = { contactId: raw.contactId, ...encryptedAliasSchema.parse(raw) }
          if (!row.ciphertext) return { ...row, alias: null }
          return {
            ...row,
            alias: await openAlias(aliasCrypto, ownerId, row.contactId, secret, row.ciphertext),
          }
        }),
      )
    },
  })
}

export function useContactPresentation(usernameOrId: string, byId = false) {
  const profile = useProfile(usernameOrId, byId)
  const aliases = useAliases()
  const alias = aliases.data?.find((row) => row.contactId === profile.data?.id)
  return {
    profile: profile.data,
    alias,
    name: alias?.alias || profile.data?.displayName || usernameOrId,
    aliasError: aliases.error,
  }
}

export function useEditAlias() {
  const client = useQueryClient()
  const own = useOwnProfile()
  const account = useAuthStore((s) => s.username)
  return useMutation({
    mutationFn: async ({
      contactId,
      revision,
      alias,
    }: { contactId: string; revision: number; alias: string }) => {
      const ownerId = own.data?.id
      if (!ownerId) throw new Error('Sign in first')
      const ciphertext = await sealAlias(
        aliasCrypto,
        ownerId,
        contactId,
        await aliasSecret(ownerId),
        alias,
      )
      if (useAuthStore.getState().username !== account) throw new Error('Account changed')
      return postFetcher(`contact-aliases/${contactId}`, {
        revision,
        ciphertext,
      })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['aliases'] })
    },
  })
}

export function useEditProfile() {
  const client = useQueryClient()
  const account = useAuthStore((s) => s.username)
  return useMutation({
    mutationFn: async (
      action: { displayName: string } | { image: string } | { removeAvatar: true },
    ) => {
      if (useAuthStore.getState().username !== account) throw new Error('Account changed')
      const path =
        'image' in action
          ? 'profile/avatar'
          : 'removeAvatar' in action
            ? 'profile/avatar/remove'
            : 'profile'
      return profileSchema.parse(
        await postFetcher(
          path,
          'displayName' in action
            ? editProfileSchema.parse(action)
            : 'image' in action
              ? action
              : undefined,
        ),
      )
    },
    onSuccess: (profile: Profile) => {
      if (useAuthStore.getState().username !== account) return
      client.setQueryData(['profiles', account, 'self'], profile)
      client.setQueryData(['profiles', account, 'username', profile.username], profile)
      client.setQueryData(['profiles', account, 'id', profile.id], profile)
      void client.invalidateQueries({ queryKey: ['profiles'] })
      void client.invalidateQueries({ queryKey: ['rooms'] })
    },
  })
}
