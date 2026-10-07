import type { UserRecord } from '@open-e2ee/signal-protocol-sdk'
import { IndexedDbSignalProtocolStore } from '@open-e2ee/signal-protocol-sdk/local/store/web'
import type { IDBPDatabase } from 'idb'

/** SDK 6.0.0's SESAME adapter omits the lossless codec used by its session store. */
export class MeappIndexedDbStore extends IndexedDbSignalProtocolStore {
  override async setUserRecord(userId: string, record: UserRecord): Promise<void> {
    const json = JSON.stringify({ meappSesameVersion: 1, record }, (_key, value: unknown) => {
      if (typeof value === 'bigint') return { meappType: 'bigint', value: value.toString() }
      if (value instanceof Uint8Array) return { meappType: 'bytes', value: Array.from(value) }
      if (value instanceof Map) return { meappType: 'map', value: Array.from(value.entries()) }
      return value
    })
    const data = (await Reflect.get(this, 'encrypt').call(this, json)) as Uint8Array
    const db = Reflect.get(this, 'db') as IDBPDatabase
    await db.put('sesameUsers', { key: userId, data, updatedAt: Date.now() })
  }

  override async getUserRecord(userId: string): Promise<UserRecord | null> {
    const db = Reflect.get(this, 'db') as IDBPDatabase
    const row = await db.get('sesameUsers', userId)
    if (!row) return null
    const json = (await Reflect.get(this, 'decrypt').call(this, row.data)) as string
    const data = JSON.parse(json, (_key, value) => {
      if (value?.meappType === 'bigint') {
        if (typeof value.value !== 'string' || !/^-?\d+$/.test(value.value))
          throw new Error('Invalid stored integer')
        return BigInt(value.value)
      }
      if (value?.meappType === 'bytes') {
        if (
          !Array.isArray(value.value) ||
          value.value.some(
            (part: unknown) => !Number.isInteger(part) || Number(part) < 0 || Number(part) > 255,
          )
        )
          throw new Error('Invalid stored bytes')
        return Uint8Array.from(value.value)
      }
      if (value?.meappType === 'map') {
        if (
          !Array.isArray(value.value) ||
          value.value.some((part: unknown) => !Array.isArray(part) || part.length !== 2)
        )
          throw new Error('Invalid stored map')
        return new Map(value.value)
      }
      return value
    })
    if (data.meappSesameVersion === undefined) return super.getUserRecord(userId)
    if (
      data.meappSesameVersion !== 1 ||
      !(data.record?.devices instanceof Map) ||
      data.record.userId !== userId
    )
      throw new Error('Incompatible device session record')
    return data.record as UserRecord
  }
}
