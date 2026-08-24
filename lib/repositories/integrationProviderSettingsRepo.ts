// M07-security PayPal-activation patch — per-provider active-environment store.
//
// This repository owns the single canonical row `{ provider: 'paypal' }` and
// nothing else. It NEVER stores credentials — those live in
// `integration_credentials`. Uniqueness is enforced both by the collection
// index (see lib/db/indexes.ts) and by the atomic upsert-by-provider query
// used below.
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '../db/collections';
import { getCollection, stripIds } from '../db/mongo';
import type { IntegrationEnvironment, IntegrationProvider, IntegrationProviderSettings } from '@/lib/types';

export const integrationProviderSettingsRepo = {
  async getForProvider(provider: IntegrationProvider): Promise<IntegrationProviderSettings | null> {
    const c = await getCollection<IntegrationProviderSettings>(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS);
    const row = await c.findOne({ provider });
    return row ? (stripIds([row])[0] as IntegrationProviderSettings) : null;
  },

  /**
   * Atomic upsert of the active_environment for `provider`.
   * Uses the unique index on `provider` to guarantee that concurrent admin
   * actions can never create a second row for the same provider.
   */
  async setActiveEnvironment(
    provider: IntegrationProvider,
    environment: IntegrationEnvironment,
    actor_user_id: string,
  ): Promise<IntegrationProviderSettings> {
    const c = await getCollection<IntegrationProviderSettings>(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS);
    const now = new Date();
    await c.updateOne(
      { provider },
      {
        $set: {
          provider,
          active_environment: environment,
          updated_by: actor_user_id,
          updated_at: now,
        } as never,
        $setOnInsert: {
          id: uuidv4(),
          created_at: now,
        } as never,
      },
      { upsert: true },
    );
    const row = await c.findOne({ provider });
    return stripIds([row!])[0] as IntegrationProviderSettings;
  },
};
