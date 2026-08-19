import fs from 'node:fs';
const envRaw = fs.readFileSync('/app/.env', 'utf8');
const env = Object.fromEntries(envRaw.split('\n').filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const id = process.argv[2];
if (!id) { console.log('usage: node paypal_query_order.mjs <ORDER_ID>'); process.exit(1); }
const base = 'https://api-m.sandbox.paypal.com';
const auth = Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64');
const tR = await fetch(base+'/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic '+auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
const t = (await tR.json()).access_token;
const oR = await fetch(base+'/v2/checkout/orders/'+encodeURIComponent(id), { headers: { Authorization: 'Bearer '+t, Accept: 'application/json' } });
const j = await oR.json();
console.log('HTTP', oR.status);
console.log('id', j.id || '-');
console.log('status', j.status || '-');
console.log('links', JSON.stringify((j.links||[]).map(l=>l.rel)));
const approve = (j.links||[]).find(l => l.rel === 'approve' || l.rel === 'payer-action');
console.log('approve_url', approve ? approve.href : '-');
if (j.name || j.message || j.details) console.log('note', j.name, '|', j.message, '|', JSON.stringify(j.details || null));
