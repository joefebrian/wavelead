// Popular interest search suggestions displayed on the homepage.
export const POPULAR_SEARCHES: string[] = [
  'Football', 'Finance', 'AI', 'Entertainment', 'Deals',
  'News', 'Gaming', 'Creators', 'Travel', 'Crypto',
];

// Editorial collections — lightweight mapping into existing search/category routes.
export interface CollectionEntry {
  title: string;
  description: string;
  href: string;
  gradient: string; // Tailwind gradient utility class
}

export const COLLECTIONS: CollectionEntry[] = [
  { title: 'Football Fans', description: 'Matches, transfers and highlights', href: '/search?q=football', gradient: 'from-emerald-500 to-teal-600' },
  { title: 'Stock Market', description: 'Market moves, IPOs & earnings', href: '/category/finance', gradient: 'from-blue-500 to-indigo-600' },
  { title: 'AI & Technology', description: 'Weekly AI research + product drops', href: '/category/ai', gradient: 'from-fuchsia-500 to-purple-600' },
  { title: 'Movie Lovers', description: 'New releases and festival picks', href: '/category/movies-tv', gradient: 'from-orange-500 to-rose-600' },
  { title: 'Travel Deals', description: 'Flights, hotels and hidden gems', href: '/category/travel', gradient: 'from-cyan-500 to-sky-600' },
  { title: 'Gaming', description: 'Esports, mobile and console news', href: '/category/gaming', gradient: 'from-violet-500 to-fuchsia-600' },
  { title: 'Creator Updates', description: 'Independent voices worth following', href: '/category/creators', gradient: 'from-amber-500 to-orange-600' },
  { title: 'Local News', description: 'Community-driven updates near you', href: '/category/news', gradient: 'from-slate-600 to-slate-800' },
];
