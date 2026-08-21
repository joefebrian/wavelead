// One-time backend maintenance: reset the password for the primary Super Admin.
//
// USAGE:
//   1. Set SUPER_ADMIN_RESET_PASSWORD=<plaintext> in .env (or the runtime environment).
//   2. Run:    node --env-file=.env scripts/resetSuperAdminPassword.mjs
//   3. Remove SUPER_ADMIN_RESET_PASSWORD from .env after the script prints SUCCESS.
//
// GUARANTEES:
//   * NOT invoked from application startup — this is an explicit CLI action only.
//   * Existing user ID / created_at / audit relationships preserved (targeted $set only).
//   * bcrypt-hashed on the server; plaintext is never persisted or logged.
//   * must_change_password → false (Super Admin is NOT force-rotated).
//   * session_version bumped → any previous session invalidated.
//   * A security_audit_events row is written with metadata that never contains the secret.
//   * Payment / funding / ledger / refund / FX / sponsorship / campaign code untouched.
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

const TARGET_EMAIL = 'hello@p2plabs.asia';
const RESET_ENV = 'SUPER_ADMIN_RESET_PASSWORD';

function redact(str) {
  if (!str) return '(empty)';
  return `••••••••(len=${str.length})`;
}

async function main() {
  const plaintext = (process.env[RESET_ENV] || '').trim();
  if (!plaintext) {
    console.error(`[reset-super-admin] ${RESET_ENV} is not set in the environment.`);
    console.error(`[reset-super-admin] Refusing to run without an explicit maintenance secret.`);
    process.exit(2);
  }
  if (plaintext.length < 10) {
    console.error(`[reset-super-admin] ${RESET_ENV} must be at least 10 characters.`);
    process.exit(3);
  }
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME;
  if (!mongoUrl || !dbName) {
    console.error('[reset-super-admin] MONGO_URL and DB_NAME must be set.');
    process.exit(4);
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const db = client.db(dbName);
    const users = db.collection('users');
    const audit = db.collection('security_audit_events');

    const existing = await users.findOne({ email: TARGET_EMAIL });

    // bcrypt: 12 rounds (same as authService.hashPassword default range).
    const password_hash = await bcrypt.hash(plaintext, 12);
    const now = new Date();

    let existingId;
    let nextVersion;
    let mode;
    if (existing) {
      if (existing.role !== 'super_admin') {
        // Preserve identity but promote to super_admin so operational login is stable.
        console.warn(`[reset-super-admin] Existing user has role="${existing.role}"; promoting to super_admin.`);
      }
      existingId = existing.id;
      nextVersion = (existing.session_version ?? 0) + 1;
      mode = 'update_existing';
      // Targeted $set only — preserves id, created_at, display_name, avatar_url, auth_providers, etc.
      await users.updateOne(
        { id: existing.id },
        {
          $set: {
            role: 'super_admin',
            password_hash,
            password_updated_at: now,
            must_change_password: false,      // Super Admin NOT force-rotated.
            is_disabled: false,               // Ensure the account remains enabled.
            session_version: nextVersion,     // Invalidate any previously issued cookies.
            updated_at: now,
          },
        },
      );
    } else {
      // The primary Super Admin was wiped (e.g. by a test suite). Re-seed with intent.
      existingId = cryptoRandomId();
      nextVersion = 0;
      mode = 'reseed_missing';
      await users.insertOne({
        id: existingId,
        email: TARGET_EMAIL,
        display_name: 'WaveLead Super Admin',
        avatar_url: null,
        role: 'super_admin',
        country_code: null,
        preferred_language: 'en',
        password_hash,
        password_updated_at: now,
        must_change_password: false,
        is_disabled: false,
        session_version: nextVersion,
        auth_providers: ['password'],
        created_at: now,
        updated_at: now,
      });
    }

    // Audit trail — metadata carries NO plaintext / hash.
    await audit.insertOne({
      id: cryptoRandomId(),
      event_type: 'SUPER_ADMIN_PASSWORD_BACKEND_RESET',
      actor_user_id: existingId,
      actor_email: TARGET_EMAIL,
      subject_user_id: existingId,
      metadata: {
        target_email: TARGET_EMAIL,
        method: 'cli_maintenance',
        mode,
        session_version_after: nextVersion,
        run_at: now.toISOString(),
      },
      created_at: now,
    });

    // Deliberately do NOT print the plaintext, the hash, or any prefix of either.
    console.log('[reset-super-admin] SUCCESS');
    console.log(`  email             : ${TARGET_EMAIL}`);
    console.log(`  mode              : ${mode}`);
    console.log(`  user_id_preserved : ${existingId}`);
    console.log(`  role              : super_admin`);
    console.log(`  new_session_version: ${nextVersion}`);
    console.log(`  password_length   : ${redact(plaintext)}   (not persisted plaintext)`);
    console.log('');
    console.log('NEXT STEP: remove SUPER_ADMIN_RESET_PASSWORD from .env and restart Next.js.');
  } finally {
    await client.close();
  }
}

// Small UUID-ish (no import to keep this script dependency-light).
function cryptoRandomId() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

main().catch((e) => {
  console.error('[reset-super-admin] ERROR:', e.message || String(e));
  process.exit(1);
});
