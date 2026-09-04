// M07-GOOGLE start-URL guard — unit test for the browser-facing auth start host.
//
// Incident 2026-09-03: production EMERGENT_AUTH_HOST=http://as.int.apis.emergentagent.com
// leaked to the browser via the old host+path composition → ERR_ADDRESS_UNREACHABLE
// before Google. The browser start URL must ALWAYS be a public https host and must
// NEVER be an internal/service-discovery host, even if EMERGENT_AUTH_START_URL is
// misconfigured. buildStartUrl() reads process.env at call time.
import { describe, it, expect, afterEach } from 'vitest';
import { buildStartUrl } from '@/lib/services/auth/emergentGoogleAdapter';

const CALLBACK = 'https://wavelead.org/auth/google/callback';
const PUBLIC = 'https://auth.emergentagent.com/';

afterEach(() => {
  delete process.env.EMERGENT_AUTH_START_URL;
});

describe('M07-google — browser start URL guard', () => {
  it('defaults to the public auth.emergentagent.com host with the callback as redirect', () => {
    delete process.env.EMERGENT_AUTH_START_URL;
    const url = buildStartUrl(CALLBACK);
    expect(url.startsWith(PUBLIC)).toBe(true);
    expect(new URL(url).searchParams.get('redirect')).toBe(CALLBACK);
  });

  it('REFUSES the internal service host and falls back to the public host', () => {
    process.env.EMERGENT_AUTH_START_URL = 'http://as.int.apis.emergentagent.com/auth/v1/env/oauth';
    const url = buildStartUrl(CALLBACK);
    expect(url.startsWith(PUBLIC)).toBe(true);
    expect(url).not.toContain('int.apis.emergentagent.com');
    expect(url.startsWith('http://')).toBe(false);
  });

  it('REFUSES any non-https override (http/localhost/cluster-internal)', () => {
    for (const bad of [
      'http://auth.emergentagent.com/',
      'https://localhost:3000/',
      'https://foo.svc.cluster.local/',
      'https://something.internal/',
    ]) {
      process.env.EMERGENT_AUTH_START_URL = bad;
      expect(buildStartUrl(CALLBACK).startsWith(PUBLIC)).toBe(true);
    }
  });

  it('honors a valid PUBLIC https override', () => {
    process.env.EMERGENT_AUTH_START_URL = 'https://auth.emergentagent.com/';
    const url = buildStartUrl(CALLBACK);
    expect(url.startsWith(PUBLIC)).toBe(true);
    expect(new URL(url).searchParams.get('redirect')).toBe(CALLBACK);
  });
});
