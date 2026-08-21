// Canonical PayPal configuration resolver.
//
// Resolution priority (highest wins):
//   1. Admin-vault (integration_credentials) row for the requested environment
//   2. Environment variables PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID
//      + PAYPAL_ENVIRONMENT (defaults sandbox in non-prod)
//
// This service is the ONLY place PayPalPaymentProvider should read config
// from. The payment/refund/webhook LOGIC itself is untouched — we only
// change how credentials are resolved.
import { integrationCredentialRepo } from '../../repositories/integrationCredentialRepo';
import { decryptString } from '../../utils/cryptoVault';
import type { IntegrationEnvironment } from '@/lib/types';

export interface ResolvedPayPalConfig {
  environment: IntegrationEnvironment;
  client_id: string;
  client_secret: string;
  webhook_id: string | null;
  api_host: string;                   // https://api-m.sandbox.paypal.com | https://api-m.paypal.com
  source: 'admin_vault' | 'env';
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

export const paypalConfigService = {
  /** Resolve the ACTIVE PayPal configuration for outgoing API calls. */
  async resolveActive(): Promise<ResolvedPayPalConfig | null> {
    // Which environment does the admin want to use? Priority:
    //   1. Admin vault row marked as active (live or sandbox depending on env)
    //   2. PAYPAL_ENVIRONMENT env var
    //   3. sandbox default in non-prod, live default in prod-with-live-configured
    const desiredEnv: IntegrationEnvironment = ((process.env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase() as IntegrationEnvironment) === 'live' ? 'live' : 'sandbox';
    // Preview safety: NEVER return a live config outside production.
    const finalEnv: IntegrationEnvironment = (process.env.NODE_ENV !== 'production' && desiredEnv === 'live') ? 'sandbox' : desiredEnv;

    // (1) Vault
    const vault = await integrationCredentialRepo.findByProviderEnv('paypal', finalEnv);
    if (vault?.client_secret_ciphertext) {
      try {
        const secret = decryptString(vault.client_secret_ciphertext);
        return {
          environment: finalEnv,
          client_id: vault.client_id,
          client_secret: secret,
          webhook_id: vault.webhook_id,
          api_host: apiHostFor(finalEnv),
          source: 'admin_vault',
        };
      } catch { /* fall through to env fallback on decryption failure */ }
    }
    // (2) Env fallback
    const envClientId = process.env.PAYPAL_CLIENT_ID?.trim();
    const envSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
    if (envClientId && envSecret) {
      return {
        environment: finalEnv,
        client_id: envClientId,
        client_secret: envSecret,
        webhook_id: process.env.PAYPAL_WEBHOOK_ID?.trim() || null,
        api_host: apiHostFor(finalEnv),
        source: 'env',
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
    // Env fallback view
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
