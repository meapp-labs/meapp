// These tables belong to the SDK and live only in the on-device SQLCipher DB.
export default {
  schema: '../../node_modules/@open-e2ee/signal-protocol-sdk/dist/local/store/expo/schema.js',
  out: '../../apps/client/e2e-migrations',
  dialect: 'sqlite',
  dbCredentials: { url: '../../apps/client/e2e-schema.db' },
}
