import { z } from 'zod'
import { usernameSchema } from './auth.ts'

// ─────────────────────────────────────────────────────────────
// Group Roles and Matrix
// ─────────────────────────────────────────────────────────────
/**
 * Role Matrix:
 * - admin:
 *   - Rename group
 *   - Directly add members (subject to block checks and capacity limits)
 *   - Create expiring invites with atomic max use limits
 *   - Revoke invites
 *   - Remove members (cannot remove last admin)
 *   - Transfer admin role (required when sole admin leaves non-empty group)
 * - member:
 *   - Send & receive messages, media attachments
 *   - Leave group
 *   - Cannot add / remove members or rename group
 */
export const roomRoleSchema = z.enum(['admin', 'member'])
export type RoomRole = z.infer<typeof roomRoleSchema>

export const groupMemberSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  role: roomRoleSchema,
  joinedAt: z.string().datetime(),
})
export type GroupMember = z.infer<typeof groupMemberSchema>

export const addGroupMemberSchema = z.object({
  username: usernameSchema,
  role: roomRoleSchema.optional(),
})
export type AddGroupMemberInput = z.infer<typeof addGroupMemberSchema>

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
})
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>

export const createInviteSchema = z.object({
  expiresInHours: z.number().int().min(1).max(720).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
  role: roomRoleSchema.optional(),
})
export type CreateInviteInput = z.infer<typeof createInviteSchema>

export const joinInviteSchema = z.object({
  token: z.string().trim().min(1).max(256),
})
export type JoinInviteInput = z.infer<typeof joinInviteSchema>

export const leaveGroupSchema = z.object({
  transferToUserId: z.string().uuid().optional(),
})
export type LeaveGroupInput = z.infer<typeof leaveGroupSchema>

export const transferAdminSchema = z.object({
  newAdminUserId: z.string().uuid(),
})
export type TransferAdminInput = z.infer<typeof transferAdminSchema>

export const groupInviteResponseSchema = z.object({
  token: z.string().optional(), // only populated when creating
  tokenHash: z.string(),
  roomId: z.string(),
  inviterId: z.string(),
  role: roomRoleSchema,
  maxUses: z.number(),
  usesCount: z.number(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
})
export type GroupInviteResponse = z.infer<typeof groupInviteResponseSchema>
