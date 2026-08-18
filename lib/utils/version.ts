/**
 * Runtime version helper.
 * Reads the currently checked-out git commit SHA (short + long) so that
 * `GET /api/health` can prove which source tree is actually running.
 * The value is captured once at module load and cached for the lifetime
 * of the process — subsequent calls are O(1).
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

let cached: {
  commit: string;
  commitShort: string;
  commitTime: string | null;
  branch: string | null;
} | null = null;

function safeExec(cmd: string): string | null {
  try {
    const cwd = process.env.GIT_ROOT || path.resolve(process.cwd());
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function getVersionInfo() {
  if (cached) return cached;

  const envCommit = process.env.GIT_COMMIT || process.env.NEXT_PUBLIC_GIT_COMMIT;
  const commit =
    envCommit ||
    safeExec('git rev-parse HEAD') ||
    'unknown';
  const commitShort =
    (envCommit ? envCommit.slice(0, 7) : safeExec('git rev-parse --short HEAD')) ||
    (commit !== 'unknown' ? commit.slice(0, 7) : 'unknown');
  const commitTime =
    process.env.GIT_COMMIT_TIME ||
    safeExec('git log -1 --format=%cI') ||
    null;
  const branch =
    process.env.GIT_BRANCH ||
    safeExec('git rev-parse --abbrev-ref HEAD') ||
    null;

  cached = { commit, commitShort, commitTime, branch };
  return cached;
}
