import { COLLECTIONS } from '../db/collections';
import { getCollection, stripIds } from '../db/mongo';
import type { IntegrationCredential, IntegrationEnvironment, IntegrationProvider } from '@/lib/types';

export const integrationCredentialRepo = {
  async findByProviderEnv(provider: IntegrationProvider, environment: IntegrationEnvironment): Promise<IntegrationCredential | null> {
    const c = await getCollection<IntegrationCredential>(COLLECTIONS.INTEGRATION_CREDENTIALS);
    const row = await c.findOne({ provider, environment });
    return row ? (stripIds([row])[0] as IntegrationCredential) : null;
  },
  async upsert(doc: IntegrationCredential): Promise<IntegrationCredential> {
    const c = await getCollection<IntegrationCredential>(COLLECTIONS.INTEGRATION_CREDENTIALS);
    await c.updateOne(
      { provider: doc.provider, environment: doc.environment },
      { $set: doc as never },
      { upsert: true },
    );
    return doc;
  },
  async updateConnectionTest(provider: IntegrationProvider, environment: IntegrationEnvironment, status: 'success' | 'failure', message: string | null): Promise<void> {
    const c = await getCollection<IntegrationCredential>(COLLECTIONS.INTEGRATION_CREDENTIALS);
    await c.updateOne(
      { provider, environment },
      { $set: { last_connection_test_at: new Date(), last_connection_test_status: status, last_connection_test_message: message, updated_at: new Date() } },
    );
  },
};
