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
 * moment. See `reconcileCampaign` for the async funding-aware wrapper.
 *
 * M06 hardening: an `approved` campaign will NOT auto-transition to
 * `active`/`scheduled` unless it is funded. `funded` is decided by the caller
 * (delivered as an argument) so this function remains pure/synchronous.
 * The delivery path independently re-checks funding.
 */
export function computeNextStatus(c: PromotionCampaign, now: Date, funded = true): PromotionCampaignStatus {
  const terminal: PromotionCampaignStatus[] = ['cancelled', 'rejected', 'completed'];
  if (terminal.includes(c.status)) return c.status;
  if (c.status === 'paused') {
    if (c.end_at <= now) return 'completed';
    return 'paused';
  }
  if (c.status === 'draft' || c.status === 'pending_review') return c.status;
  // From here: approved / scheduled / active.
  if (c.end_at <= now) return 'completed';
  if (c.estimated_spend_usd_minor >= c.budget_total_usd_minor) return 'completed';
  // Funding gate. `approved` is the "waiting-for-money" holding pen.
  if (!funded) return 'approved';
  if (c.start_at > now) return 'scheduled';
  return 'active';
}

/**
 * Applies the computed transition if it differs from the stored status.
 * Funding awareness: consults the campaign funding service (paid + legacy
 * waiver) to decide whether the campaign is fundable-active or should stay
 * `approved`. Never re-fetches for terminal statuses.
 */
export async function reconcileCampaign(c: PromotionCampaign, now: Date = new Date()): Promise<PromotionCampaign> {
  let funded = true;
  const activeTerminal: PromotionCampaignStatus[] = ['approved', 'scheduled', 'active', 'paused'];
  if (activeTerminal.includes(c.status)) {
    try {
      const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
      const summary = await campaignFundingService.fundingSummary(c.id);
      funded = summary.funded;
    } catch {
      // Fall back to the on-campaign counter if the funding service fails.
      funded = (c.funded_amount_usd_micros ?? 0) > 0;
    }
  }
  const next = computeNextStatus(c, now, funded);
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
