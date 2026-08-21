// Account-security service.
//  - Change own password (requires current password)
//  - Admin reset another user's password (Super Admin only, generates temp)
//  - Force must_change_password flag, session_version bump
//  - Enable/disable accounts
// Session invalidation happens by bumping user.session_version — the
// resolveActor path (rbac.ts) refuses tokens whose v mismatches.
import { randomBytes } from 'crypto';
import { userRepo } from '../../repositories/userRepo';
import { securityAuditRepo } from '../../repositories/securityAuditRepo';
import { hashPassword, verifyPassword } from '../../auth/password';
import { HttpError, hasAtLeastRole, ROLES } from '../../auth/rbac';
import type { Actor } from '@/lib/types';

const MIN_LEN = 10;
const PREFERRED_LEN = 12;

function validateNewPassword(pw: string): void {
  if (typeof pw !== 'string' || pw.length < MIN_LEN) {
    throw new HttpError(400, `New password must be at least ${MIN_LEN} characters (recommend ${PREFERRED_LEN}+).`);
  }
}

/** Cryptographically-random 24-char temp password. Uses base64url so it's copyable. */
function generateTempPassword(): string {
  // 20 bytes → ~27 base64url chars → clip to 24 for the user prompt UX.
  return randomBytes(20).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
}

export const accountSecurityService = {
  /** Signed-in user changes their own password. */
  async changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
    validateNewPassword(newPassword);
    const user = await userRepo.findById(actor.user.id);
    if (!user) throw new HttpError(404, 'User not found');
    const ok = await verifyPassword(currentPassword || '', user.password_hash || '');
    if (!ok) throw new HttpError(400, 'Current password is incorrect');
    const hash = await hashPassword(newPassword);
    await userRepo.updateFields(user.id, {
      password_hash: hash,
      password_updated_at: new Date(),
      must_change_password: false,
      session_version: (user.session_version ?? 0) + 1,   // → invalidates current JWT
      updated_at: new Date(),
    });
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: 'USER_PASSWORD_CHANGED', subject_user_id: actor.user.id, metadata: {},
    });
  },

  /** Super Admin resets another user's password — returns the temp ONCE. */
  async adminResetPassword(actor: Actor, targetUserId: string): Promise<{ temporary_password: string }> {
    if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) throw new HttpError(403, 'Super Admin privileges required');
    const target = await userRepo.findById(targetUserId);
    if (!target) throw new HttpError(404, 'Target user not found');
    const temp = generateTempPassword();
    const hash = await hashPassword(temp);
    await userRepo.updateFields(target.id, {
      password_hash: hash,
      password_updated_at: new Date(),
      must_change_password: true,
      session_version: (target.session_version ?? 0) + 1,
      updated_at: new Date(),
    });
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: 'USER_PASSWORD_RESET', subject_user_id: target.id,
      metadata: { target_email: target.email },
    });
    // Returned ONCE. Never logged. Never persisted plaintext.
    return { temporary_password: temp };
  },

  async setDisabled(actor: Actor, targetUserId: string, disabled: boolean): Promise<void> {
    if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) throw new HttpError(403, 'Super Admin privileges required');
    const target = await userRepo.findById(targetUserId);
    if (!target) throw new HttpError(404, 'Target user not found');
    if (target.id === actor.user.id && disabled) throw new HttpError(400, 'Cannot disable your own account');
    await userRepo.updateFields(target.id, {
      is_disabled: disabled,
      session_version: (target.session_version ?? 0) + 1, // invalidate their sessions
      updated_at: new Date(),
    });
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: disabled ? 'USER_DISABLED' : 'USER_ENABLED',
      subject_user_id: target.id,
      metadata: { target_email: target.email },
    });
  },

  async setMustChangePassword(actor: Actor, targetUserId: string): Promise<void> {
    if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) throw new HttpError(403, 'Super Admin privileges required');
    const target = await userRepo.findById(targetUserId);
    if (!target) throw new HttpError(404, 'Target user not found');
    await userRepo.updateFields(target.id, {
      must_change_password: true, session_version: (target.session_version ?? 0) + 1, updated_at: new Date(),
    });
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: 'USER_FORCE_PASSWORD_CHANGE', subject_user_id: target.id, metadata: { target_email: target.email },
    });
  },
};
