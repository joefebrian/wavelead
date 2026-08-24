// Super-Admin PayPal configuration service. Wraps paypalConfigService + vault repo.
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { HttpError, hasAtLeastRole, ROLES } from '../../auth/rbac';
import { integrationCredentialRepo } from '../../repositories/integrationCredentialRepo';
import { securityAuditRepo } from '../../repositories/securityAuditRepo';
import { encryptString, decryptString, isVaultConfigured } from '../../utils/cryptoVault';
import { paypalConfigService, apiHostFor } from '../payments/paypalConfigService';
import { getCanonicalWebhookUrl } from '../../utils/canonicalOrigin';
import type { Actor, IntegrationCredential, IntegrationEnvironment } from '@/lib/types';

export const paypalAdminUpsertSchema = z.object({
  environment: z.enum(['sandbox', 'live']),
  client_id: z.string().trim().min(10).max(200),
  client_secret: z.string().min(10).max(500).optional(),   // undefined = keep existing
  webhook_id: z.string().trim().max(200).nullable().optional(),
  confirm_live: z.string().optional(),                       // must be 'ENABLE LIVE PAYMENTS' when environment=live
});

export const paypalAdminTestSchema = z.object({
  environment: z.enum(['sandbox', 'live']),
  client_id: z.string().trim().min(10).max(200).optional(),
  client_secret: z.string().min(10).max(500).optional(),
});

function requireSuperAdmin(actor: Actor) {
  if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) throw new HttpError(403, 'Super Admin privileges required');
}

export const paypalAdminService = {
  async currentStatus(actor: Actor) {
    requireSuperAdmin(actor);
    const [sandbox, live, activeCfg] = await Promise.all([
      paypalConfigService.status('sandbox'),
      paypalConfigService.status('live'),
      paypalConfigService.resolveActive(),
    ]);
    return {
      vault_key_configured: isVaultConfigured(),
      node_env: process.env.NODE_ENV || 'development',
      sandbox_api_host: apiHostFor('sandbox'),
      live_api_host: apiHostFor('live'),
      active_environment: activeCfg?.environment ?? null,
      active_source: activeCfg?.source ?? null,
      // Webhook callback URL — DETERMINISTIC (derived only from NEXT_PUBLIC_BASE_URL).
      // Request headers cannot influence this string. See lib/utils/canonicalOrigin.ts.
      webhook_url: getCanonicalWebhookUrl('/api/payments/paypal/webhook'),
      sandbox,
      live,
    };
  },

  async upsert(actor: Actor, input: unknown): Promise<{ ok: true }> {
    requireSuperAdmin(actor);
    if (!isVaultConfigured()) throw new HttpError(500, 'INTEGRATION_SECRETS_KEY not configured on server — cannot store secret');
    const parsed = paypalAdminUpsertSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message || 'invalid'}`);
    const { environment, client_id, client_secret, webhook_id, confirm_live } = parsed.data;

    // Preview safety: LIVE is impossible outside production.
    if (environment === 'live' && process.env.NODE_ENV !== 'production') {
      throw new HttpError(400, 'Live PayPal payments can only be enabled in the production environment.');
    }

    const existing = await integrationCredentialRepo.findByProviderEnv('paypal', environment);

    // Explicit-confirmation gate for LIVE activation.
    const enablingLive = environment === 'live' && (!existing || !existing.client_secret_ciphertext);
    if (enablingLive && confirm_live !== 'ENABLE LIVE PAYMENTS') {
      throw new HttpError(400, 'Live activation requires typing "ENABLE LIVE PAYMENTS" in the confirmation field.');
    }

    // Determine the ciphertext to persist.
    let ciphertext: string;
    if (client_secret) {
      ciphertext = encryptString(client_secret);
    } else if (existing?.client_secret_ciphertext) {
      ciphertext = existing.client_secret_ciphertext; // keep the existing secret
    } else {
      throw new HttpError(400, 'client_secret is required for the first-time save of this environment.');
    }

    // For LIVE activation, require full credentials + a passing connection test.
    if (enablingLive) {
      const secretPlain = client_secret || (existing ? decryptString(existing.client_secret_ciphertext) : '');
      const test = await paypalConfigService.testConnection({ environment: 'live', client_id, client_secret: secretPlain });
      if (!test.ok) throw new HttpError(400, `Live activation blocked: connection test failed — ${test.error}`);
      if (!webhook_id) throw new HttpError(400, 'Live activation blocked: Webhook ID is required for live mode.');
    }

    const now = new Date();
    const doc: IntegrationCredential = {
      id: existing?.id ?? uuidv4(),
      provider: 'paypal',
      environment,
      client_id,
      client_secret_ciphertext: ciphertext,
      webhook_id: (webhook_id ?? existing?.webhook_id) ?? null,
      configured_by: actor.user.id,
      last_connection_test_at: existing?.last_connection_test_at ?? null,
      last_connection_test_status: existing?.last_connection_test_status ?? null,
      last_connection_test_message: existing?.last_connection_test_message ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await integrationCredentialRepo.upsert(doc);

    // Audit event — NEVER include the secret.
    const eventType = existing
      ? (client_secret ? 'PAYPAL_SECRET_REPLACED' : 'PAYPAL_CONFIG_UPDATED')
      : (environment === 'live' ? 'PAYPAL_LIVE_ENABLED' : 'PAYPAL_SANDBOX_ENABLED');
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: eventType,
      metadata: {
        environment,
        client_id_prefix: client_id.slice(0, 6),
        webhook_id_configured: !!doc.webhook_id,
      },
    });
    return { ok: true };
  },

  async testConnection(actor: Actor, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    requireSuperAdmin(actor);
    const parsed = paypalAdminTestSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message || 'invalid'}`);
    let { environment, client_id, client_secret } = parsed.data;
    // If the caller omitted credentials, resolve from vault or env.
    if (!client_id || !client_secret) {
      const existing = await integrationCredentialRepo.findByProviderEnv('paypal', environment);
      if (existing?.client_secret_ciphertext) {
        client_id = existing.client_id;
        client_secret = decryptString(existing.client_secret_ciphertext);
      } else if (environment === ((process.env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase())) {
        client_id = process.env.PAYPAL_CLIENT_ID?.trim() || '';
        client_secret = process.env.PAYPAL_CLIENT_SECRET?.trim() || '';
      }
    }
    if (!client_id || !client_secret) return { ok: false, error: 'No credentials configured for this environment' };
    const result = await paypalConfigService.testConnection({ environment, client_id, client_secret });
    await integrationCredentialRepo.updateConnectionTest(
      'paypal', environment,
      result.ok ? 'success' : 'failure',
      result.ok ? 'OAuth token obtained' : result.error,
    );
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: 'PAYPAL_CONNECTION_TESTED',
      metadata: { environment, success: result.ok },
    });
    return result;
  },

  async importFromEnv(actor: Actor): Promise<{ imported: boolean; environment: IntegrationEnvironment | null }> {
    requireSuperAdmin(actor);
    const envMode: IntegrationEnvironment = ((process.env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox');
    const cid = process.env.PAYPAL_CLIENT_ID?.trim();
    const csec = process.env.PAYPAL_CLIENT_SECRET?.trim();
    const wid = process.env.PAYPAL_WEBHOOK_ID?.trim() || null;
    if (!cid || !csec) return { imported: false, environment: null };
    if (envMode === 'live' && process.env.NODE_ENV !== 'production') {
      throw new HttpError(400, 'Cannot import LIVE credentials outside production.');
    }
    const existing = await integrationCredentialRepo.findByProviderEnv('paypal', envMode);
    const now = new Date();
    const doc: IntegrationCredential = {
      id: existing?.id ?? uuidv4(),
      provider: 'paypal',
      environment: envMode,
      client_id: cid,
      client_secret_ciphertext: encryptString(csec),
      webhook_id: wid,
      configured_by: actor.user.id,
      last_connection_test_at: existing?.last_connection_test_at ?? null,
      last_connection_test_status: existing?.last_connection_test_status ?? null,
      last_connection_test_message: existing?.last_connection_test_message ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await integrationCredentialRepo.upsert(doc);
    await securityAuditRepo.record({
      actor_user_id: actor.user.id, actor_email: actor.user.email,
      event_type: 'PAYPAL_CONFIG_CREATED',
      metadata: { environment: envMode, imported_from: 'env' },
    });
    return { imported: true, environment: envMode };
  },
};
