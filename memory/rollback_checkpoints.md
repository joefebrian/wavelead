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
