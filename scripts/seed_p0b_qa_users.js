/**
 * P0B QA fixture accounts (DEV / PREVIEW DATABASE ONLY).
 * Idempotent: re-running never creates duplicates and never changes a role
 * that is already correct. Creates:
 *   • qa-p0b-admin@wavelead.dev   — admin (operations dashboard + release action)
 *   • qa-p0b-agent@wavelead.dev   — ordinary user WITH the sourcing designation
 *   • qa-p0b-owner@wavelead.dev   — ordinary creator (claims / fast verification)
 * Run: node scripts/seed_p0b_qa_users.js
 */
const { MongoClient } = require('mongodb');

const BASE = process.env.QA_BASE_URL || 'http://localhost:3000/api';
const PASSWORD = process.env.QA_P0B_PASSWORD || 'P0bWave!2026Qa';

const ACCOUNTS = [
  { email: 'qa-p0b-admin@wavelead.dev', display_name: 'P0B QA Admin', role: 'admin', sourcing: false },
  { email: 'qa-p0b-agent@wavelead.dev', display_name: 'P0B QA Sourcing Agent', role: 'user', sourcing: true },
  { email: 'qa-p0b-owner@wavelead.dev', display_name: 'P0B QA Owner', role: 'user', sourcing: false },
];

(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL || 'mongodb://localhost:27017');
  const db = client.db(process.env.DB_NAME || 'wavelead');
  const users = db.collection('users');

  for (const a of ACCOUNTS) {
    let user = await users.findOne({ email: a.email });
    if (!user) {
      const res = await fetch(`${BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: a.email, password: PASSWORD, display_name: a.display_name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        console.log(`  ! signup failed for ${a.email}:`, JSON.stringify(body).slice(0, 200));
      }
      user = await users.findOne({ email: a.email });
    }
    if (!user) { console.log(`  ! ${a.email} could not be created`); continue; }

    const patch = {};
    if (user.role !== a.role) patch.role = a.role;
    if ((user.is_sourcing_agent === true) !== a.sourcing) patch.is_sourcing_agent = a.sourcing;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date();
      await users.updateOne({ id: user.id }, { $set: patch });
    }
    console.log(`  ok ${a.email} role=${a.role} sourcing_agent=${a.sourcing}`);
  }

  await client.close();
  console.log('\nPassword for all P0B QA accounts:', PASSWORD);
})().catch((e) => { console.error(e); process.exit(1); });
