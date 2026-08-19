// One-shot PayPal Sandbox connectivity + order-creation smoke.
// Reads credentials from /app/.env (never printed).
// Usage: node scripts/paypal_sandbox_smoke.mjs
import fs from 'node:fs';
const envRaw = fs.readFileSync('/app/.env', 'utf8');
const env = Object.fromEntries(envRaw.split('\n').filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const mode = (env.PAYPAL_MODE || 'sandbox').toLowerCase();
const cid = env.PAYPAL_CLIENT_ID;
const cs = env.PAYPAL_CLIENT_SECRET;
if (mode !== 'sandbox') { console.log('MODE_NOT_SANDBOX'); process.exit(1); }
if (!cid || !cs) { console.log('CREDS_MISSING'); process.exit(1); }
const base = 'https://api-m.sandbox.paypal.com';

async function main() {
  // Step A: OAuth token
  const auth = Buffer.from(`${cid}:${cs}`).toString('base64');
  const tRes = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const tJson = await tRes.json();
  if (!tRes.ok || !tJson.access_token) {
    console.log('OAUTH_FAIL', tRes.status, JSON.stringify({ error: tJson.error, description: tJson.error_description }));
    process.exit(2);
  }
  console.log('OAUTH_OK', 'expires_in=' + tJson.expires_in, 'app_id_prefix=' + (tJson.app_id || '').slice(0, 6) + '...');

  // Step B: One order creation ($20.00 USD)
  const oRes = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tJson.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: '20.00' }, description: 'WaveLead M06.0 sandbox smoke' }],
      application_context: {
        return_url: 'http://localhost:3000/dashboard/promotions/smoke?status=paid',
        cancel_url: 'http://localhost:3000/dashboard/promotions/smoke?status=cancelled',
        user_action: 'PAY_NOW',
      },
    }),
  });
  const oJson = await oRes.json();
  if (!oRes.ok || !oJson.id) {
    console.log('ORDER_FAIL', oRes.status, JSON.stringify({ name: oJson.name, message: oJson.message }));
    process.exit(3);
  }
  const approve = (oJson.links || []).find(l => l.rel === 'approve');
  console.log('ORDER_OK', 'id=' + oJson.id, 'status=' + oJson.status, 'has_approve_url=' + !!approve);
  console.log('SMOKE_PASS');
}
main().catch(e => { console.log('EXC', e.message); process.exit(4); });
