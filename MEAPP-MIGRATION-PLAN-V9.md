# MeApp V9 FINAL - With E2E (Phase 10) - Corrected Numbering

> V8 ended at Phase 9. This adds Phase 10: E2E. Previous "Phase 13" label was a numbering bug from V6.

## Phase Overview V9 FINAL

- Phase 0: Podman + Bun 1.4.2 + pasta
- Phase 0.5: Architecture Invariants (auth, authz, messaging, persistence, networking, deployment, CI)
- Phase 1: Shared + DB (with sequence, idempotency, room_members)
- Phase 2: Bun fixes + native addon audit
- Phase 3: Podman dev compose (SQLite volume, Redis loopback only)
- Phase 4: Auth architecture (HttpOnly cookie web, Bearer native, WS ticket)
- Phase 5: Elysia 1.3 migration (no index, no chaining, typed)
- Phase 6: WS fixed (auth, authz, idempotency, sequence, rate limits, no any)
- Phase 7: Client WS + reconnect + sequence cursor + explicit WS URL
- Phase 8: Security (Biome no any, minimal trustedDeps, Trivy, body limits)
- Phase 9: Prod infra (Quadlet loopback, Caddy, Litestream target RPO, backup VACUUM INTO, destructive migration guard, atomic deploy + rollback app only, expand/contract)
- **Phase 10: E2E Encryption (Signal Protocol + PQ hybrid) - NEW**

---

## PHASE 10: E2E Encryption - Signal Protocol + PQ Hybrid

> This is the former "Phase 13" renumbered to Phase 10 to match V8's end at Phase 9.

### 10.0 Threat Model

Server is blind relay. Sees metadata (who, when, roomId, sequence, ciphertext blob) but NOT plaintext. Forward secrecy protects old messages if device stolen.

### 10.1 Library

`@signalapp/libsignal-client` + `react-native-quick-crypto` for Expo. Keys in SecureStore (native) / encrypted IndexedDB (web), never SQLite plaintext.

PQ hybrid: X25519 + ML-KEM-768 (Kyber) via libsignal's Kyber prekey.

### 10.2 Schema V9 - E2E

```ts
// identity_keys per device
export const identityKeys = sqliteTable('identity_keys', {
  userId: text('user_id').notNull().references(() => users.id),
  deviceId: text('device_id').notNull(),
  identityKeyPublic: text('identity_key_public').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.deviceId] }) }))

// prekey bundles - one-time + signed + kyber
export const prekeyBundles = sqliteTable('prekey_bundles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  prekeyId: integer('prekey_id').notNull(),
  prekeyPublic: text('prekey_public').notNull(),
  signedPrekeyId: integer('signed_prekey_id').notNull(),
  signedPrekeyPublic: text('signed_prekey_public').notNull(),
  signedPrekeySignature: text('signed_prekey_signature').notNull(),
  kyberPrekeyId: integer('kyber_prekey_id'),
  kyberPrekeyPublic: text('kyber_prekey_public'),
  used: integer('used', { mode: 'boolean' }).default(false),
}, (t) => ({
  uniqueDevicePrekey: unique().on(t.userId, t.deviceId, t.prekeyId),
}))

// messages store ciphertext, not text
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  sequence: integer('sequence').notNull(), // monotonic per room, gaps possible after conflict - cursor still works
  ciphertext: text('ciphertext').notNull(), // base64, server blind
  ciphertextType: integer('ciphertext_type').notNull(), // 1=Whisper, 3=PreKeyWhisper
}, (t) => ({
  uniqueUserClient: unique().on(t.userId, t.clientId),
  uniqueRoomSequence: unique().on(t.roomId, t.sequence),
  idxRoomSequence: index('idx_room_sequence').on(t.roomId, t.sequence)
}))
```

### 10.3 Server Routes - Blind

POST /e2e/bundle - upload identity + signed prekey + 100 one-time + kyber
GET /e2e/bundle?userId=... - fetch one bundle, mark used, return identity + signed + one-time + kyber

Server never sees private keys.

### 10.4 Client Crypto - Correct

- Identity per device, private in SecureStore
- Signed prekey rotate weekly, one-time prekeys refill at <20
- X3DH via libsignal SessionBuilder.processPreKeyBundle, verify Ed25519 signature
- Double Ratchet via SessionRecord, persist after each encrypt/decrypt including skipped keys
- Sequence generation: BEGIN IMMEDIATE + INSERT inside same tx + retry (from V8 fix)
- Ciphertext size 8KB max, rate limit 30/min per user

### 10.5 Multi-device

V9 initial: 1 device per user. Full: encrypt separately per remote device, store JSON { deviceId: { ciphertext, type } }.

### 10.6 Safety Number

app/(tabs)/verify.tsx shows DisplayableFingerprint(identityA||identityB) as 60 digits + QR, TOFU.

### 10.7 Backup

Identity private export encrypted with Argon2id + AES-GCM, password, or BIP39 mnemonic. If reinstall without backup, old messages undecryptable - expected.

### 10.8 Migration Expand/Contract

N: add ciphertext nullable, keep text
N+1: client reads only ciphertext
N+2: drop text

### 10.9 Testing

X3DH handshake, forward secrecy, out-of-order skipped keys, MITM fingerprint mismatch.

---

## Final Checklist V9 (Phases 0-10)

- [ ] Phases 0-9 from V8 all fixed (sequence BEGIN IMMEDIATE, ticket SET NX check, unauth cap 100, rate limiter pattern matcher, maps cleanup, VACUUM INTO backup, destructive guard, expand/contract, target RPO wording)
- [ ] Phase 10: E2E via libsignal-client, PQ hybrid, SecureStore private keys, ciphertext only on server, safety number, backup
- [ ] Numbering: 0, 0.5, 1-10 = 11 phases total, not 13

This is the version to execute.
