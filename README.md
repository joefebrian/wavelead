# WaveLead — Milestone 00.1

**WaveLead** is the growth infrastructure for **WhatsApp Channels**. Independent
platform for discovery, growth, measurement and (later) monetization. Not
affiliated with WhatsApp or Meta.

Milestone 00 shipped the layered foundation. Milestone 00.1 hardens it:

- Global rename `WaveHub` → `WaveLead` (WaveScore ranking name retained)
- Strict TypeScript across the foundation
- Removed first-user super_admin promotion — secure `SUPER_ADMIN_EMAIL` bootstrap
- Privileged authorization always resolves the CURRENT role from MongoDB (never trusts JWT role)
- Explicit CORS allowlist (never `*` with credentials)
- Rate limiting on `/api/auth/login` and `/api/auth/signup`
- Broken public navigation replaced with polished placeholder pages
- Automated vitest suite (`yarn test`)

---

## Architecture

```
app/                ← Next.js App Router (UI + API entrypoint)
  api/[[...path]]   ← thin HTTP dispatcher; delegates to services
  page.tsx          ← public homepage (server rendered)
  login/, signup/, dashboard/, admin/, submit/, channels/
  trending/, top/, pricing/, about/, terms/, privacy/     ← placeholders (200 OK)

components/
  layout/           ← Header, Footer (WaveLead brand)
  ui/               ← shadcn primitives (still .jsx + .d.ts shims)

lib/
  types.ts          ← Shared domain types (User, Channel, Category, …)
  db/               ← Mongo connection singleton + index registration
  auth/             ← bcrypt, JWT session, RBAC guards, rate limiter
  validation/       ← zod schemas for inbound payloads
  repositories/     ← DATA-ACCESS LAYER (only place doing Mongo queries)
  services/         ← BUSINESS LOGIC (authorization, orchestration)
  seed/             ← deterministic demo seed data
  utils/            ← slug, response, cors helpers
```

Rule of thumb: UI components and API routes MUST NOT import `mongodb` directly.
Data access lives in `lib/repositories/*`; business rules live in `lib/services/*`.

---

## Roles & authorization

`visitor < user < channel_owner < business < moderator < admin < super_admin`

- **JWT identity ONLY** — the session token contains `{ userId, email }`. No role.
- Every privileged check calls `resolveActor(request)` which re-reads the user
  (and their current role) from MongoDB. A role downgrade takes effect on the
  very next request.
- Guards: `requireAuth(actor)`, `requireRole(actor, ROLES.MODERATOR)`.

### Super-admin bootstrap (secure)

There is **no** first-user promotion. To create the first super-admin:

1. Set env vars:
   ```
   SUPER_ADMIN_EMAIL=you@yourdomain.com
   BOOTSTRAP_ENABLED=true
   ```
2. Sign up with that exact email.
3. **Immediately** set `BOOTSTRAP_ENABLED=false` and redeploy. From that point
   forward, the bootstrap slot is closed even if the users collection is wiped.

Additionally, the bootstrap promotion only fires when no super_admin exists yet
— so a leaked config alone is not enough to escalate.

---

## Environment variables

| Var | Purpose |
|---|---|
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name (default `wavelead`) |
| `JWT_SECRET` | Session token signing key — **replace in production** |
| `NEXT_PUBLIC_BASE_URL` | Public origin for OG/canonical/sitemap and CORS |
| `CORS_ORIGINS` | Comma-separated additional allowed origins |
| `NODE_ENV` | `development` allows the seed endpoint without auth |
| `SUPER_ADMIN_EMAIL` | Bootstrap email (see above) |
| `BOOTSTRAP_ENABLED` | Set to `true` only during bootstrap window |

---

## Routes

**Public**: `/`, `/channels`, `/submit`, `/login`, `/signup`, `/trending`, `/top`, `/pricing`, `/about`, `/terms`, `/privacy`
**Protected**: `/dashboard` (any user), `/admin` (moderator+)
**Architected placeholders (built later)**: `/category/[slug]`, `/country/[slug]`, `/channel/[slug]`, `/go/[slug]`, `/claim/[slug]`
**SEO**: `/robots.txt` (blocks `/dashboard`, `/admin`, `/api`)

## API endpoints (Milestone 00.1)

| Method | Route | Auth |
|---|---|---|
| GET | `/api/health` | public |
| POST | `/api/auth/signup` | public, rate-limited 5/min/IP |
| POST | `/api/auth/login` | public, rate-limited 8/min/IP |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | public (null if anon) |
| GET | `/api/categories` | public |
| GET | `/api/channels` | public |
| GET | `/api/channels/featured` | public |
| GET | `/api/channels/:slug` | public |
| GET | `/api/stats` | public |
| GET | `/api/admin/ping` | moderator+ (live DB role check) |
| POST | `/api/admin/seed` | admin (prod) / open (dev) |

---

## Development

```bash
yarn typecheck      # strict TypeScript compile
yarn test           # vitest foundation suite (requires dev server up on :3000)
yarn dev            # start Next.js dev server (supervisor already runs this)
yarn build          # production build
```

## Known limitations (Milestone 00.1)

- Discovery UI, search, category/country pages, channel profile → Milestone 01
- Channel submission form + claim workflow → Milestone 02
- Follow-click tracking + `/go/[slug]` → Milestone 03
- Owner analytics dashboards → Milestone 04
- Promotion & billing → Milestone 05+
- Google OAuth (foundation already supports `auth_providers[]`)
- Image uploads deferred (URL fields only)
- Sitemap.xml route not yet generated (robots.txt already references it)
- In-memory rate limiter — replace with Redis for multi-instance production

## Supabase-spec adaptations

| Spec | Milestone 00.1 implementation |
|---|---|
| Supabase Postgres | MongoDB + UUID refs + repository pattern |
| Supabase Auth | Custom email/password + JWT cookie (provider-agnostic) |
| Row Level Security | Server-side `requireRole` / service-layer authorization + live DB role resolution |
| Supabase Storage | Deferred (URL fields on channel documents) |
