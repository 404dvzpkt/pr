# Database, schema and demo data

SkyWorld Stall uses a single SQLite database shared by the store, owner, admin and operator systems.

---

## 1. Location and connection

Default database: `data/skyworld.db`.

Override it with `DB_PATH` in `.env`:

```env
DB_PATH=data/skyworld.db
UPLOADS_DIR=data/uploads
```

The database layer (`server/db.js`) uses Node's built-in `node:sqlite` (`DatabaseSync`) and applies:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

WAL creates `skyworld.db-wal` and `skyworld.db-shm` beside the database. Keep them together when copying a live database manually, or stop the server before a file copy.

SQLite fits a single-server market installation. It is not designed for multiple application servers writing to one file over a network share.

---

## 2. Schema creation and migrations

The schema is defined in `server/schema.sql` and applied with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` every time the server starts. A new installation needs no separate migration command.

For this build:

- `settings.schema_version` is `2` (version 2 added the default payment page URLs).
- There is no migration framework and no versioned migration folder.
- The startup migration for version 2 fills blank GCash/Maya/bank URLs with the official defaults. Existing custom URLs are preserved.
- To make other changes to an existing production schema, write an explicit migration (SQL or a small Node script) and apply it before deploying the new code. Do not rely on editing a `CREATE TABLE IF NOT EXISTS` statement to alter an existing table; SQLite will leave the existing table unchanged.
- For development/demo use, `npm run seed:reset` recreates all data rows. It does **not** alter the table structure.

---

## 3. Tables

| Table | Purpose | Key relationships |
| --- | --- | --- |
| `settings` | Platform settings (site name, support email, fees, payment links, logo URL, moderation words, maintenance, provider-independent flags) | Key/value |
| `stalls` | Exactly 10 predefined stalls; occupancy, operating status, images, lease fields, commission override | — |
| `users` | Admin, operator and owner accounts; hashed password; one owner per stall | `stall_id` → `stalls.id`, unique |
| `sessions` | Hashed session tokens, CSRF token, expiry, IP, user agent | `user_id` → `users.id` |
| `rate_limits` | Persistent login/registration/recovery rate limiter counters | — |
| `signup_codes` | Pending two-step registrations: hashed token, hashed password, hashed six-digit code, expiry, attempts, resends, delivery status | `stall_id` → `stalls.id` (owner registrations) |
| `password_resets` | Hashed one-time reset codes with expiry, attempts and delivery status | `user_id` → `users.id` |
| `delivery_outbox` | Development-only record of preview codes when no provider is configured; never read in production | — |
| `products` | Catalogue items with cent prices, discount, stock, colors, sizes, images, archive flag | `stall_id` → `stalls.id` |
| `vouchers` | Demo/live vouchers with percent or fixed value, usage limits | — |
| `orders` | Guest orders, cent totals, status, payment method/status, idempotency, SMS result, sample flag | `stall_id` → `stalls.id` |
| `order_items` | Immutable order line snapshots (name, variant, unit price, image) | `order_id` → `orders.id`, `product_id` → `products.id` |
| `reviews` | Customer reviews with server-side moderation status and optional owner reply | `product_id`, `stall_id`, `order_id` |
| `notifications` | In-app notifications for staff/owners | `user_id` → `users.id` |
| `activity_logs` | Audit trail with actor, action, entity, details, IP and sample flag | `actor_id` → `users.id` (nullable) |
| `tickets` | Maintenance/support tickets with priority, status and assignment | `stall_id`, `assigned_to`, `created_by` |
| `visits` | Monthly stall visits and follow-up state | `stall_id`, `operator_id` |
| `suppliers` | Owner supplier records, archive flag | `stall_id` → `stalls.id` |
| `feedback` | Public feedback submissions with moderation status | — |

### Important constraints

- `users.email` is `COLLATE NOCASE UNIQUE`.
- `users.phone` is `UNIQUE` after normalization.
- `users.stall_id` is `UNIQUE`, and a partial unique index `ux_owner_stall` protects owner assignments.
- `users` has a table check: owners must have a stall; non-owners must not.
- Stalls have enumerated `occupancy` and `operating_status` values, and `commission_pct` is limited to 0–30 when present.
- Products cannot have negative stock or price; discounts are 0–90%.
- Orders use enumerated status and payment status values.
- Reviews are limited to ratings 1–5 and one review per order/product.
- Foreign keys are enabled; most child records reference their parent.

Money is always integer cents (`price_cents`, `total_cents`, `platform_fee_cents`, etc.). Reports convert to decimal only for display/CSV.

Timestamps are stored as UTC ISO strings. Report ranges and "today" calculations use `TIMEZONE_OFFSET_MINUTES` (default 480 = UTC+8, F. Calderon St. Baguio City, Benguet). Changing the offset changes report boundaries but does not rewrite stored timestamps.

---

## 4. Demo data

`server/seed.js` creates demo data when the database is empty. The current build generates:

- **10 stalls**, each with category, description, location, cover/profile images and a coherent catalogue.
- **80 sample products** across the stalls.
- **1 demo owner** at Golden Threads (stall 1); stalls 2–10 remain available.
- **1 demo admin** and **1 demo operator**.
- **575 sample orders** (240 dated 2025 and 335 dated 2026), with matching order items, statuses and reviews.
- Sample reviews, tickets, visits, suppliers, feedback and activity log entries.
- Seed randomness uses a fixed seed where possible so the demo is repeatable.

Every seeded order/review/ticket/visit/feedback/log row carries `is_sample = 1` (or the equivalent integer/text field) and is rendered with a **Sample** badge. Reports show how many sample orders are included. Sample rows are never presented as live revenue.

Sample credentials:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@skyworld.ph` | `Admin@123` |
| Operator | `operator@skyworld.ph` | `Operator@123` |
| Owner | `owner@skyworld.ph` | `Owner@123` |

These are development credentials. Change or remove them before production.

### What `npm run seed:reset` does

- Deletes and recreates rows in: sessions, password resets, rate limits, notifications, activity logs, reviews, order items, orders, tickets, visits, suppliers, feedback, vouchers, products, users and stalls.
- Regenerates the demo catalogue and sample records.
- Removes generated product SVG files from `public/shared/products`.
- **Preserves** platform `settings` (logo, payment links, site name, fees, prohibited words, maintenance mode) and uploaded files in `data/uploads`.
- Is destructive for accounts and orders. Do not run it on a database you care about.

If you want a completely fresh installation including default settings, stop the server, delete the database files and `data/uploads` contents, then start again. The default settings and a new seed will be created.

To skip automatic seeding on an empty database, set:

```env
SKIP_SEED=1
```

Without `SKIP_SEED=1`, an empty database is seeded on first start. On a real production launch, decide explicitly whether you want demo data.

---

## 5. Backup and restore

### Admin backup (application-level)

`Admin → Backup / Restore` downloads a versioned JSON document containing selected tables. It is not a raw SQLite file. It contains hashed passwords and customer PII, so it must be stored securely and never shared.

Restore:

- Accepts the JSON backup, up to 20 MB.
- Checks the format and version.
- Requires at least one active administrator in the backup.
- Replaces the tables inside a transaction.
- Revokes all sessions and requires a fresh sign-in.
- Requires the explicit confirmation string.

Restoring is a destructive operation. Download a current backup first and test the restore against a copy.

### Filesystem backup (recommended for production)

For a complete backup, stop writes (or stop the server) and copy:

```text
data/skyworld.db
data/skyworld.db-wal        (if present)
data/skyworld.db-shm        (if present)
data/providers.json         (if you saved SMTP/SMS credentials in the admin UI)
data/uploads/
```

`data/providers.json` contains provider secrets. Encrypt the backup and restrict access.

Then keep the copy off the application server, encrypted. Test a restore on a separate copy before relying on it.

---

## 6. Resetting and regenerating the demo

```bash
# Stop any running server first
npm run seed:reset
npm start
```

Expected output includes:

```text
10 stalls · 9 available for owner registration · stall 1 owned by the demo owner
Admin:    admin@skyworld.ph / Admin@123
Operator: operator@skyworld.ph / Operator@123
Owner:    owner@skyworld.ph / Owner@123 (Golden Threads)
```

The reset intentionally does not re-register owners for all stalls; the owner accounts are yours to create from the portal.

---

## 7. Test database

`npm test` uses a temporary database and uploads directory under `tests/.tmp` (and removes it after the run). It does not modify `data/skyworld.db`. Provider environment variables are cleared for the test so unconfigured-provider behavior is verified honestly.
