// Re-export the editorial collections list with a cleaner alias used by the
// homepage (kept as a thin wrapper to avoid churning imports across pages).
export { COLLECTIONS } from './discovery';
export type { CollectionEntry } from './discovery';
