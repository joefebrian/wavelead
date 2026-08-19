# WaveLead
## The Growth Infrastructure for WhatsApp Channels

WaveLead is an independent platform and is not affiliated with WhatsApp or Meta.

---

## 1. Product Overview

WaveLead is the growth infrastructure for WhatsApp Channels. It helps the public
discover WhatsApp Channels and gives verified channel owners the tooling they
need to understand and improve discovery and growth performance.

**Core product loop:**

```
Discover  →  Follow Intent  →  Measure  →  Grow  →  Monetize
```

WaveLead does **not** claim confirmed WhatsApp follower attribution. Everything
we measure is the observable public-side of the funnel — impressions, profile
views, and follow **intent** (the moment a visitor clicks through to WhatsApp
via WaveLead).

---

## 2. Current Capabilities

### Public Discovery
- Discovery-first homepage (rising, top, category rails)
- Full-text search
- Trending
- Top Channels
- Category discovery
- Country discovery
- Channel profiles (approved-only public visibility)

### Supply & Moderation
- Submit Channel workflow (`pending_review`)
- Moderator approve / reject
- Homepage curation slots
- Approved-only public visibility (rejected and pending channels never leak)

### Follow Intent
- `/go/[slug]` redirect to the underlying WhatsApp URL for approved channels
- Raw **Follow Click** tracking per visit
- 24-hour deduplicated **Unique Follow Intent** per anonymous session

### Ownership & Trust
- Claim Channel workflow
- Ownership evidence capture (kept private)
- Moderator review of claims (approve / reject / request info / resubmit / cancel)
- Verified ownership state
- Official channel state (separate from Verified)
- Owner-side channel management (safe fields only)
- Sensitive change requests (name/logo/URL/etc.) go through moderator review

### Owner Analytics
- Profile Views
- Discovery Impressions and Search Impressions
- Follow Clicks (raw)
- Unique Follow Intent (24-hour dedup)
- Click-Through Rate
- Acquisition sources breakdown
- Search terms (privacy threshold ≥ 3 impressions)
- Geography and device context
- CSV export
- Daily rollup aggregation

### Smart Channel Import (M05.0)
- WhatsApp Channel URL normalization (whatsapp.com / wa.me → canonical id)
- Duplicate detection **before** any outbound fetch or LLM call
- Public metadata enrichment (Open Graph / social tags)
- LLM-based **category / language / country** suggestions with per-field
  provenance and confidence
- Manual fallback whenever metadata or inference is unavailable
- Enrichment cache and rate limits
- SSRF protection (allowlisted hosts, no private IPs, no arbitrary redirects)

### Promote Channel / Sponsored Discovery (M05.1)
- Verified channel owners can promote their own approved channels
- WaveLead-owned advertising inventory (not a channel-owner marketplace)
- Objectives: **Increase Visibility** or **Drive Follow Intent**
- Sponsored placements: Search, Homepage, Category, Country, Related Channels
  (Trending and Top Channels are **never** paid — organic-only)
- Contextual targeting only: country / language / category (no behavioural or
  sensitive-attribute targeting)
- Admin-controlled CPM rate cards; per-country override + global fallback
- Rate snapshot on submission (later admin edits never rewrite history)
- Frequency cap: rolling 24 h, max 3 impressions per campaign per anon session
- Atomic budget/impression accounting (no overspend under concurrency)
- Signed 15-minute attribution tokens, session-bound (no `?campaign_id=` trust)
- Sponsored candidates are returned as a **separate `sponsored[]` array**;
  organic ranking (`items[]`, WaveScore, Trending, Top) is provably untouched
- Every sponsored card is clearly labelled `Sponsored`

### Payments, Campaign Funding & Ledger (M06.0)
- **PayPal Sandbox-backed** payment provider integration (Stripe parked; no
  live production payments yet; no additional providers)
- **Campaign-specific funding**: each promoted campaign is funded via its own
  PayPal order; campaign delivery is gated on `funded_amount >= budget`
- **USD micros accounting** throughout — `$1.00 = 1,000,000 micros`,
  strict integer math, never floating point
- **Immutable double-entry ledger**: every money movement (funding, spend,
  refund) posts one balanced transaction (`sum(debits) == sum(credits)`);
  rows are append-only, deduplicated by a unique `idempotency_key`
- **Sponsored spend accounting**: each accepted qualifying impression posts
  a spend debit at the campaign's CPM rate snapshot
  (e.g. 100 impressions × $2 CPM → 200,000 micros)
- **Refund workflow**: owner cancels → server computes unused refundable
  amount from the ledger → admin executes provider refund; owners cannot
  hit the provider directly; refunds are amount-tamper-proof (re-verified
  from ledger at execute time), idempotent (PayPal-Request-Id + state
  machine + ledger idempotency), and the `provider_refund_id` is persisted
  on the payment record and surfaced in the admin payment detail
- **Reconciliation service**: idempotent payment reconciliation that never
  downgrades a terminal-successful funding row from a stale/late event
- **Owner billing UI** (`/dashboard/billing`, `/dashboard/billing/[id]`):
  payment list + detail with campaign funding summary
- **Admin payment operations** (`/admin/payments`, `/admin/payments/[id]`):
  cross-tenant payment list, ledger reconciliation view, refund actions,
  safe provider references only
- **Read-only ledger viewer** (`/admin/ledger`): filter by campaign or
  transaction type; no arbitrary financial editing
- **Payment health dashboard** (`/admin/payment-health`): pending/failed
  payments, pending/failed refunds, webhook processing failures, ledger
  integrity issue count, reconciliation-needed records
- Not yet: subscriptions, wallet, marketplace/creator payouts, additional
  payment providers, sponsorship marketplace, tax invoice engine
  (all deferred to later milestones)

### Indonesia Currency & Local Payment Readiness (M06.1)
- **Canonical accounting stays USD** — the ad ledger, campaign budget,
  and sponsored spend continue in USD micros; **no IDR value is ever
  written to a USD micros account**
- **Admin-managed USD → IDR conversion rate** (`funding_fx_rates`
  collection, append-only history) — no live FX API, no market-rate
  feed, no spread engine
- **Integer-safe fixed-point conversion**: rates are stored as
  `rate_scaled / 10^rate_scale`; all arithmetic goes through `BigInt`.
  Checkout uses CEIL rounding (never under-collect), refunds use FLOOR
  (never over-refund). Any residual sub-rupiah delta is reported as an
  explicit `fx_rounding_adjustment_micros`.
- **Immutable locked FX quotes** (`funding_fx_quotes`) — once created,
  a quote's rate/amount fields are frozen; only `status` can transition
  (`open → expired / consumed`). A new active rate never re-prices
  existing quotes.
- **Owner IDR-equivalent display** on `/dashboard/promotions/[id]`:
  campaign budget shown in dollars alongside the current Rupiah
  equivalent; a **Local Payment "Coming Soon"** panel makes it clear
  that no IDR checkout is actionable yet
- **PayPal remains the only actionable funding option** — the Local
  Payment button is intentionally disabled; no code path routes any
  payment to a local provider in M06.1
- **Provider capability metadata** — `PAYPAL_CAPABILITIES` /
  `LOCAL_PAYMENT_CAPABILITIES` document what each provider supports
  (currencies, refund/partial-refund, hosted checkout, async
  confirmation). Business logic consults capabilities rather than
  string-matching provider names, so a future local-payment adapter
  can plug in without touching campaign business logic.
- **Admin FX UI** (`/admin/fx-rates`, admin/super_admin only): view the
  active rate, add + activate a new one, view retirement history.
  Historical rate rows are never mutated in place.
- **Payment health readiness signals** on `/admin/payment-health`:
  PayPal `configured`, local payment `not_configured`, USD/IDR rate
  presence. Missing local provider is informational only, never a
  health error.
- **Payment funding order schema** is now provider/currency-neutral
  (`payment_currency`, `payment_amount_provider_units`, `fx_quote_id`,
  `provider_session_id`, `provider_channel_code`), backward-compatible
  with all M06.0 PayPal records
- Not yet: Xendit / Midtrans / Stripe integration, QRIS / VA /
  e-wallet checkouts, live FX API, global multi-currency, IDR
  refunds, manual local refund workflow, subscriptions, wallet, tax
  engine, marketplace payouts (all future milestones)

---

## 3. Product Flow

### Public User
```
Discover  →  Search / Browse  →  Channel Profile  →  Follow on WhatsApp
```

### Channel Owner
```
Submit / Claim  →  Verify Ownership  →  Manage Channel
               →  View Analytics    →  Promote Channel  →  Grow
```

---

## 4. Architecture

- **Runtime:** Next.js 15 App Router (React Server Components + API routes)
- **Language:** TypeScript (strict)
- **Database:** MongoDB with UUID identifiers on every domain document
- **Frontend:** Tailwind CSS + shadcn/ui + Radix primitives + lucide-react

### Layering (strict)

```
UI (app/, components/)
        │
        ▼
API dispatcher (app/api/[[...path]]/route.ts)
        │
        ▼
Services (lib/services/*)         ← authorization, orchestration, business rules
        │
        ▼
Repositories (lib/repositories/*) ← only place that touches MongoDB
        │
        ▼
MongoDB
```

UI components and API routes must **not** import `mongodb` directly.

### Cross-cutting

- Server-side authorization on every privileged route (JWT never carries a role)
- HttpOnly `wl_session` cookie, SameSite=Lax, 14-day rolling
- Zod validation for every inbound payload
- Normalized event attribution (canonical acquisition sources)
- Daily analytics rollups with idempotent recompute + force + dry-run
- Provider abstraction for enrichment (`MetadataInferenceProvider` interface;
  current implementation: Gemini 2.5 Flash via Emergent Universal Key)

---

## 5. Roles & Authorization

```
visitor < user < channel_owner < business < moderator < admin < super_admin
```

- **JWT identity only** — the session token contains `{ userId, email }`. Role
  is **not** in the token and is never trusted from the client.
- Every privileged call resolves the current role from MongoDB via
  `resolveActor(request)`. Role downgrades take effect on the very next request.
- Channel ownership authorization is `channel.owner_id === current_user.id`.
- Privileged operations use `requireRole(actor, ROLES.MODERATOR)` etc.

### Super-admin bootstrap
1. Set `SUPER_ADMIN_EMAIL` and `BOOTSTRAP_ENABLED=true`
2. Sign up with that exact email — the account is promoted to `super_admin`
   only if no super_admin exists in the DB yet
3. Immediately set `BOOTSTRAP_ENABLED=false` and redeploy

---

## 6. Analytics Model

**Follow Click** = a raw `/go/[slug]` interaction. One row per hop.

**Unique Follow Intent** = a **privacy-conscious, deduplicated** follow intent
signal per anonymous session per channel per 24-hour window. It is *not* a
confirmed WhatsApp follower gain and is never described that way in the UI or
API responses.

### Canonical acquisition sources
```
search   homepage   trending   top   category   country
related_channel   channel_profile   direct   external   other
```

Any source string that arrives from a legacy URL, a stale link, or a mistyped
`?source=` param is normalized to one of the values above (falling back to
`other`) before an event is stored.

### Privacy thresholds
- Individual search terms are hidden from the owner dashboard until they hit
  at least **3 impressions** for that channel.

---

## 7. Smart Channel Import

```
WhatsApp URL
   │
   ▼
Normalize (canonical host + channel id)
   │
   ▼
Duplicate check  ──►  duplicate branch (skip OG + LLM, return contextual CTA)
   │  (unique)
   ▼
Public metadata fetch (OG / social tags)
   │
   ▼
WaveLead inference (Gemini 2.5 Flash: category / language / country)
   │
   ▼
User confirmation (per-field: Auto-filled / Suggested N% / Please confirm / Your edit)
   │
   ▼
Submit → pending_review
```

**Provenance vocabulary**

| Source                | Meaning                                                             |
|-----------------------|---------------------------------------------------------------------|
| `public_metadata`     | Factual input pulled directly from public Open Graph / social tags  |
| `wavelead_inference`  | Category / language / country suggestion from the LLM               |
| user override         | The submitter edited the field — badge becomes "Your edit"          |

**Firewall**

- LLM cannot assign `owner_id`, `verification_status`, `is_verified`,
  `is_official`, `wave_score`, or any moderation/trust state.
- Duplicate check always runs **before** any outbound fetch or LLM call.
- If OG fetch fails or the LLM is unavailable, enrichment gracefully degrades
  to manual entry — the submitter can always complete the form by hand.
- SSRF protection: host must be `whatsapp.com` / `www.whatsapp.com` / `wa.me`;
  private/loopback IPs and non-standard schemes are rejected before any I/O.

---

## 8. Core Routes

### Public
```
/                          Homepage (rising / top / category rails)
/search                    Search results
/trending                  Trending channels
/top                       Top channels
/category/[slug]           Category discovery
/country/[slug]            Country discovery
/channel/[slug]            Channel profile (approved only)
/channels                  All channels index
/categories                All categories index
/go/[slug]                 Follow-intent redirect to WhatsApp
/report/channel/[slug]     Report a channel
/login   /signup
/about   /pricing   /terms   /privacy
```

### Authenticated
```
/submit                             Smart Channel Import
/claim/[slug]                       Claim ownership of an existing channel
/dashboard                          Owner home
/dashboard/channels                 Owned channels list
/dashboard/channels/[id]            Manage single channel
/dashboard/channels/[id]/analytics  Owner analytics dashboard
/dashboard/channels/[id]/promote    Create a promotion (M05.1)
/dashboard/promotions               My promotions
/dashboard/promotions/[id]          Campaign detail + reporting
/dashboard/claims                   My claim requests
```

### Moderator / Admin
```
/admin                            Admin home
/admin/channels                   Channel moderation queue
/admin/channels/[id]              Single channel detail (moderator view)
/admin/claims                     Ownership-claim queue
/admin/claims/[id]                Single claim detail
/admin/channel-changes            Owner change-request queue
/admin/homepage                   Homepage slot curation
/admin/promotions                 Campaign review queue (M05.1)
/admin/promotions/[id]            Campaign detail + approve/reject
/admin/promotion-rates            CPM rate cards (M05.1)
```

### SEO
```
/robots.txt   (blocks /dashboard, /admin, /api)
```

---

## 9. Core API Areas

All routes are served by `app/api/[[...path]]/route.ts` and prefixed with `/api`.

| Area                    | Notes                                                              |
|-------------------------|--------------------------------------------------------------------|
| **Auth**                | signup / login / logout / me — rate-limited, HttpOnly session      |
| **Discovery**           | home, rising, top, categories, countries, per-slug lookups         |
| **Channels (public)**   | list, featured, per-slug detail — approved-only                    |
| **Submission**          | `POST /submit`, `POST /submit/check`                               |
| **Smart Import**        | `POST /channels/enrich`                                            |
| **Follow Intent**       | `POST /track`, plus the `/go/[slug]` redirect page-route           |
| **Claims (owner)**      | `/claims/eligibility/:slug`, `/claims/:slug`, resubmit, cancel     |
| **Owner (self)**        | `/me/channels[/:id]`, `PATCH`, `/change-request`, `/me/claims`     |
| **Owner Analytics**     | `/owner/channels/:id/analytics/{overview,timeseries,sources,...}`  |
| **Promotions (owner)**  | `/owner/promotions[/:id[/submit|pause|resume|cancel|report]]`     |
| **Moderation**          | `/admin/channels[/:id[/approve|reject]]`, homepage slot CRUD       |
| **Claim Moderation**    | `/admin/claims[/:id[/approve|reject|request-info]]`                |
| **Change Moderation**   | `/admin/channel-changes[/:id[/approve|reject]]`                    |
| **Promotion Review**    | `/admin/promotions[/:id[/approve|reject]]`, `/admin/promotion-rates` |
| **Sponsored Tracking**  | `/track/sponsored/{impression,profile-view}` (signed token only)   |
| **Admin Analytics**     | `POST /admin/analytics/rollup` (dry_run + force)                   |
| **Health**              | `GET /health` — returns commit SHA + branch + commit time          |

The exact endpoint list is intentionally not enumerated here to keep this
README stable — see `app/api/[[...path]]/route.ts` for the source of truth.

---

## 10. Environment Variables

| Variable                 | Purpose                                                        |
|--------------------------|----------------------------------------------------------------|
| `MONGO_URL`              | MongoDB connection string                                      |
| `DB_NAME`                | Database name (defaults to `wavelead`)                         |
| `JWT_SECRET`             | Session token signing key — must be strong in production       |
| `NEXT_PUBLIC_BASE_URL`   | Public origin for canonical URLs, OG, sitemap, and CORS        |
| `CORS_ORIGINS`           | Comma-separated additional allowed origins                     |
| `NODE_ENV`               | Standard Next.js environment marker                            |
| `SUPER_ADMIN_EMAIL`      | Bootstrap-only super_admin email (see §5)                      |
| `BOOTSTRAP_ENABLED`      | `true` only during the bootstrap window                        |
| `EMERGENT_LLM_KEY`       | Universal Emergent key used by Smart Import's LLM provider     |
| `EMERGENT_LLM_BASE_URL`  | Emergent LLM base URL (chat completions endpoint)              |
| `GIT_COMMIT` / `GIT_BRANCH` / `GIT_COMMIT_TIME` | Optional overrides surfaced by `/api/health`     |

Never commit real keys. Rotate `JWT_SECRET` and `EMERGENT_LLM_KEY` if leaked.

---

## 11. Development

```bash
yarn typecheck      # strict TypeScript compile
yarn test           # vitest suite (requires dev server up on :3000)
yarn dev            # start Next.js dev server (supervisor already runs this)
yarn build          # production build
yarn start          # start Next.js production server
```

Supervisor keeps `next dev` running on port 3000 inside the container. The dev
script also wipes a stale production `.next` build before starting to avoid
CSS/JS asset mismatch.

Hit `GET /api/health` to confirm which commit is actually running:
```
{ "status":"ok", "service":"wavelead",
  "version":"<short SHA>", "commit":"<full SHA>",
  "branch":"main", "commitTime":"..." }
```

---

## 12. Security & Privacy

- No private WhatsApp scraping. WaveLead only reads publicly available Open
  Graph / social metadata that any browser could see.
- No WhatsApp account identity is collected from visitors.
- No confirmed follower identity is stored or displayed.
- Server-side RBAC on every privileged endpoint; JWT never carries a role.
- Owner isolation: analytics endpoints reject any request whose actor does not
  own the target channel.
- Smart Import outbound fetches are SSRF-protected (allowlisted hosts,
  no private-range IPs, no non-HTTPS-canonical redirects).
- Rate limiting on auth endpoints and on `/api/channels/enrich`.
- Private claim evidence is excluded from public APIs.
- Analytics endpoints expose aggregate data only and enforce the search-term
  privacy threshold (≥ 3 impressions).
- LLM output cannot assign ownership, verification, official state, featured
  status, or the WaveScore ranking value.

---

## 13. Product Status

| Milestone | Scope                                          | Status   |
|-----------|------------------------------------------------|----------|
| M00       | Foundation                                     | Complete |
| M01       | Public Discovery                               | Complete |
| M02       | Supply, Quality & Follow Intent                | Complete |
| M03       | Ownership & Trust                              | Complete |
| M04       | Owner Analytics & Growth Intelligence          | Complete |
| M05.0     | Smart Channel Import                           | Complete |
| M05.1     | Promote Channel / Sponsored Discovery          | Complete |
| M06.0     | Payments, Campaign Funding & Ledger            | Complete |
| M06.1     | Indonesia Currency & Local Payment Readiness   | Complete |

---

## 14. Current Limitations

- **PayPal Sandbox only.** Real production-live payment merchant readiness is not
  claimed; PayPal integration ships against the Sandbox environment. Live
  card/wallet checkout at scale requires separate go-live steps not in scope.
- **No local IDR checkout yet.** Owner UI displays the IDR equivalent of the
  campaign budget and shows a "Local Payment — Coming Soon" panel, but no
  local payment provider (Xendit/Midtrans/QRIS/VA/e-wallet) is integrated.
  PayPal USD remains the only actionable funding option.
- **No subscriptions / Pro plans.** Per-campaign funding is live; recurring
  subscription billing is a future milestone.
- **No confirmed WhatsApp follower attribution** — WaveLead measures follow
  **intent**, not confirmed follows on WhatsApp
- **No private WhatsApp analytics** (WaveLead does not have access to any
  private WhatsApp data)
- No ownership transfer or dispute-center workflow
- No team or agency accounts (single-owner model)
- No channel-owner marketplace / sponsorship rate cards / brand-to-channel
  booking (deferred to the Sponsorship Marketplace milestone)
- No custom ad creatives — sponsored cards reuse the channel's approved
  public profile
- No native mobile app
- In-memory rate limiter and enrichment cache — swap for Redis for
  multi-instance production
- No live FX API — USD/IDR conversion rate is admin-managed

---

## 15. Roadmap

**Next:** M07 — Brand / Sponsorship Marketplace Foundation

**Future:**
- Live local IDR payment provider integration (Xendit / Midtrans / hosted
  checkout with QRIS, VA, e-wallets)
- Automated FX rate provider (upstream market-rate feed)
- Subscriptions / Pro plans (monthly billing)
- Multi-currency global FX (SGD / MYR / THB / PHP / EUR / JPY)
- Channel-owner marketplace / brand-to-channel bookings, payouts,
  settlement, tax invoicing
- Campaign auction / bidding models
- Native mobile app
