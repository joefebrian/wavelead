# WaveHub — Milestone 00

**WaveHub** is the growth infrastructure for **WhatsApp Channels**. Independent
platform for discovery, growth, measurement and (later) monetization. Not
affiliated with WhatsApp or Meta.

Milestone 00 ships the production-grade **foundation only**:

- Layered architecture (UI → Services → Repositories → MongoDB)
- MongoDB schema, indexes and validation
- Working email + password authentication with role scaffolding
- Server-side authorization guards (replaces Supabase RLS)
- Global responsive layout & WaveHub design system
- Seeded categories + 20 clearly-flagged demo channels
- Route architecture placeholders for later milestones

---

## Architecture

```
app/               ← Next.js App Router (UI + API entrypoint)
  api/[[...path]]  ← thin HTTP dispatcher; delegates to services
  page.js          ← public homepage (server rendered)
  login/, signup/, dashboard/, admin/, submit/, channels/

components/
  layout/          ← Header, Footer
  ui/              ← shadcn primitives

lib/
  db/              ← Mongo connection singleton + index registration
  auth/            ← bcrypt password hashing, JWT session, RBAC guards
  validation/      ← zod schemas for inbound payloads
  repositories/    ← DATA-ACCESS LAYER (only place doing Mongo queries)
  services/        ← BUSINESS LOGIC (authorization, orchestration)
  seed/            ← deterministic demo seed data
  utils/           ← slug + response helpers
```

**Rule of thumb:** UI components and API routes MUST NOT import `mongodb`
directly. Data access lives in `lib/repositories/*`; business rules live in
`lib/services/*`. This keeps us free to migrate to Postgres later.

---

## MongoDB collections

All documents use string **UUID** ids (never ObjectID). Indexes are created
idempotently at first DB access. Uniqueness enforced at the database layer.

| Collection | Purpose | Unique |
|---|---|---|
| `users` | account, role, profile | `email`, `id` |
| `channels` | channel directory | `slug`, `whatsapp_url`, `id` |
| `categories` | taxonomy | `slug`, `id` |
| `channel_categories` | many-to-many | `(channel_id, category_id)` |
| `channel_claims` | ownership requests | `id` |
| `events` | analytics event stream | `id` |
| `channel_daily_metrics` | rolled-up metrics | `(channel_id, date)` |
| `bookmarks` | user saves | `(user_id, channel_id)` |
| `reports` | abuse reports | `id` |
| `audit_logs` | admin action log | `id` |

Event schema is deliberately flexible (`event_type`, `metadata`) with time-based
indexes so we can shard/partition later for high-volume ingestion.

---

## Roles (server-enforced)

`visitor < user < channel_owner < business < moderator < admin < super_admin`

- The **first** account that signs up is auto-promoted to `super_admin` for
  bootstrapping. All later signups get `user`.
- Guards: `requireAuth(session)`, `requireRole(session, ROLES.MODERATOR)`.
- Frontend hiding is cosmetic only — every privileged action is re-checked
  server-side in the service layer.

## Authentication

- Email + password, **bcrypt** hashing (cost 10)
- **JWT** in an HttpOnly, SameSite=Lax cookie (`wh_session`, 14-day TTL)
- Google OAuth can be added later without changing the user model —
  `users.auth_providers[]` already exists.

---

## Routes

**Public**: `/`, `/channels`, `/submit`, `/login`, `/signup`
**Placeholders (architected, UI later)**: `/trending`, `/top`, `/pricing`,
`/category/[slug]`, `/country/[slug]`, `/channel/[slug]`, `/go/[slug]`,
`/claim/[slug]`
**Protected**: `/dashboard` (any user), `/admin` (moderator+)
**SEO**: `/robots.txt` (blocks `/dashboard`, `/admin`, `/api`)

## API endpoints (Milestone 00)

| Method | Route | Role |
|---|---|---|
| GET | `/api/health` | public |
| POST | `/api/auth/signup` | public |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | public (returns null if anon) |
| GET | `/api/categories` | public |
| GET | `/api/channels` | public (approved only) |
| GET | `/api/channels/featured` | public |
| GET | `/api/channels/:slug` | public |
| GET | `/api/stats` | public |
| POST | `/api/admin/seed` | admin (prod) / open (dev) |

---

## Environment variables

| Var | Purpose |
|---|---|
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name (default `wavehub`) |
| `JWT_SECRET` | Session token signing key — **replace in production** |
| `NEXT_PUBLIC_BASE_URL` | Public origin for OG/canonical/sitemap |
| `NODE_ENV` | `development` allows the seed endpoint without auth |

---

## Seed data

- 25 categories seeded
- 20 fictional demo WhatsApp Channels across 11 countries, all marked
  `is_demo: true` so they can be excluded from real analytics later
- Trigger manually: `POST /api/admin/seed` (auto-runs on first cold start too,
  but the endpoint is idempotent unless `{ force: true }` is passed)

## Known limitations (Milestone 00)

- Discovery UI (search, filters, category/country pages, channel profile) — Milestone 01
- Channel submission, claim & verification workflow — Milestone 02
- Follow-click tracking & `/go/[slug]` redirect — Milestone 03
- Owner analytics dashboards — Milestone 04
- Promotion & billing — Milestone 05+
- Google OAuth & magic-link auth — future adapter (model already supports it)
- Image uploads deferred (URL fields only)

## Supabase-spec adaptations

| Spec | Milestone 00 implementation |
|---|---|
| Supabase Postgres | MongoDB with UUID refs + repository pattern |
| Supabase Auth | Custom email/password + JWT cookie (provider-agnostic) |
| Row Level Security | Server-side `requireRole` / service-layer authorization |
| Supabase Storage | Deferred (URL fields on channel documents) |

Everything downstream calls services, so a future PostgreSQL migration only
touches `lib/repositories/*` + `lib/db/*`.
