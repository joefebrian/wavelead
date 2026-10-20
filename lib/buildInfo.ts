// P0B — DEPLOYMENT IDENTITY.
//
// Values are injected at BUILD time (next.config / CI env) so they describe
// the actual deployed artifact, never the mutable workspace a running pod
// happens to sit on. Anything missing resolves to 'unknown' rather than
// guessing from git state at runtime.
//
// SECURITY: this module exposes ONLY commit / build time / environment /
// release id. It never reads secrets, connection strings, provider keys or
// infrastructure detail, and the public health endpoint does not use it.

export interface BuildInfo {
  commit: string;
  commit_short: string;
  build_time: string | null;
  environment: string;
  release_id: string;
  /** True when the deployment identity was actually stamped at build time. */
  stamped: boolean;
}

const UNKNOWN = 'unknown';

function firstNonEmpty(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    const s = (v ?? '').trim();
    if (s) return s;
  }
  return '';
}

export function getBuildInfo(): BuildInfo {
  const commit = firstNonEmpty(
    process.env.BUILD_COMMIT,
    process.env.GIT_COMMIT_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.SOURCE_COMMIT,
  ) || UNKNOWN;
  const buildTime = firstNonEmpty(process.env.BUILD_TIME) || null;
  const releaseId = firstNonEmpty(process.env.RELEASE_ID, process.env.DEPLOYMENT_ID) || UNKNOWN;
  const environment = firstNonEmpty(process.env.APP_ENV, process.env.NODE_ENV) || UNKNOWN;
  return {
    commit,
    commit_short: commit === UNKNOWN ? UNKNOWN : commit.slice(0, 12),
    build_time: buildTime,
    environment,
    release_id: releaseId,
    stamped: commit !== UNKNOWN,
  };
}

/**
 * Stable key used to make inventory snapshots idempotent per release+phase.
 * Falls back to the environment when no release id was stamped, so local and
 * preview runs still behave deterministically.
 */
export function currentReleaseKey(): string {
  const b = getBuildInfo();
  if (b.release_id !== UNKNOWN) return b.release_id;
  if (b.commit !== UNKNOWN) return `commit-${b.commit_short}`;
  return `env-${b.environment}`;
}
