import { expoStore, getDatabaseKeyManager } from '@open-e2ee/signal-protocol-sdk/local/store/expo'
import { configureSignalProtocolExpoDbBindings } from '@open-e2ee/signal-protocol-sdk/local/store/expo/db'
import * as signalSchema from '@open-e2ee/signal-protocol-sdk/local/store/expo/schema'
import { drizzle } from 'drizzle-orm/expo-sqlite'
import * as SQLite from 'expo-sqlite'

import { e2eSchemaSql } from './e2eSchemaSql'

let activeStore: { accountId: string; promise: ReturnType<typeof openStore> } | null = null
let activeDatabase: SQLite.SQLiteDatabase | null = null

async function openStore(accountId: string) {
  if (activeDatabase) {
    await activeDatabase.closeAsync()
    activeDatabase = null
  }
  const keyManager = getDatabaseKeyManager()
  await keyManager.initialize()
  const password = await keyManager.getPassword()
  const db = await SQLite.openDatabaseAsync(`meapp-e2e-${accountId}.db`)
  try {
    // getPassword() returns x'<64 hex digits>'; the syntax below sets SQLCipher's
    // raw 256-bit key. No user data is interpolated into this statement.
    await db.execAsync(`PRAGMA key = "${password}"`)
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master')
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
    if ((version?.user_version ?? 0) === 0) {
      await db.execAsync('BEGIN IMMEDIATE')
      try {
        await db.execAsync(e2eSchemaSql.replaceAll('--> statement-breakpoint', ''))
        await db.execAsync('PRAGMA user_version = 1')
        await db.execAsync('COMMIT')
      } catch (error) {
        await db.execAsync('ROLLBACK')
        throw error
      }
    }
    const drizzleDb = drizzle(db, { schema: signalSchema })
    configureSignalProtocolExpoDbBindings({
      getDrizzle: async () => drizzleDb,
      getRawDatabase: () => db,
    })
    activeDatabase = db
    return expoStore()
  } catch (error) {
    await db.closeAsync()
    throw error
  }
}

export const getE2EStore = (accountId: string) => {
  if (activeStore?.accountId !== accountId) {
    const previous = activeStore?.promise
    const promise = (async () => {
      await previous?.catch(() => undefined)
      return openStore(accountId)
    })().catch((error: unknown) => {
      if (activeStore?.promise === promise) activeStore = null
      throw error
    })
    activeStore = { accountId, promise }
  }
  return activeStore.promise
}
