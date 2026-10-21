// P0C — MODERATOR ROLE ASSIGNMENT (Super Admin only).
//
// The ONLY supported way to grant or revoke the `moderator` role.
//   • Super Admin only. Never self-service, never on your own account.
//   • Only the moderator role can be granted. Admin / super_admin can never
//     be granted here, and admin / super_admin accounts can never be changed.
//   • A written reason is required; every change writes a protected security
//     audit record AND a general audit event.
//   • The write is a compare-and-set on the role read, so a concurrent change
//     fails closed.
//   • session_version is bumped so the target's existing sessions are
//     invalidated and the new authorization takes effect on next sign-in
//     (privileged checks always resolve the role from MongoDB anyway).
//   • Revocation restores the role held before the grant (default 'user').
//   • Never touches is_sourcing_agent, plans, payouts or any other field.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../../db/mongo';
import { COLLECTIONS } from '../../db/collections';
import { userRepo } from '../../repositories/userRepo';
import { auditRepo } from '../../repositories/genericRepo';
import { securityAuditRepo } from '../../repositories/securityAuditRepo';
import { HttpError, requireRole, ROLES } from '../../auth/rbac';
import type { Actor, Role, User } from '@/lib/types';

/** Roles that may be promoted to moderator. */
const PROMOTABLE: Role[] = ['user', 'channel_owner', 'business'];
const PROTECTED: Role[] = ['admin', 'super_admin'];

export const roleAssignmentService = {
  async setModerator(
    actor: Actor | null,
    targetUserId: string,
    grant: boolean,
    reason: string,
  ): Promise<{ user_id: string; role: Role; changed: boolean }> {
    requireRole(actor, ROLES.SUPER_ADMIN);
    const admin = actor!;
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 10) throw new HttpError(400, 'A reason of at least 10 characters is required for a role change.');
    if (targetUserId === admin.user.id) throw new HttpError(400, 'You cannot change your own role.');

    const target = (await userRepo.findById(targetUserId)) as (User & { role_before_moderator?: Role | null }) | null;
    if (!target) throw new HttpError(404, 'User not found');
    const current = target.role as Role;
    if (PROTECTED.includes(current)) {
      throw new HttpError(403, 'Administrator accounts cannot be changed through moderator role assignment.');
    }

    let next: Role;
    if (grant) {
      if (current === 'moderator') return { user_id: target.id, role: current, changed: false };
      if (!PROMOTABLE.includes(current)) throw new HttpError(409, `Role "${current}" cannot be promoted to moderator.`);
      next = 'moderator';
    } else {
      if (current !== 'moderator') return { user_id: target.id, role: current, changed: false };
      const prev = target.role_before_moderator;
      next = prev && PROMOTABLE.includes(prev) ? prev : 'user';
    }

    const now = new Date();
    const users = await getCollection<User>(COLLECTIONS.USERS);
    const res = await users.updateOne(
      { id: target.id, role: current } as never,
      {
        $set: {
          role: next,
          role_before_moderator: grant ? current : null,
          role_changed_at: now,
          role_changed_by: admin.user.id,
          updated_at: now,
        },
        $inc: { session_version: 1 },
      } as never,
    );
    if (res.matchedCount !== 1) throw new HttpError(409, 'The user\u2019s role changed concurrently. Refresh and try again.');

    await securityAuditRepo.record({
      actor_user_id: admin.user.id, actor_email: admin.user.email,
      event_type: grant ? 'USER_ROLE_MODERATOR_GRANTED' : 'USER_ROLE_MODERATOR_REVOKED',
      subject_user_id: target.id,
      metadata: { target_email: target.email, from_role: current, to_role: next, reason: cleanReason, sessions_invalidated: true },
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: admin.user.id,
      action: grant ? 'USER_ROLE_MODERATOR_GRANTED' : 'USER_ROLE_MODERATOR_REVOKED',
      entity_type: 'user',
      entity_id: target.id,
      before_data: { role: current },
      after_data: { role: next, reason: cleanReason },
      created_at: now,
    } as never);
    return { user_id: target.id, role: next, changed: true };
  },
};
