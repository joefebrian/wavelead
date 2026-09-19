// M17 — Single, normalized SMTP environment resolver.
//
// WHY THIS EXISTS
// ---------------
// The mailer previously read `process.env.SMTP_*` raw in two places. That made
// production configuration fragile: a value that *looked* correct in the
// secrets UI could still fail to load usefully at runtime because of
//   • surrounding quotes  — SMTP_HOST="smtp.provider.example"
//   • stray whitespace / trailing newlines pasted from a console
//   • a blank-but-present value ("" or " ") reading as "configured"
//   • SMTP_PORT arriving quoted / non-numeric → Number() === NaN → no connect
//   • Google Workspace app passwords, which are DISPLAYED in 4-char groups
//     ("abcd efgh ijkl mnop") and are almost always pasted with the spaces
//
// This module fixes the *loading* layer only. It introduces no new provider,
// no OAuth, no credentials, and no hardcoded values — it just makes the
// existing Nodemailer transport read the existing env variables correctly
// once they are configured in production:
//
//   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  SMTP_FROM
//
// It also exposes a fully redacted diagnostics snapshot so operators can
// verify configuration without sending an email and without ever printing a
// secret.

export const SMTP_ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
export type SmtpEnvKey = typeof SMTP_ENV_KEYS[number];

export const DEFAULT_SMTP_PORT = 587;
export const FALLBACK_SMTP_FROM = 'no-reply@wavelead.dev';

export type SmtpConfigIssue =
  | 'missing_host'
  | 'missing_user'
  | 'missing_pass'
  | 'invalid_port'
  | 'invalid_from';

export interface SmtpConfig {
  /** True only when a usable host is present. Never true for blank values. */
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  /** Non-fatal configuration warnings, safe to log. Never contains secrets. */
  issues: SmtpConfigIssue[];
}

/**
 * Read one env var defensively.
 *  - undefined / null / blank (incl. whitespace-only) → null
 *  - strips a single pair of matching wrapping quotes
 *  - trims surrounding whitespace and stray CR from pasted values
 */
export function readEnvValue(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[name];
  if (typeof raw !== 'string') return null;
  let v = raw.replace(/\r/g, '').trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.length ? v : null;
}

function parsePort(raw: string | null): { port: number; invalid: boolean } {
  if (raw === null) return { port: DEFAULT_SMTP_PORT, invalid: false };
  const digits = raw.replace(/[^0-9]/g, '');
  const n = Number(digits);
  if (!digits.length || !Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
    return { port: DEFAULT_SMTP_PORT, invalid: true };
  }
  return { port: n, invalid: false };
}

function looksLikeEmail(v: string | null): boolean {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Resolve the effective, normalized SMTP configuration from the environment. */
export function resolveSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const issues: SmtpConfigIssue[] = [];

  const host = readEnvValue('SMTP_HOST', env);
  if (!host) issues.push('missing_host');

  const { port, invalid: portInvalid } = parsePort(readEnvValue('SMTP_PORT', env));
  if (portInvalid) issues.push('invalid_port');

  const user = readEnvValue('SMTP_USER', env);
  if (!user) issues.push('missing_user');

  // App passwords are shown grouped ("abcd efgh ijkl mnop") and are nearly
  // always pasted with the spaces intact. Internal whitespace is never part
  // of the credential, so remove it rather than failing auth.
  const rawPass = readEnvValue('SMTP_PASS', env);
  const pass = rawPass ? rawPass.replace(/\s+/g, '') || null : null;
  if (!pass) issues.push('missing_pass');

  const fromEnv = readEnvValue('SMTP_FROM', env);
  let from = fromEnv || user || FALLBACK_SMTP_FROM;
  // Accept both "name@example.com" and `Display Name <name@example.com>`.
  const angle = /<([^<>]+)>\s*$/.exec(from);
  const addr = angle ? angle[1].trim() : from;
  if (!looksLikeEmail(addr)) {
    issues.push('invalid_from');
    from = user && looksLikeEmail(user) ? user : FALLBACK_SMTP_FROM;
  }

  return {
    configured: !!host,
    host,
    port,
    secure: port === 465, // implicit TLS on 465, STARTTLS on 587/25
    user,
    pass,
    from,
    issues,
  };
}

/** True iff a usable SMTP host is configured (blank values do not count). */
export function isSmtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSmtpConfig(env).configured;
}

/** Nodemailer transport options derived from the normalized config. */
export function smtpTransportOptions(cfg: SmtpConfig) {
  return {
    host: cfg.host as string,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  };
}

function maskAddress(v: string | null): string | null {
  if (!v) return null;
  const at = v.indexOf('@');
  if (at <= 0) return `${v.slice(0, 1)}***`;
  return `${v.slice(0, 1)}***${v.slice(at)}`;
}

export interface SmtpDiagnostics {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  from: string | null;
  user_masked: string | null;
  user_present: boolean;
  pass_present: boolean;
  pass_length: number;
  issues: SmtpConfigIssue[];
  /** Which SMTP_* keys resolved to a usable (non-blank) value. */
  present_keys: SmtpEnvKey[];
}

/**
 * Redacted snapshot for operator verification. NEVER returns a password or a
 * full username — only presence, length and a masked address.
 */
export function smtpDiagnostics(env: NodeJS.ProcessEnv = process.env): SmtpDiagnostics {
  const cfg = resolveSmtpConfig(env);
  return {
    configured: cfg.configured,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    from: cfg.configured ? cfg.from : null,
    user_masked: maskAddress(cfg.user),
    user_present: !!cfg.user,
    pass_present: !!cfg.pass,
    pass_length: cfg.pass ? cfg.pass.length : 0,
    issues: cfg.issues,
    present_keys: SMTP_ENV_KEYS.filter((k) => readEnvValue(k, env) !== null),
  };
}
