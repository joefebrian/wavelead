// Server-side campaign state reconciliation. Idempotent transitions driven by
// time + budget only. Cron-ready but callable synchronously on demand.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import type { AuditLog, PromotionCampaign, PromotionCampaignStatus } from '@/lib/types';

export async function recordAudit(
  actor_user_id: string,
  action: string,
  entity_id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    const log: AuditLog = {
      id: uuidv4(),
      actor_user_id,
      action,
      entity_type: 'promotion_campaign',
      entity_id,
      before_data: before,
      after_data: after,
      created_at: new Date(),
    };
    const c = await getCollection<AuditLog>(COLLECTIONS.AUDIT_LOGS);
    await c.insertOne(log);
  } catch (err) {
    console.error('[wavelead] audit log write failed:', err);
  }
}

/**
 * Deterministically compute the next status for a campaign given the current
 * moment. Never reactivates cancelled/rejected/completed campaigns. Never
 * auto-resumes paused campaigns. Both time and budget are considered.
 */
export function computeNextStatus(c: PromotionCampaign, now: Date): PromotionCampaignStatus {
  const terminal: PromotionCampaignStatus[] = ['cancelled', 'rejected', 'completed'];
  if (terminal.includes(c.status)) return c.status;
  if (c.status === 'paused') {
    if (c.end_at <= now) return 'completed';
    return 'paused';
  }
  if (c.status === 'draft' || c.status === 'pending_review') return c.status;
  // From here: approved/scheduled/active.
  if (c.end_at <= now) return 'completed';
  if (c.estimated_spend_usd_minor >= c.budget_total_usd_minor) return 'completed';
  if (c.start_at > now) return 'scheduled';
  return 'active';
}

/**
 * Applies the computed transition if it differs from the stored status.
 * Writes at most one PROMOTION_ACTIVATED or PROMOTION_COMPLETED audit event
 * per state change (idempotent).
 */
export async function reconcileCampaign(c: PromotionCampaign, now: Date = new Date()): Promise<PromotionCampaign> {
  const next = computeNextStatus(c, now);
  if (next === c.status) return c;
  const patch: Partial<PromotionCampaign> = {};
  if (next === 'active' && !c.activated_at) patch.activated_at = now;
  if (next === 'completed' && !c.completed_at) patch.completed_at = now;
  await promotionCampaignRepo.setStatus(c.id, next, patch);
  const before = { status: c.status };
  const after: Record<string, unknown> = { status: next };
  if (patch.activated_at) after.activated_at = patch.activated_at;
  if (patch.completed_at) after.completed_at = patch.completed_at;
  const auditAction =
    next === 'active' ? 'PROMOTION_ACTIVATED' :
    next === 'completed' ? 'PROMOTION_COMPLETED' :
    'PROMOTION_STATE_TRANSITION';
  await recordAudit('system', auditAction, c.id, before, after);
  return { ...c, status: next, ...patch };
}
