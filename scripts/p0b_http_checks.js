/**
 * P0B HTTP gap-closing checks: the two paths the backend agent only verified
 * structurally — (3) Fast Verification safeguard and (4) the release action —
 * exercised end-to-end through the real HTTP layer.
 * Seeds its own fixtures and cleans them up. No payments are triggered.
 */
const { MongoClient } = require('mongodb');
const { v4: uuid } = require('uuid');

const API = 'http://localhost:3000/api';
const PW = 'P0bWave!2026Qa';
const RUN = `p0bhttp${Date.now().toString(36)}`;
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} :: ${detail ?? ''}`); }
}

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`login failed for ${email}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return cookie;
}

(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL || 'mongodb://localhost:27017');
  const db = client.db(process.env.DB_NAME || 'wavelead');
  const channels = db.collection('channels');
  const users = db.collection('users');

  const agent = await users.findOne({ email: 'qa-p0b-agent@wavelead.dev' });
  const owner = await users.findOne({ email: 'qa-p0b-owner@wavelead.dev' });
  if (!agent || !owner) throw new Error('QA accounts missing — run node scripts/seed_p0b_qa_users.js');

  const agentCookie = await login('qa-p0b-agent@wavelead.dev');
  const ownerCookie = await login('qa-p0b-owner@wavelead.dev');
  const adminCookie = await login('qa-p0b-admin@wavelead.dev');

  const mk = async (over) => {
    const id = uuid(); const hex = id.replace(/-/g, ''); const now = new Date();
    const doc = {
      id, slug: `${RUN}-${hex.slice(0, 8)}`, name: `P0B HTTP ${hex.slice(0, 6)}`,
      whatsapp_url: `https://whatsapp.com/channel/${hex.slice(0, 22)}`,
      whatsapp_channel_id: hex.slice(0, 22),
      short_description: 'http level p0b fixture', description: null,
      logo_url: null, cover_url: null, website_url: null,
      country_code: 'ID', primary_language: 'id', category_id: null,
      owner_id: null, submitted_by: null, status: 'approved',
      verification_status: 'unclaimed', activation_status: 'not_required',
      is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
      activity_level: 'active', follower_count: 0, follower_count_source: 'submitter',
      follower_count_updated_at: null, created_at: now, updated_at: now, published_at: now,
      ...over,
    };
    await channels.insertOne(doc);
    return doc;
  };

  console.log('\n(3) FAST VERIFICATION SAFEGUARD — HTTP');
  const sourced = await mk({
    source: 'staff_sourced', sourced_by_user_id: agent.id, sourced_at: new Date(),
    submitted_by: agent.id, owner_id: null,
  });
  let r = await fetch(`${API}/owner/channels/${sourced.id}/verification/start-fast`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: agentCookie }, body: '{}',
  });
  let body = await r.json().catch(() => ({}));
  check('sourcing agent is refused on start-fast (403)', r.status === 403, `${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  check('refusal explains sourcing != ownership', /sourcing/i.test(JSON.stringify(body)), JSON.stringify(body).slice(0, 200));
  let fresh = await channels.findOne({ id: sourced.id });
  check('refused attempt changed nothing', fresh.owner_id === null && fresh.verification_status === 'unclaimed');

  // An ordinary self-submitter must NOT be refused by the eligibility guard.
  const selfSub = await mk({ source: 'owner_self', submitted_by: owner.id, owner_id: owner.id });
  r = await fetch(`${API}/owner/channels/${selfSub.id}/verification/start-fast`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ownerCookie }, body: '{}',
  });
  body = await r.json().catch(() => ({}));
  const refusedForOwnership = r.status === 403 && /sourcing|only the original submitter/i.test(JSON.stringify(body));
  check('ordinary self-submitter is NOT blocked by the ownership guard', !refusedForOwnership,
    `${r.status} ${JSON.stringify(body).slice(0, 200)}`);

  console.log('\n(4) RELEASE UNVERIFIED OWNERSHIP LINK — HTTP');
  const REL = { reason: 'Reviewed sourcing evidence; linked account is a sourcing agent.', evidence_ref: 'TICKET-HTTP-1' };
  const post = (id, cookie, payload) => fetch(`${API}/admin/channels/${id}/release-ownership-link`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload),
  });

  // refusal: non-admin
  const linked = await mk({ owner_id: agent.id, submitted_by: agent.id });
  r = await post(linked.id, ownerCookie, { ...REL, expected_owner_user_id: agent.id });
  check('non-admin cannot release', r.status === 401 || r.status === 403, String(r.status));
  // refusal: short reason / missing evidence
  r = await post(linked.id, adminCookie, { reason: 'short', evidence_ref: 'T', expected_owner_user_id: agent.id });
  check('short reason refused (400)', r.status === 400, String(r.status));
  r = await post(linked.id, adminCookie, { reason: REL.reason, evidence_ref: '', expected_owner_user_id: agent.id });
  check('missing evidence refused (400)', r.status === 400, String(r.status));
  // refusal: wrong expected owner
  r = await post(linked.id, adminCookie, { ...REL, expected_owner_user_id: owner.id });
  check('wrong expected owner refused (409)', r.status === 409, String(r.status));
  // refusal: verified ownership
  const verified = await mk({ owner_id: agent.id, verification_status: 'verified', verified_at: new Date() });
  r = await post(verified.id, adminCookie, { ...REL, expected_owner_user_id: agent.id, acknowledge_warnings: true });
  check('verified ownership never released (409)', r.status === 409, String(r.status));
  fresh = await channels.findOne({ id: verified.id });
  check('verified record untouched', fresh.owner_id === agent.id && fresh.verification_status === 'verified');
  // refusal: activation active
  const act = await mk({ owner_id: agent.id, activation_status: 'active' });
  r = await post(act.id, adminCookie, { ...REL, expected_owner_user_id: agent.id, acknowledge_warnings: true });
  check('activation-active never released (409)', r.status === 409, String(r.status));

  // assessment endpoint
  r = await fetch(`${API}/admin/channels/${linked.id}/ownership-assessment`, { headers: { Cookie: adminCookie } });
  body = await r.json().catch(() => ({}));
  check('assessment returns likely_staff_sourced + eligible',
    r.status === 200 && body?.data?.label === 'likely_staff_sourced' && body?.data?.eligible === true,
    JSON.stringify(body).slice(0, 220));

  // concurrency: exactly one release
  const results = await Promise.all([
    post(linked.id, adminCookie, { ...REL, expected_owner_user_id: agent.id, acknowledge_warnings: true }),
    post(linked.id, adminCookie, { ...REL, expected_owner_user_id: agent.id, acknowledge_warnings: true }),
    post(linked.id, adminCookie, { ...REL, expected_owner_user_id: agent.id, acknowledge_warnings: true }),
  ]);
  const okCount = results.filter((x) => x.status === 200).length;
  check('exactly one concurrent release succeeds', okCount === 1, `succeeded=${okCount}`);
  fresh = await channels.findOne({ id: linked.id });
  check('owner link cleared', fresh.owner_id === null, String(fresh.owner_id));
  check('verification_status back to unclaimed', fresh.verification_status === 'unclaimed', fresh.verification_status);
  check('previous owner preserved', fresh.released_from_owner_id === agent.id);
  check('submission history preserved', fresh.submitted_by === agent.id);
  const audits = await db.collection('audit_logs').find({ entity_id: linked.id, action: 'OWNERSHIP_LINK_RELEASED' }).toArray();
  check('exactly one audit row', audits.length === 1, `rows=${audits.length}`);
  check('audit records reason + evidence + no auto-transfer',
    audits[0]?.after_data?.evidence_ref === 'TICKET-HTTP-1'
    && audits[0]?.after_data?.reassigned_to_claimant === false
    && audits[0]?.after_data?.bulk_operation === false);

  // claimable again
  r = await fetch(`${API}/channels/${fresh.slug}/claim-eligibility`, { headers: { Cookie: ownerCookie } });
  if (r.status === 404) console.log('  note: claim-eligibility route name differs; service-level coverage coexists in vitest');
  else {
    body = await r.json().catch(() => ({}));
    check('released channel is claimable by another user', JSON.stringify(body).includes('unclaimed') || body?.data?.canClaim === true,
      JSON.stringify(body).slice(0, 200));
  }

  // cleanup
  const mine = await channels.find({ slug: new RegExp(RUN) }).project({ id: 1 }).toArray();
  const ids = mine.map((m) => m.id);
  await channels.deleteMany({ slug: new RegExp(RUN) });
  if (ids.length) {
    await db.collection('audit_logs').deleteMany({ entity_id: { $in: ids } });
    await db.collection('channel_activation_payments').deleteMany({ channel_id: { $in: ids } });
  }
  await client.close();
  console.log(`\nRESULT  pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
