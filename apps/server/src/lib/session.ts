import { createAuthenticationRequiredError } from './errors.ts'

/** Identity carried by the session cookie: the username, matching the Redis data model. */
export type SessionUser = {
  id: string
  username: string
  platform: string
  tokenId: string
  expiresAt: number
}

/** Narrows the optional derived user, throwing a 401 when the session is absent. */
export const requireUser = (user: SessionUser | null | undefined): SessionUser => {
  if (!user) {
    throw createAuthenticationRequiredError()
  }
  return user
}
