// M18 — One navigation model for the whole authenticated product.
//
// Every href below is an EXISTING route (or a route introduced by M18). Admin
// items carry the minimum role required to see them, and the shell filters
// with the same rbac helper the pages themselves use — navigation can never
// advertise a route the current role cannot open. RBAC itself is unchanged:
// this is display filtering on top of the server-side guards.
import type { Role } from '@/lib/types';

export interface NavItem {
  href: string;
  label: string;
  /** Lucide icon name, resolved in the shell (keeps this file serializable). */
  icon: string;
  /** Minimum role required to SEE the item. Server-side guards still apply. */
  min_role?: Role;
  /** Match child routes as active too (default true). */
  prefix?: boolean;
  badge?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// ---------------------------------------------------------------- USER SHELL
// Terminology is the one already established in M16:
//   Owner  → "Incoming Requests"
//   Brand  → "Sent Requests"
//   Deal   → "Active Sponsorships"
// Campaign surfaces are deliberately named so they cannot be confused with
// direct sponsorship requests.
export const USER_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'LayoutDashboard', prefix: false },
    ],
  },
  {
    label: 'Channels',
    items: [
      { href: '/dashboard/channels', label: 'My Channels', icon: 'Radio' },
      { href: '/dashboard/claims', label: 'Verification & Claims', icon: 'ShieldCheck' },
      { href: '/submit', label: 'Submit a Channel', icon: 'Plus', prefix: false },
    ],
  },
  {
    label: 'Sponsorships',
    items: [
      { href: '/dashboard/sponsorship-requests', label: 'Incoming Requests', icon: 'Inbox' },
      { href: '/dashboard/sent-requests', label: 'Sent Requests', icon: 'Send' },
      { href: '/dashboard/sponsorships', label: 'Active Sponsorships', icon: 'Handshake', prefix: false },
      { href: '/dashboard/sponsorships/pipeline', label: 'Pipeline', icon: 'GitBranch' },
    ],
  },
  {
    label: 'Campaigns',
    items: [
      { href: '/dashboard/campaigns', label: 'My Campaigns (Brand)', icon: 'Megaphone' },
      { href: '/dashboard/opportunities', label: 'Campaign Opportunities', icon: 'Compass' },
      { href: '/dashboard/applications', label: 'Campaign Applications', icon: 'ClipboardList' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/dashboard/earnings', label: 'Earnings & Payouts', icon: 'Wallet' },
      { href: '/dashboard/billing', label: 'Billing', icon: 'CreditCard' },
      { href: '/dashboard/promotions', label: 'Promotions', icon: 'TrendingUp' },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/dashboard/settings/security', label: 'Security', icon: 'KeyRound' },
      { href: '/pricing', label: 'Plans & Pricing', icon: 'Tag', prefix: false },
    ],
  },
];

// --------------------------------------------------------------- ADMIN SHELL
// Replaces the overcrowded horizontal multi-row admin menu.
export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Overview', icon: 'LayoutDashboard', prefix: false, min_role: 'moderator' }],
  },
  {
    label: 'Channels',
    items: [
      { href: '/admin/channels?status=pending_review', label: 'Moderation', icon: 'Inbox', min_role: 'moderator' },
      { href: '/admin/claims?status=pending', label: 'Claims', icon: 'KeyRound', min_role: 'moderator' },
      { href: '/admin/channel-changes?status=pending', label: 'Sensitive Changes', icon: 'ShieldAlert', min_role: 'moderator' },
      { href: '/admin/audience-snapshots', label: 'Follower Evidence', icon: 'Image', min_role: 'moderator' },
      { href: '/admin/channels?status=approved', label: 'Approved Channels', icon: 'CheckCircle2', min_role: 'moderator' },
      { href: '/admin/channels?status=rejected', label: 'Rejected Channels', icon: 'XCircle', min_role: 'moderator' },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { href: '/admin/sponsorship-leads', label: 'Sponsorship Leads', icon: 'Handshake', min_role: 'moderator' },
      { href: '/admin/marketplace', label: 'Marketplace', icon: 'Store', min_role: 'admin' },
      { href: '/admin/campaigns', label: 'Campaigns', icon: 'Megaphone', min_role: 'moderator' },
      { href: '/admin/promotions', label: 'Promotions', icon: 'Sparkles', min_role: 'moderator' },
      { href: '/admin/promotion-rates', label: 'Promotion Rates', icon: 'TrendingUp', min_role: 'admin' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/payments', label: 'Payments', icon: 'Wallet', min_role: 'admin' },
      { href: '/admin/activation-payments', label: 'Owner Activation', icon: 'ShieldCheck', min_role: 'admin' },
      { href: '/admin/ledger', label: 'Ledger', icon: 'DollarSign', min_role: 'admin' },
      { href: '/admin/fx-rates', label: 'FX Rates', icon: 'ArrowLeftRight', min_role: 'admin' },
      { href: '/admin/payment-health', label: 'Payment Health', icon: 'Activity', min_role: 'admin' },
      { href: '/admin/settings/paypal', label: 'PayPal Settings', icon: 'Cog', min_role: 'super_admin' },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/admin/commercial-leads', label: 'Commercial Leads', icon: 'Mails', min_role: 'admin' },
      { href: '/admin/pricing', label: 'Pricing', icon: 'Tag', min_role: 'admin' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'Users', min_role: 'admin' },
      { href: '/admin/homepage', label: 'Homepage Curation', icon: 'Home', min_role: 'admin' },
    ],
  },
];

/** Strip the query string so `/admin/channels?status=x` compares on path. */
export function navPathOf(href: string): string {
  const q = href.indexOf('?');
  return q === -1 ? href : href.slice(0, q);
}

/**
 * Active-state resolution. Exact match for `prefix: false` items (so
 * /dashboard does not light up on every child route) and a boundary-safe
 * prefix match otherwise. Query strings never affect the active state.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const target = navPathOf(item.href);
  if (item.prefix === false) return pathname === target;
  return pathname === target || pathname.startsWith(`${target}/`);
}
