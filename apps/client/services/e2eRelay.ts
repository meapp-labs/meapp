import type { SignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay'
import { Platform } from 'react-native'

import { getFetcher, postFetcher } from '@/lib/api'

type Relay = SignalProtocolRelayServer
type Identity = NonNullable<Awaited<ReturnType<Relay['getIdentityKey']>>>
type Bundle = NonNullable<Awaited<ReturnType<Relay['fetchPreKeyBundle']>>>
type Inventory = Awaited<ReturnType<Relay['getPreKeyInventory']>>
type Devices = Awaited<ReturnType<Relay['getDevices']>>

/** Maps the SDK's public-key operations onto MeApp's authenticated relay. */
export function createMeappRelay(userId: string, installId: string, localDeviceId = 1): Relay {
  const own = (requestedUserId: string) => {
    if (requestedUserId !== userId) throw new Error('Relay operation targeted a different account')
  }
  const ownDevice = (requestedUserId: string, deviceId: number) => {
    own(requestedUserId)
    if (deviceId !== localDeviceId) throw new Error('Relay operation targeted another device')
  }
  const aci = (identityType?: 'aci' | 'pni') => {
    if (identityType && identityType !== 'aci')
      throw new Error('Phone-number identities are not supported')
  }

  const relay: Partial<Relay> = {
    relayConnectionState: { state: 'stopped', since: Date.now() },
    subscribeRelayConnectionState: () => () => {},
    registerDevice: async (requestedUserId, device) => {
      own(requestedUserId)
      if (device.deviceId !== undefined && device.deviceId !== localDeviceId)
        throw new Error('Relay registration has the wrong device ID')
      const registered = await postFetcher<{ deviceId: number }>('e2e/relay/register', {
        installId,
        platform: Platform.OS,
      })
      if (registered.deviceId !== localDeviceId)
        throw new Error('Server device ID differs from locally provisioned ID')
      return registered.deviceId
    },
    provisionIdentityKey: async (request) => {
      ownDevice(request.userId, request.deviceId)
      aci(request.identityType)
      await postFetcher('e2e/relay/identity', {
        installId,
        identity: request.identity,
        registrationId: request.registrationId,
      })
    },
    getIdentityKey: async (requestedUserId, identityType) => {
      aci(identityType)
      return getFetcher<Identity | null>('e2e/relay/identity', { userId: requestedUserId })
    },
    getPreKeyInventory: async (requestedUserId, deviceId, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      return getFetcher<Inventory>('e2e/relay/inventory', { installId })
    },
    getPreKeyCount: async (requestedUserId, deviceId, type, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      const inventory = await getFetcher<Inventory>('e2e/relay/inventory', { installId })
      return type === 'ec' ? inventory.ecOneTimePreKeyCount : inventory.kemOneTimePreKeyCount
    },
    getEcSignedPreKeyMetadata: async (requestedUserId, deviceId, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      const inventory = await getFetcher<Inventory>('e2e/relay/inventory', { installId })
      return inventory.ecSignedPreKey
    },
    getKemLastResortPreKeyMetadata: async (requestedUserId, deviceId, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      const inventory = await getFetcher<Inventory>('e2e/relay/inventory', { installId })
      return inventory.kemLastResortPreKey
    },
    uploadPreKeys: async (requestedUserId, deviceId, keys, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      await postFetcher('e2e/relay/prekeys', { installId, keys })
    },
    publishPlannedPreKeys: async (requestedUserId, deviceId, plan, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      const inventory = await getFetcher<Inventory>('e2e/relay/inventory', { installId })
      const keys = await plan(inventory)
      if (keys.length) await postFetcher('e2e/relay/prekeys', { installId, keys })
    },
    clearStaleKemPreKeys: async (requestedUserId, deviceId, identityType) => {
      ownDevice(requestedUserId, deviceId)
      aci(identityType)
      return postFetcher<{ cleared: number }>('e2e/relay/clear-stale-kem', { installId })
    },
    getDevices: async (requestedUserId) =>
      getFetcher<Devices>('e2e/relay/devices', { userId: requestedUserId }),
    getActiveDevices: async (requestedUserId) => {
      const devices = await getFetcher<Devices>('e2e/relay/devices', { userId: requestedUserId })
      return devices
        .filter((d) => d.enabled)
        .map((d) => ({ userId: requestedUserId, deviceId: d.deviceId }))
    },
    fetchPreKeyBundle: async (requestedUserId, deviceId, _fetcherUserId, identityType) => {
      aci(identityType)
      return postFetcher<Bundle | null>('e2e/relay/bundle', { userId: requestedUserId, deviceId })
    },
    createProvisioningSession: async (requestedUserId, ephemeralPublicKey) => {
      own(requestedUserId)
      return postFetcher<{ sessionId: string }>('e2e/link/start', { installId, ephemeralPublicKey })
    },
    connectNewDevice: async (sessionId, ephemeralPublicKey, metadata) => {
      await postFetcher('e2e/link/connect', {
        sessionId,
        installId,
        ephemeralPublicKey,
        platform: Platform.OS,
        ...metadata,
      })
    },
    sendProvisioningMessage: async (sessionId, encryptedMessage, requestedUserId) => {
      if (requestedUserId) own(requestedUserId)
      await postFetcher('e2e/link/send', { sessionId, installId, encryptedMessage })
    },
    getProvisioningMessage: async (sessionId) => {
      const status = await getFetcher<{
        status: 'waiting' | 'connected' | 'ready' | 'linked_pending_ack' | 'completed'
        encryptedMessage: string | null
        expiresAt: number
      }>('e2e/link/status', { sessionId, installId })
      return {
        status: status.status,
        message: status.encryptedMessage,
        expiresAt: status.expiresAt,
      }
    },
    completeProvisioning: async (sessionId) =>
      postFetcher<{ deviceId: number }>('e2e/link/complete', { sessionId, installId }),
    acknowledgeProvisioning: async (sessionId) => {
      await postFetcher('e2e/link/ack', { sessionId, installId })
    },
    rollbackProvisioning: async (sessionId) => {
      await postFetcher('e2e/link/cancel', { sessionId, installId })
    },
    deleteProvisioningSession: async (sessionId) => {
      await postFetcher('e2e/link/cancel', { sessionId, installId })
    },
  }
  // The app uses direct-device encrypt/decrypt. The SDK's group and mailbox
  // methods are intentionally unreachable: MeApp sends one envelope to each
  // room member through its own authenticated message endpoint.
  return relay as Relay
}
