import { getFetcher, postFetcher } from '@/lib/api'
import {
  accountRecoveryAcceptedSchema,
  accountRecoveryStatusSchema,
  completePasswordResetSchema,
  enrollRecoveryEmailSchema,
  requestPasswordResetSchema,
  verifyRecoveryEmailSchema,
} from '@meapp/shared'

export const getAccountRecoveryStatus = async () =>
  accountRecoveryStatusSchema.parse(await getFetcher('account-recovery/status'))
export const enrollRecoveryEmail = async (input: unknown) =>
  accountRecoveryAcceptedSchema.parse(
    await postFetcher('account-recovery/enroll', enrollRecoveryEmailSchema.parse(input)),
  )
export const verifyRecoveryEmail = (input: unknown) =>
  postFetcher('account-recovery/verify', verifyRecoveryEmailSchema.parse(input))
export const requestPasswordReset = async (input: unknown) =>
  accountRecoveryAcceptedSchema.parse(
    await postFetcher('account-recovery/request', requestPasswordResetSchema.parse(input)),
  )
export const completePasswordReset = (input: unknown) =>
  postFetcher('account-recovery/complete', completePasswordResetSchema.parse(input))
