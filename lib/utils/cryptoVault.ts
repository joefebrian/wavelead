// AES-256-GCM authenticated encryption for provider credentials.
// Envelope: <iv_b64>.<ciphertext_b64>.<tag_b64>
//
// The master key comes from INTEGRATION_SECRETS_KEY. It must be:
//   * 32 raw bytes (256 bits)
//   * base64 or hex encoded — auto-detected
//   * NEVER stored in MongoDB
//   * NEVER shipped to the client
//   * NOT the same value as JWT_SECRET or any PayPal secret
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;                 // GCM standard
const SECRET_ENV = 'INTEGRATION_SECRETS_KEY';

function decodeMasterKey(): Buffer {
  const raw = (process.env[SECRET_ENV] || '').trim();
  if (!raw) throw new Error(`${SECRET_ENV} not configured`);
  // Try base64 first (44 chars ~ 32 bytes), then hex (64 chars).
  if (/^[A-Za-z0-9+/=]{40,48}$/.test(raw)) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  }
  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  }
  // Fallback: treat as raw UTF-8 and hash to 32 bytes.
  // We prefer explicit base64/hex; UTF-8 fallback only tolerates short strings.
  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;
  throw new Error(`${SECRET_ENV} must be 32 bytes (base64 or hex encoded).`);
}

/** Encrypt a UTF-8 string. Returns envelope <iv_b64>.<ct_b64>.<tag_b64>. */
export function encryptString(plaintext: string): string {
  const key = decodeMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

/** Decrypt an envelope produced by encryptString. Throws on tampering. */
export function decryptString(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 3) throw new Error('Invalid encryption envelope');
  const [ivB64, ctB64, tagB64] = parts;
  const key = decodeMasterKey();
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_LEN) throw new Error('Invalid IV length');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Mask a client ID so display shows only the last N characters. */
export function maskCredential(value: string, tail = 4): string {
  if (!value) return '';
  if (value.length <= tail) return '•'.repeat(value.length);
  return `•••• •••• ${value.slice(-tail)}`;
}

/** Test helper — checks the vault key is present without decoding. */
export function isVaultConfigured(): boolean {
  return !!(process.env[SECRET_ENV] && process.env[SECRET_ENV].trim());
}
