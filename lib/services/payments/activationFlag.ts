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
