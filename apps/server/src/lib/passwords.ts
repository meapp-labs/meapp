import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { LOGIN_CONFIG } from './config'

const scrypt = promisify(scryptCallback)
export async function makePasswordHash(password: string): Promise<string> {
  const salt = randomBytes(LOGIN_CONFIG.SALT_LENGTH).toString('hex')
  const result = (await scrypt(password, salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH)) as Buffer
  return `${salt}:${result.toString('hex')}`
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const actual = (await scrypt(password, salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
