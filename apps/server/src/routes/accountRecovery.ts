import { getDbInstance } from '@meapp/db'
import {
  completePasswordResetSchema,
  enrollRecoveryEmailSchema,
  requestPasswordResetSchema,
  verifyRecoveryEmailSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'
import { AccountRecoveryService } from '../lib/accountRecovery'
import { clientIpOf } from '../lib/clientIp'
import { recoveryMail } from '../lib/recoveryMail'
import { requireUser } from '../lib/session'
import { authPlugin } from '../plugins/auth'
import { revokeAccountSockets } from '../ws/chat'

let service: AccountRecoveryService | undefined
const recovery = () => {
  service ??= new AccountRecoveryService(getDbInstance().sqlite, recoveryMail, revokeAccountSockets)
  return service
}
export const accountRecoveryRoutes = new Elysia({ prefix: '/api/account-recovery' })
  .use(authPlugin)
  .get('/status', ({ user }) => recovery().status(requireUser(user).id))
  .post(
    '/enroll',
    ({ user, body, request, server }) =>
      recovery().enroll(
        requireUser(user).id,
        body.email,
        body.currentPassword,
        clientIpOf(request, server),
      ),
    { body: enrollRecoveryEmailSchema },
  )
  .post(
    '/verify',
    ({ body, request, server }) => recovery().verifyEmail(body.token, clientIpOf(request, server)),
    { body: verifyRecoveryEmailSchema },
  )
  .post(
    '/request',
    ({ body, request, server }) => recovery().requestReset(body.email, clientIpOf(request, server)),
    { body: requestPasswordResetSchema },
  )
  .post(
    '/complete',
    ({ body, request, server }) =>
      recovery().resetPassword(body.token, body.password, clientIpOf(request, server)),
    { body: completePasswordResetSchema },
  )
