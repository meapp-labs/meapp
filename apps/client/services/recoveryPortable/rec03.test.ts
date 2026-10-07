import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { e2eSchemaSql } from '../e2eSchemaSql'
import { claimForSnapshot } from './contract'
import { NativeRecoveryAdapter, type NativeRecoveryDriver, type NativeRecoverySql } from './native'
import { rec01Snapshot } from './rec01.fixture'

function fixture() {
  const db = new Database(':memory:')
  db.exec(e2eSchemaSql.replaceAll('--> statement-breakpoint', ''))
  db.exec('PRAGMA user_version = 1')
  let previous: Promise<unknown> = Promise.resolve()
  const sql: NativeRecoverySql = {
    getFirstAsync: async <T>(query: string, ...params: (string | number | null)[]) =>
      db.query(query).get(...params) as T | null,
    getAllAsync: async <T>(query: string, ...params: (string | number | null)[]) =>
      db.query(query).all(...params) as T[],
    runAsync: async (query, ...params) => db.query(query).run(...params),
  }
  const driver: NativeRecoveryDriver = {
    transaction<T>(work: (connection: NativeRecoverySql) => Promise<T>): Promise<T> {
      const pending = previous
        .catch(() => undefined)
        .then(async () => {
          db.exec('BEGIN IMMEDIATE')
          try {
            const result = await work(sql)
            db.exec('COMMIT')
            return result
          } catch (error) {
            db.exec('ROLLBACK')
            throw error
          }
        })
      previous = pending
      return pending
    },
  }
  return { db, driver, sql }
}

test('native SQL adapter preserves portable identity, trust and history through repeated imports', async () => {
  const snapshot = rec01Snapshot()
  const first = fixture()
  const second = fixture()
  try {
    const claim = claimForSnapshot(snapshot, crypto.randomUUID())
    const adapter = new NativeRecoveryAdapter(snapshot.accountId, first.driver)
    await adapter.importSnapshot(snapshot, claim)
    expect(await adapter.readPendingClaim(snapshot.accountId)).toEqual(claim)
    await expect(
      adapter.exportSnapshot({
        accountId: snapshot.accountId,
        installId: claim.newInstallId,
        deviceId: 1,
        proof: snapshot.proof,
        createdAt: snapshot.createdAt,
      }),
    ).rejects.toThrow('pending')
    await expect(adapter.completePendingClaim({ ...claim, proof: 'q'.repeat(43) })).rejects.toThrow(
      'changed',
    )
    expect(
      await new NativeRecoveryAdapter(snapshot.accountId, first.driver).readPendingClaim(
        snapshot.accountId,
      ),
    ).toEqual(claim)
    await adapter.completePendingClaim(claim)
    const exported = await adapter.exportSnapshot({
      accountId: snapshot.accountId,
      installId: claim.newInstallId,
      deviceId: 1,
      proof: snapshot.proof,
      createdAt: snapshot.createdAt,
    })
    expect(exported).toEqual({ ...snapshot, sourceInstallId: claim.newInstallId })
    const nextClaim = claimForSnapshot(exported, crypto.randomUUID())
    const next = new NativeRecoveryAdapter(snapshot.accountId, second.driver)
    await next.importSnapshot(exported, nextClaim)
    await next.completePendingClaim(nextClaim)
    expect(
      await next.exportSnapshot({
        accountId: snapshot.accountId,
        installId: nextClaim.newInstallId,
        deviceId: 1,
        proof: snapshot.proof,
        createdAt: snapshot.createdAt,
      }),
    ).toEqual({ ...snapshot, sourceInstallId: nextClaim.newInstallId })
    await expect(adapter.importSnapshot(snapshot, claim)).rejects.toThrow('already has')
  } finally {
    first.db.close()
    second.db.close()
  }
})

test('native late SQL failure rolls back identity, history, binding and claim together', async () => {
  const snapshot = rec01Snapshot()
  const state = fixture()
  try {
    await state.sql.runAsync(
      'INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?)',
      'sentinel',
      'preserved',
      1,
    )
    const failedDriver: NativeRecoveryDriver = {
      transaction: (work) =>
        state.driver.transaction((connection) =>
          work({
            ...connection,
            runAsync: async (query, ...params) => {
              if (query.startsWith('INSERT INTO recipient_identities'))
                throw new Error('Injected SQL failure')
              return connection.runAsync(query, ...params)
            },
          }),
        ),
    }
    await expect(
      new NativeRecoveryAdapter(snapshot.accountId, failedDriver).importSnapshot(
        snapshot,
        claimForSnapshot(snapshot, crypto.randomUUID()),
      ),
    ).rejects.toThrow('SQL failure')
    expect(state.db.query('SELECT value FROM metadata WHERE key = ?').get('sentinel')).toEqual({
      value: 'preserved',
    })
    expect(state.db.query('SELECT count(*) AS count FROM identity_keys').get()).toEqual({
      count: 0,
    })
    expect(
      await new NativeRecoveryAdapter(snapshot.accountId, state.driver).readPendingClaim(
        snapshot.accountId,
      ),
    ).toBeNull()
  } finally {
    state.db.close()
  }
})

test('native validation rejects wrong-account, unsupported storage and competing imports', async () => {
  const snapshot = rec01Snapshot()
  const state = fixture()
  try {
    const adapter = new NativeRecoveryAdapter(snapshot.accountId, state.driver)
    const claim = claimForSnapshot(snapshot, crypto.randomUUID())
    await expect(
      adapter.importSnapshot({ ...snapshot, accountId: 'other' }, claim),
    ).rejects.toThrow('another account')
    state.db.exec('PRAGMA user_version = 2')
    await expect(adapter.importSnapshot(snapshot, claim)).rejects.toThrow('incompatible')
    state.db.exec('PRAGMA user_version = 1')
    const results = await Promise.allSettled([
      adapter.importSnapshot(snapshot, claim),
      adapter.importSnapshot(snapshot, claimForSnapshot(snapshot, crypto.randomUUID())),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  } finally {
    state.db.close()
  }
})
