import { aliasValueSchema } from '@meapp/shared'

export type AliasCrypto = {
  hash: (input: Uint8Array) => Promise<Uint8Array>
  seal: (input: Uint8Array, key: Uint8Array) => Promise<string>
  open: (ciphertext: string, key: Uint8Array) => Promise<Uint8Array>
}

async function deriveKey(crypto: AliasCrypto, ownerId: string, privateKey: string) {
  return crypto.hash(new TextEncoder().encode(`meapp:contact-alias:v1:${ownerId}:${privateKey}`))
}

export async function sealAlias(
  crypto: AliasCrypto,
  ownerId: string,
  contactId: string,
  privateKey: string,
  alias: string,
) {
  const value = aliasValueSchema.parse({
    version: 1,
    ownerId,
    contactId,
    alias: alias.trim() || null,
  })
  return crypto.seal(
    new TextEncoder().encode(JSON.stringify(value)),
    await deriveKey(crypto, ownerId, privateKey),
  )
}

export async function openAlias(
  crypto: AliasCrypto,
  ownerId: string,
  contactId: string,
  privateKey: string,
  ciphertext: string,
) {
  const bytes = await crypto.open(ciphertext, await deriveKey(crypto, ownerId, privateKey))
  const value = aliasValueSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
  if (value.ownerId !== ownerId || value.contactId !== contactId)
    throw new Error('Alias belongs to a different contact')
  return value.alias
}
