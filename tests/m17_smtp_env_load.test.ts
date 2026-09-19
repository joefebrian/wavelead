// M17 — targeted SMTP env-LOADING test.
//
// Scope: verifies the mailer can correctly READ the production SMTP_* env
// variables once they are configured. No credentials are used, nothing is
// hardcoded, and no email is ever sent (nodemailer is never invoked here).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveSmtpConfig, isSmtpConfigured, smtpTransportOptions, smtpDiagnostics,
  readEnvValue, SMTP_ENV_KEYS, DEFAULT_SMTP_PORT, FALLBACK_SMTP_FROM,
} from '@/lib/services/smtpConfig';
import { hasSmtpTransport } from '@/lib/services/mailer';

const KEYS = [...SMTP_ENV_KEYS];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

function setEnv(v: Partial<Record<string, string>>) {
  for (const [k, val] of Object.entries(v)) process.env[k] = val as string;
}

describe('M17 SMTP env-loading', () => {
  it('1. unset env → not configured, no throw', () => {
    expect(isSmtpConfigured()).toBe(false);
    expect(hasSmtpTransport()).toBe(false);
    const cfg = resolveSmtpConfig();
    expect(cfg.host).toBeNull();
    expect(cfg.issues).toContain('missing_host');
    expect(cfg.port).toBe(DEFAULT_SMTP_PORT);
  });

  it('2. blank / whitespace-only values do NOT count as configured', () => {
    setEnv({ SMTP_HOST: '', SMTP_USER: '   ', SMTP_PASS: '\n' });
    expect(isSmtpConfigured()).toBe(false);
    const cfg = resolveSmtpConfig();
    expect(cfg.user).toBeNull();
    expect(cfg.pass).toBeNull();
  });

  it('3. quoted + whitespace-padded values load correctly', () => {
    setEnv({
      SMTP_HOST: '  "smtp.example.test" ',
      SMTP_PORT: ' "587"\r',
      SMTP_USER: "'ops@example.test'  ",
      SMTP_FROM: ' "WaveLead <ops@example.test>" ',
    });
    const cfg = resolveSmtpConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.host).toBe('smtp.example.test');
    expect(cfg.port).toBe(587);
    expect(cfg.user).toBe('ops@example.test');
    expect(cfg.from).toBe('WaveLead <ops@example.test>');
    expect(readEnvValue('SMTP_HOST')).toBe('smtp.example.test');
  });

  it('4. app-password whitespace grouping is stripped (auth would otherwise fail)', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'ops@example.test', SMTP_PASS: 'aaaa bbbb cccc dddd' });
    const cfg = resolveSmtpConfig();
    expect(cfg.pass).toBe('aaaabbbbccccdddd');
    expect(cfg.pass?.length).toBe(16);
  });

  it('5. port parsing: invalid falls back to 587 and is flagged; 465 implies TLS', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: 'not-a-port' });
    let cfg = resolveSmtpConfig();
    expect(cfg.port).toBe(DEFAULT_SMTP_PORT);
    expect(cfg.issues).toContain('invalid_port');
    expect(cfg.secure).toBe(false);

    setEnv({ SMTP_PORT: '465' });
    cfg = resolveSmtpConfig();
    expect(cfg.port).toBe(465);
    expect(cfg.secure).toBe(true);
  });

  it('6. from falls back to user, then to platform default; never invalid', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'ops@example.test' });
    expect(resolveSmtpConfig().from).toBe('ops@example.test');
    delete process.env.SMTP_USER;
    expect(resolveSmtpConfig().from).toBe(FALLBACK_SMTP_FROM);
    setEnv({ SMTP_FROM: 'garbage-not-an-email' });
    const cfg = resolveSmtpConfig();
    expect(cfg.issues).toContain('invalid_from');
    expect(cfg.from).toBe(FALLBACK_SMTP_FROM);
  });

  it('7. transport options are built from the normalized config only', () => {
    setEnv({ SMTP_HOST: ' smtp.example.test ', SMTP_PORT: '465', SMTP_USER: 'ops@example.test', SMTP_PASS: 'aaaa bbbb' });
    const opts = smtpTransportOptions(resolveSmtpConfig());
    expect(opts).toEqual({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      auth: { user: 'ops@example.test', pass: 'aaaabbbb' },
    });
    // No auth object when credentials are absent (open relay / local MTA).
    delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
    expect(smtpTransportOptions(resolveSmtpConfig()).auth).toBeUndefined();
  });

  it('8. diagnostics never leak the password or the full username', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'ops@example.test', SMTP_PASS: 'aaaa bbbb cccc dddd' });
    const d = smtpDiagnostics();
    const blob = JSON.stringify(d);
    expect(blob).not.toContain('aaaabbbbccccdddd');
    expect(blob).not.toContain('aaaa bbbb cccc dddd');
    expect(Object.keys(d)).not.toContain('user');   // raw username never exposed
    expect(Object.keys(d)).not.toContain('pass');   // password never exposed
    expect(d.user_masked).toBe('o***@example.test');
    expect(d.pass_present).toBe(true);
    expect(d.pass_length).toBe(16);
    expect(d.configured).toBe(true);
    expect(d.present_keys).toEqual(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']);
  });

  it('9. mailer still reuses the same resolver (single source of truth)', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test' });
    expect(hasSmtpTransport()).toBe(true);
    delete process.env.SMTP_HOST;
    expect(hasSmtpTransport()).toBe(false);
  });

  it('10. no SMTP secret is hardcoded in the resolver', async () => {
    const fs = await import('fs');
    const srcTxt = fs.readFileSync('lib/services/smtpConfig.ts', 'utf8');
    expect(srcTxt).not.toMatch(/smtp\.gmail\.com/);
    expect(srcTxt).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);
    // Nodemailer remains the only transport architecture.
    const mailerTxt = fs.readFileSync('lib/services/mailer.ts', 'utf8');
    expect(mailerTxt).toContain("import('nodemailer')");
    expect(mailerTxt).not.toMatch(/resend|sendgrid|postmark|mailgun/i);
  });
});
