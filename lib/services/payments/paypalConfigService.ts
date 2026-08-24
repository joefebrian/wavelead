// Canonical PayPal configuration resolver.
//
// Resolution priority for the ACTIVE environment (highest wins):
//   1. `integration_provider_settings.active_environment` (DB-persisted;
//      set by the Super Admin via the M07 activation endpoints).
//   2. `PAYPAL_ENVIRONMENT` env var (legacy path — kept for zero-downtime
//      rollback if the DB row is somehow missing).
//   3. `sandbox` default.
//
// FAIL-CLOSED rule (M07 PayPal activation patch):
//   If the resolved environment is `live` and the Live credential vault row is
//   missing OR has no client_secret_ciphertext OR the ciphertext fails to
//   decrypt, `resolveActive()` returns `null`. It does NOT silently downgrade
//   to sandbox. This prevents an incompletely-configured Live activation from
//   masquerading as a working Sandbox.
//
// The payment/refund/webhook LOGIC itself is untouched by this patch — only
// the environment/credential RESOLUTION.
import { integrationCredentialRepo } from '../../repositories/integrationCredentialRepo';
import { integrationProviderSettingsRepo } from '../../repositories/integrationProviderSettingsRepo';
import { decryptString } from '../../utils/cryptoVault';
import type { IntegrationEnvironment } from '@/lib/types';

export type EnvironmentSource = 'db' | 'env' | 'default';

export interface ResolvedPayPalConfig {
  environment: IntegrationEnvironment;
  client_id: string;
  client_secret: string;
  webhook_id: string | null;
  api_host: string;                   // https://api-m.sandbox.paypal.com | https://api-m.paypal.com
  source: 'admin_vault' | 'env';
  environment_source: EnvironmentSource;
}

export interface PayPalConfigStatus {
  environment: IntegrationEnvironment;
  configured: boolean;
  client_id_masked: string | null;
  client_secret_configured: boolean;
  webhook_id_masked: string | null;
  webhook_id_configured: boolean;
  source: 'admin_vault' | 'env' | 'none';
  last_connection_test_at: Date | null;
  last_connection_test_status: 'success' | 'failure' | null;
  last_connection_test_message: string | null;
}

export function apiHostFor(env: IntegrationEnvironment): string {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function maskClientId(clientId: string | null | undefined): string | null {
  if (!clientId) return null;
  const tail = clientId.slice(-4);
  const head = clientId.slice(0, 4);
  return `${head}…${tail}`;
}

function maskWebhookId(id: string | null | undefined): string | null {
  if (!id) return null;
  const tail = id.slice(-4);
  return `•••• ${tail}`;
}

/**
 * Read the desired active environment, honouring the M07 resolver precedence:
 *   1. DB   → integration_provider_settings.active_environment
 *   2. ENV  → process.env.PAYPAL_ENVIRONMENT
 *   3.       'sandbox'
 * Returns both the value AND which layer produced it (for status endpoints).
 */
export async function readActiveEnvironment(): Promise<{
  environment: IntegrationEnvironment;
  source: EnvironmentSource;
}> {
  // (1) DB
  try {
    const row = await integrationProviderSettingsRepo.getForProvider('paypal');
    if (row?.active_environment === 'live' || row?.active_environment === 'sandbox') {
      return { environment: row.active_environment, source: 'db' };
    }
  } catch {
    // If DB is unavailable at read time we fall through to ENV. This is a
    // resilience choice: reads are hot-path (every checkout, every webhook).
  }
  // (2) ENV (legacy)
  const raw = (process.env.PAYPAL_ENVIRONMENT || '').trim().toLowerCase();
  if (raw === 'live' || raw === 'sandbox') {
    return { environment: raw, source: 'env' };
  }
  // (3) default
  return { environment: 'sandbox', source: 'default' };
}

export const paypalConfigService = {
  /** Resolve the ACTIVE PayPal configuration for outgoing API calls. */
  async resolveActive(): Promise<ResolvedPayPalConfig | null> {
    const { environment: desiredEnv, source: envSource } = await readActiveEnvironment();

    // Preview safety: NEVER return a live config outside production.
    // The activation endpoint blocks NODE_ENV != production from writing 'live'
    // in the first place, but this second layer of defence protects us from
    // any historical / migrated / manually-inserted rows.
    const finalEnv: IntegrationEnvironment =
      (process.env.NODE_ENV !== 'production' && desiredEnv === 'live') ? 'sandbox' : desiredEnv;

    // ---- LIVE: strict fail-closed. No env fallback, no silent downgrade. ----
    if (finalEnv === 'live') {
      const vault = await integrationCredentialRepo.findByProviderEnv('paypal', 'live');
      if (!vault || !vault.client_id || !vault.client_secret_ciphertext) return null;
      try {
        const secret = decryptString(vault.client_secret_ciphertext);
        if (!secret) return null;
        return {
          environment: 'live',
          client_id: vault.client_id,
          client_secret: secret,
          webhook_id: vault.webhook_id,
          api_host: apiHostFor('live'),
          source: 'admin_vault',
          environment_source: envSource,
        };
      } catch {
        return null; // decryption failure → fail closed
      }
    }

    // ---- SANDBOX: vault → env → null (env fallback is safe here). ----
    const vault = await integrationCredentialRepo.findByProviderEnv('paypal', 'sandbox');
    if (vault?.client_id && vault.client_secret_ciphertext) {
      try {
        const secret = decryptString(vault.client_secret_ciphertext);
        return {
          environment: 'sandbox',
          client_id: vault.client_id,
          client_secret: secret,
          webhook_id: vault.webhook_id,
          api_host: apiHostFor('sandbox'),
          source: 'admin_vault',
          environment_source: envSource,
        };
      } catch { /* fall through to env fallback */ }
    }
    const envClientId = process.env.PAYPAL_CLIENT_ID?.trim();
    const envSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
    if (envClientId && envSecret) {
      return {
        environment: 'sandbox',
        client_id: envClientId,
        client_secret: envSecret,
        webhook_id: process.env.PAYPAL_WEBHOOK_ID?.trim() || null,
        api_host: apiHostFor('sandbox'),
        source: 'env',
        environment_source: envSource,
      };
    }
    return null;
  },

  /** Public-safe status for a specific environment — no secrets, ever. */
  async status(environment: IntegrationEnvironment): Promise<PayPalConfigStatus> {
    const vault = await integrationCredentialRepo.findByProviderEnv('paypal', environment);
    if (vault) {
      return {
        environment,
        configured: true,
        client_id_masked: maskClientId(vault.client_id),
        client_secret_configured: !!vault.client_secret_ciphertext,
        webhook_id_masked: maskWebhookId(vault.webhook_id),
        webhook_id_configured: !!vault.webhook_id,
        source: 'admin_vault',
        last_connection_test_at: vault.last_connection_test_at,
        last_connection_test_status: vault.last_connection_test_status,
        last_connection_test_message: vault.last_connection_test_message,
      };
    }
    // Env fallback view — env only ever describes ONE environment (its own).
    const envEnv: IntegrationEnvironment = ((process.env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase() === 'live') ? 'live' : 'sandbox';
    const envMatches = envEnv === environment;
    const envClient = envMatches ? process.env.PAYPAL_CLIENT_ID?.trim() : '';
    const envSecret = envMatches ? process.env.PAYPAL_CLIENT_SECRET?.trim() : '';
    const envWebhook = envMatches ? process.env.PAYPAL_WEBHOOK_ID?.trim() : '';
    if (envClient && envSecret) {
      return {
        environment,
        configured: true,
        client_id_masked: maskClientId(envClient),
        client_secret_configured: true,
        webhook_id_masked: maskWebhookId(envWebhook || null),
        webhook_id_configured: !!envWebhook,
        source: 'env',
        last_connection_test_at: null,
        last_connection_test_status: null,
        last_connection_test_message: null,
      };
    }
    return {
      environment,
      configured: false,
      client_id_masked: null,
      client_secret_configured: false,
      webhook_id_masked: null,
      webhook_id_configured: false,
      source: 'none',
      last_connection_test_at: null,
      last_connection_test_status: null,
      last_connection_test_message: null,
    };
  },

  /** Test OAuth against PayPal for the given env. Returns success/failure, no tokens. */
  async testConnection(cfg: { environment: IntegrationEnvironment; client_id: string; client_secret: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    const host = apiHostFor(cfg.environment);
    const basic = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64');
    try {
      const res = await fetch(`${host}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials',
      });
      // We deliberately DO NOT read/return the access_token body.
      if (res.ok) return { ok: true };
      const status = res.status;
      let msg = `PayPal OAuth returned HTTP ${status}`;
      if (status === 401) msg = 'Invalid client_id / client_secret';
      return { ok: false, error: msg };
    } catch (e) {
      return { ok: false, error: `Network error contacting PayPal (${(e as Error).message.slice(0, 80)})` };
    }
  },
};
