# WaveLead — Rollback Checkpoints

## Milestone 03 — Ownership & Trust QA-passing (rollback anchor for M04)
- **Commit:** `d06abe9` (branch `main`)
- **Approved-by-user QA:** trust-state consistency fix, 33/33 automated tests, 49/49 responsive combos, full release-gate PASS.
- **Command to rollback:**
  ```
  git reset --hard d06abe9
  git clean -fd
  ```

## Milestone 02 — Ownership & Trust starting point (rollback anchor)
- **Commit:** `ee5bf5bcd1f5c7ea231413442343895f754ec0da` (short `ee5bf5b`)
- **Branch:** `main`
- **Approved-by-user QA:** 63/63 responsive PASS, 28/28 end-to-end assertions PASS,
  yarn typecheck / test / build all green. Deployed preview verified.
- **Command to rollback (invoked by user only):**
  ```
  git reset --hard ee5bf5b
  git clean -fd
  ```
- **Reason to rollback:** any M03 change breaks M00–M02 regression and cannot
  be fixed at the root cause. Do NOT rollback for cosmetic issues.

## PWA release (2026-10-29) — rollback anchor
- **Production before PWA:** P0C release, commit `e07f56f` (deployed 2026-10-21 ~16:38 UTC).
- **PWA release candidate:** commit `f5b1907` (+ unchanged yarn.lock drift already shipped with P0C).
  Diff vs `e07f56f`: PWA files only (manifest, /sw.js route, /offline, components/pwa, lib/pwa,
  icons, layout/Header/Footer entry points, GA4 event allowlist, tests). No server, payment, auth or DB changes.
- **Pre-deploy production baseline:** memory/pwa_pre_deploy_public_baseline.json
  (1,426 public channels, 1,019 owner-linked, 4 verified badges, Founding Lifetime checkout enabled/live).
- **Rollback procedure (verified in preview):**
  1. Kill switch FIRST: add backend env `PWA_SW_DISABLED=true` and redeploy → installed workers
     unregister themselves and delete all `wavelead-*` caches; sessions are kept.
  2. Only then roll back code to `e07f56f` if needed. A plain rollback WITHOUT the kill switch leaves
     already-installed workers registered (verified) — they still load pages from the network.
