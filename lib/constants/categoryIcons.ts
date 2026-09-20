// M18 — Category visual language.
//
// Icon + accent mapping for category discovery. This is presentation ONLY:
//   • category slugs, URLs, SEO metadata and taxonomy semantics are untouched;
//   • no per-category image assets (Lucide icons only, matching the rest of
//     the product);
//   • an unmapped category still renders correctly through keyword inference
//     and a neutral default, so adding a category never breaks /categories.
import {
  ShoppingBag, BadgePercent, TicketPercent, PackageSearch, Store, Smartphone,
  Sparkles, Shirt, Plane, Utensils, House, WalletCards, Music, Trophy,
  Newspaper, Clapperboard, GraduationCap, HeartPulse, Briefcase, Gamepad2,
  Car, Baby, Dumbbell, Camera, BookOpen, Palette, Rocket, Landmark, Dog,
  Languages, Cpu, Leaf, Tag, LayoutGrid, Users, UsersRound, MapPin,
  BriefcaseBusiness, Coins, BrainCircuit, type LucideIcon,
} from 'lucide-react';

export interface CategoryVisual {
  icon: LucideIcon;
  /** Tailwind classes for the icon tile. Accents stay subtle and on-brand. */
  accent: string;
}

const A = {
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  sky: 'bg-sky-100 text-sky-700',
  violet: 'bg-violet-100 text-violet-700',
  slate: 'bg-slate-100 text-slate-700',
  orange: 'bg-orange-100 text-orange-700',
  teal: 'bg-teal-100 text-teal-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  lime: 'bg-lime-100 text-lime-700',
} as const;

/** slug → visual. Slugs are the canonical taxonomy keys and are never changed here. */
export const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  'affiliate-shopping': { icon: ShoppingBag, accent: A.amber },
  'deals-discounts': { icon: BadgePercent, accent: A.rose },
  'coupons-promotions': { icon: TicketPercent, accent: A.rose },
  'product-recommendations': { icon: PackageSearch, accent: A.amber },
  'e-commerce': { icon: Store, accent: A.orange },
  ecommerce: { icon: Store, accent: A.orange },
  shopping: { icon: ShoppingBag, accent: A.amber },
  'tech-gadgets': { icon: Smartphone, accent: A.sky },
  technology: { icon: Cpu, accent: A.sky },
  tech: { icon: Cpu, accent: A.sky },
  'beauty-personal-care': { icon: Sparkles, accent: A.rose },
  beauty: { icon: Sparkles, accent: A.rose },
  fashion: { icon: Shirt, accent: A.violet },
  'travel-deals': { icon: Plane, accent: A.teal },
  travel: { icon: Plane, accent: A.teal },
  'food-dining-deals': { icon: Utensils, accent: A.orange },
  food: { icon: Utensils, accent: A.orange },
  'food-drink': { icon: Utensils, accent: A.orange },
  'home-lifestyle': { icon: House, accent: A.lime },
  lifestyle: { icon: House, accent: A.lime },
  'finance-offers': { icon: WalletCards, accent: A.emerald },
  finance: { icon: Landmark, accent: A.emerald },
  business: { icon: Briefcase, accent: A.slate },
  music: { icon: Music, accent: A.violet },
  sports: { icon: Trophy, accent: A.emerald },
  fitness: { icon: Dumbbell, accent: A.emerald },
  news: { icon: Newspaper, accent: A.slate },
  entertainment: { icon: Clapperboard, accent: A.violet },
  education: { icon: GraduationCap, accent: A.indigo },
  health: { icon: HeartPulse, accent: A.rose },
  'health-fitness': { icon: HeartPulse, accent: A.rose },
  gaming: { icon: Gamepad2, accent: A.indigo },
  automotive: { icon: Car, accent: A.slate },
  parenting: { icon: Baby, accent: A.rose },
  photography: { icon: Camera, accent: A.slate },
  books: { icon: BookOpen, accent: A.indigo },
  art: { icon: Palette, accent: A.violet },
  'art-design': { icon: Palette, accent: A.violet },
  startups: { icon: Rocket, accent: A.sky },
  religion: { icon: Landmark, accent: A.slate },
  pets: { icon: Dog, accent: A.lime },
  language: { icon: Languages, accent: A.indigo },
  environment: { icon: Leaf, accent: A.lime },
  // Canonical WaveLead categories seen in production discovery.
  politics: { icon: Landmark, accent: A.slate },
  'movies-tv': { icon: Clapperboard, accent: A.violet },
  creators: { icon: Users, accent: A.indigo },
  community: { icon: UsersRound, accent: A.indigo },
  local: { icon: MapPin, accent: A.teal },
  jobs: { icon: BriefcaseBusiness, accent: A.slate },
  crypto: { icon: Coins, accent: A.emerald },
  ai: { icon: BrainCircuit, accent: A.sky },
  deals: { icon: BadgePercent, accent: A.rose },
};

/** Keyword inference so unmapped / future categories still look intentional. */
const KEYWORDS: ReadonlyArray<[RegExp, CategoryVisual]> = [
  [/affiliate|shop/i, { icon: ShoppingBag, accent: A.amber }],
  [/deal|discount|promo|sale/i, { icon: BadgePercent, accent: A.rose }],
  [/coupon|voucher/i, { icon: TicketPercent, accent: A.rose }],
  [/review|recommend|product/i, { icon: PackageSearch, accent: A.amber }],
  [/commerce|store|market/i, { icon: Store, accent: A.orange }],
  [/tech|gadget|software|ai/i, { icon: Cpu, accent: A.sky }],
  [/beauty|skincare|cosmet/i, { icon: Sparkles, accent: A.rose }],
  [/fashion|style|cloth/i, { icon: Shirt, accent: A.violet }],
  [/travel|flight|trip|tour/i, { icon: Plane, accent: A.teal }],
  [/food|dining|restaurant|recipe|culinar/i, { icon: Utensils, accent: A.orange }],
  [/home|living|lifestyle|interior/i, { icon: House, accent: A.lime }],
  [/financ|invest|money|crypto|bank/i, { icon: WalletCards, accent: A.emerald }],
  [/music|song|audio/i, { icon: Music, accent: A.violet }],
  [/sport|football|soccer|match/i, { icon: Trophy, accent: A.emerald }],
  [/news|politic|current/i, { icon: Newspaper, accent: A.slate }],
  [/entertain|movie|film|celeb|drama/i, { icon: Clapperboard, accent: A.violet }],
  [/educat|study|school|learn|course/i, { icon: GraduationCap, accent: A.indigo }],
  [/health|medic|wellness/i, { icon: HeartPulse, accent: A.rose }],
  [/fit|gym|workout/i, { icon: Dumbbell, accent: A.emerald }],
  [/game|gaming|esport/i, { icon: Gamepad2, accent: A.indigo }],
  [/auto|car|motor/i, { icon: Car, accent: A.slate }],
  [/parent|family|kid|baby/i, { icon: Baby, accent: A.rose }],
  [/photo|camera/i, { icon: Camera, accent: A.slate }],
  [/book|read|literat/i, { icon: BookOpen, accent: A.indigo }],
  [/art|design|creativ/i, { icon: Palette, accent: A.violet }],
  [/startup|business|entrepreneur|career/i, { icon: Briefcase, accent: A.slate }],
  [/pet|animal|dog|cat/i, { icon: Dog, accent: A.lime }],
  [/languag|english|arab/i, { icon: Languages, accent: A.indigo }],
  [/environment|green|climate|nature/i, { icon: Leaf, accent: A.lime }],
  [/islam|quran|religio|faith|church/i, { icon: Landmark, accent: A.slate }],
  [/creator|influencer/i, { icon: Users, accent: A.indigo }],
  [/communit|forum|group/i, { icon: UsersRound, accent: A.indigo }],
  [/local|city|region|neighbou?r/i, { icon: MapPin, accent: A.teal }],
  [/job|vacanc|hiring|recruit/i, { icon: BriefcaseBusiness, accent: A.slate }],
  [/crypto|bitcoin|web3|token/i, { icon: Coins, accent: A.emerald }],
  [/\bai\b|machine learning|llm/i, { icon: BrainCircuit, accent: A.sky }],
  [/movie|tv|series|show/i, { icon: Clapperboard, accent: A.violet }],
];

export const DEFAULT_CATEGORY_VISUAL: CategoryVisual = { icon: LayoutGrid, accent: A.slate };
export const OTHER_CATEGORY_VISUAL: CategoryVisual = { icon: Tag, accent: A.slate };

/**
 * Resolve the visual for a category. Never throws and never returns undefined,
 * so a new or renamed category can never break the discovery page.
 */
export function categoryVisual(slug: string | null | undefined, name?: string | null): CategoryVisual {
  const key = (slug || '').trim().toLowerCase();
  if (key && CATEGORY_VISUALS[key]) return CATEGORY_VISUALS[key];
  const haystack = `${key} ${(name || '').toLowerCase()}`;
  for (const [re, v] of KEYWORDS) if (re.test(haystack)) return v;
  if (/other|misc|general/i.test(haystack)) return OTHER_CATEGORY_VISUAL;
  return DEFAULT_CATEGORY_VISUAL;
}
