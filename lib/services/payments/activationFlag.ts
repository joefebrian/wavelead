// M11-Batch2B release-safety: server-side feature flag for the Verified Owner
// Activation requirement. Defaults FALSE so existing verified owners keep
// their public "Owner Verified" state through deploys even while the $1
// activation is not yet unlocked. Enabling this must be a deliberate
// operator decision, made only AFTER a controlled live $1 smoke.
//
// Reads process.env at every call so `.env` toggles don't require a rebuild.
export function isActivationRequired(): boolean {
  const raw = (process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

// M11-Batch2B controlled LIVE rollout — CONCEPT A: "live checkout capability".
// Distinct from CONCEPT B (isActivationRequired, whether new owners are forced
// into activation). This flag ONLY governs whether the Owner-Activation payment
// path may run against a LIVE PayPal environment. Defaults FALSE so LIVE stays
// parked until the controlled $1 smoke passes. It NEVER weakens the global
// PayPal environment/credential protections in paypalConfigService.
//
// Sandbox is always allowed regardless of this flag.
export function isActivationLiveCheckoutEnabled(): boolean {
  const raw = (process.env.CHANNEL_OWNER_ACTIVATION_LIVE_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
