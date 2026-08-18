# WaveLead — Rollback Checkpoints

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
