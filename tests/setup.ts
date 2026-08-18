// Load .env for tests and normalize test-only overrides.
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) config({ path: envPath });

// Tests hit the running dev server (port 3000), so we MUST use the same
// DB the server uses (default `wavelead`). The tests only manipulate the
// `users` collection and reseed via runSeed() which is idempotent.
process.env.DB_NAME = process.env.DB_NAME || 'wavelead';
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@wavelead.dev';
process.env.BOOTSTRAP_ENABLED = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
