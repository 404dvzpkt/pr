# SkyWorld Stall

A single, connected market platform with four interfaces and one shared Node.js + SQLite backend:

| System | Entry point | Role portal | What it is for |
| --- | --- | --- | --- |
| Online Store | `/store/` | No staff login needed | Customers browse 10 stalls, choose variants, check out as guests, and track orders |
| Stall Owner System | `/owner/` | `/portal/owner/` | One owner's inventory, products, orders, sales, reviews, reports, suppliers, archives, stall profile and account |
| Admin System | `/admin/` | `/portal/admin/` | Platform oversight, owners and stalls, users, analytics, reports, fees, settings, archives, backup/restore, feedback, logs and security |
| Operator System | `/operator/` | `/portal/operator/` | Daily stall operations, status monitoring, issues, support tickets, leases, daily reports, monthly visits, logs and feedback |
| Shared portal | `/portal/` | Links to all three role portals | A single sign-in/register landing page that opens the correct dashboard for the account |

All four interfaces use the same database and API. An owner registration, an admin setting, an operator ticket, a store checkout and a report all read and write the same records. Nothing is duplicated between systems.

The cream-latte design from the supplied prototypes is preserved and extended to the admin and operator interfaces.

---

## 1. Requirements and quick start

- Node.js **22.5 or newer** (uses the built-in `node:sqlite` module).
- No `npm install` is needed. The project has no runtime dependencies.
- Windows, macOS or Linux.

```bash
# 1. Go to the project folder
cd skyworld

# 2. Optional but recommended: create your local environment file
cp .env.example .env

# 3. Start the shared backend and all four interfaces
npm start
```

Open **http://localhost:3000/portal/**.

The database and demo data are created automatically on the first start when the database is empty. The server prints all entry points on startup.

To use another port:

```bash
PORT=3100 APP_ORIGIN=http://localhost:3100 npm start
```

Do not change `APP_ORIGIN` away from the URL people actually use, because it participates in same-origin checks and secure-cookie decisions.

### Demo accounts (development seed only)

| Role | Email | Password | Scope |
| --- | --- | --- | --- |
| Administrator | `admin@skyworld.ph` | `Admin@123` | Whole platform |
| Operator | `operator@skyworld.ph` | `Operator@123` | Operations only |
| Stall Owner | `owner@skyworld.ph` | `Owner@123` | Golden Threads, stall 1 only |

These accounts exist because the development seed creates demo data. They are **not** a production account policy. Change or remove them before a real deployment.

### First-run demo state

- Exactly **10 predefined stalls**, each with its own category, cover image, catalogue and sample products.
- **Stall 1 (Golden Threads)** is owned by the demo owner. **Stalls 2–10 are available** for owner registration.
- No other stall owners are pre-registered. The owner accounts are meant to be registered by you from the portal.
- Sample orders, reviews, tickets, visits, feedback and activity log rows are labelled **Sample**. Sample orders include 2025 and 2026 dates.
- The demo labels are visible in the owner, admin and operator lists, and reports show the number of sample orders included.

To regenerate the demo database:

```bash
npm run seed:reset
```

This deletes all accounts, products, orders, tickets and other operational rows, then recreates the original demo state. It preserves platform settings (including your logo and payment links) and uploaded files. It is destructive for account and order data; use it only when you want a clean demonstration.

Separate schema and data notes are in [docs/DATABASE.md](docs/DATABASE.md).

---

## 2. How the systems connect

```text
Browser
  |
  |-- /store/       public storefront
  |-- /portal/       shared sign-in / registration
  |     |-- /portal/owner/       owner-only portal
  |     |-- /portal/admin/       administrator-only portal
  |     `-- /portal/operator/    operator-only portal
  |-- /owner/       owner dashboard (role: owner)
  |-- /admin/       administrator dashboard (role: admin)
  `-- /operator/    operator dashboard (role: operator)
                        |
                        v
                 same HTTP API (/api/...)
                        |
                        v
             same SQLite database (data/skyworld.db)
             same uploads folder (data/uploads/)
```

Connection details built into the app:

- The store never shows a staff sign-in button. Customers buy as guests and look up an order with the order code plus the email used at checkout.
- Every role portal accepts only its own role's login. If you sign in to the owner portal with an admin account, the app explains the mismatch and sends you to the correct dashboard without creating a second session.
- The shared portal at `/portal/` still offers the role picker; the three dedicated portals lock the role and hide the role picker.
- Each dashboard links back to its own role portal and to the storefront. The role portal footers link to the other portals so the systems are easy to move between.
- Admin and operator do not share one generic staff skin: the admin dashboard uses a slate-navy/steel-blue platform-oversight theme and navigation, while the operator dashboard uses an olive/terracotta field-operations theme and navigation. The owner dashboard keeps the warm cream-latte stall-workspace identity.
- Role authorization is enforced on the server, not only in the browser. Owners are scoped to their own `stall_id`; operators cannot read admin or owner endpoints; admins cannot impersonate an owner or read a password.
- Orders placed in the store appear in the owner's order list and the admin/operator views. Stock changes, status changes, refunds and reviews update the shared records.
- Admin changes to commission, settings, payment links and the brand logo appear across the storefront, portals and dashboards.
- Operator status changes and visits are visible to the owner and admin through the shared stall records.

API route groups:

| Prefix | Purpose |
| --- | --- |
| `/api/auth/*` | Registration, login, logout, availability, password recovery |
| `/api/account*` | Own profile and password |
| `/api/store/*` | Public catalogue, quote, checkout, order lookup, reviews, feedback |
| `/api/owner/*` | Owner-only stall, products, inventory, orders, sales, reviews, reports, suppliers, archives |
| `/api/admin/*` | Admin-only oversight, settings, fees, reports, backup, restore, logs, security |
| `/api/operator/*` | Operator-only stalls, statuses, tickets, visits, leases, reports, logs, feedback |
| `/api/uploads` | Validated image upload endpoint |
| `/api/brand/logo` | Current brand logo, with a fallback to the bundled default |
| `/api/meta` | Public storefront metadata, including payment links and provider availability |

---

## 3. Accounts and registration

### Stall owners

1. Open `/portal/owner/` (or choose **Stall Owner** on `/portal/`).
2. Choose **Create account**.
3. Pick one of the available stalls. Occupied stalls are shown but cannot be selected.
4. Enter name, email, mobile number and a password.
5. Choose whether the six-digit code goes to **email** or **SMS**.
6. Confirm the stall and the account details.
7. Enter the six-digit verification code. The account and stall link are created only after the code is verified, then the portal signs you in.

Rules enforced by the database and the API:

- A stall can have at most one owner. The database has a unique owner-to-stall constraint, and the API checks occupancy inside a transaction.
- A second attempt to claim the same stall returns a conflict, even if two people register at the same time.
- Occupancy persists across refresh, logout and restart.
- Only stalls marked **available** can be claimed.
- Owners can edit their own stall profile, lease terms and commission within the allowed range.

### Administrators and operators

- Register from `/portal/admin/` or `/portal/operator/`, or choose the role on the shared portal.
- **There is no staff invitation code.** The field and the invitation concept were removed.
- Registration is two steps: submit the details, then enter a six-digit code sent to the chosen email address or mobile number. The account is not created until the code is verified.
- Codes expire after 10 minutes, allow six attempts and up to three resends (30-second cooldown). The pending registration token and code are stored only as hashes.
- Registration and code sending are rate-limited per IP and per contact, duplicate email and phone numbers are rejected by unique constraints, and the password policy is enforced on the server.
- When no email/SMS provider is configured in development, the code is shown on the verification screen and recorded in the delivery outbox so you can finish testing. Production never exposes codes and refuses to register until a provider is configured.

**Important:** open staff self-registration means anyone who can reach a staff portal can create an administrator or operator account. The original specification asked for staff registration without invitation codes; this is that behavior. For a real deployment, restrict access to `/portal/admin/` and `/portal/operator/` (VPN, trusted network, reverse-proxy access rule) or extend the code with an approval step. See [docs/SECURITY.md](docs/SECURITY.md).

### Password policy

- 8–20 characters.
- Letters, numbers and symbols only.
- At least three of these four groups: lowercase letters, uppercase letters, numbers, symbols.
- The registration and reset forms show each requirement in red or green and label the result Weak or Strong.
- Invalid passwords are rejected by the server even if the browser check is bypassed.

---

## 4. Replace the logo with your own

The logo is managed from the Admin System; no file editing is required.

1. Sign in at **`/portal/admin/`** (demo: `admin@skyworld.ph` / `Admin@123`).
2. Open **System Settings**.
3. In **Storefront identity**, find **Brand logo**.
4. Click **Upload logo** and choose your file.
   - PNG, JPEG or WebP.
   - Maximum **5 MB**.
   - A square image works best (recommended 512 × 512 or larger).
   - SVG uploads are intentionally not accepted, because SVG can contain active content. Export your logo as a PNG if it is currently an SVG.
5. The preview updates after the upload. The logo is not live until you click **Save platform settings**.
6. To go back to the bundled SkyWorld logo, click **Use default**, then **Save platform settings**.

Where it appears after saving:

- Storefront header and footer.
- Shared portal and all three dedicated role portals.
- Sidebar brand in the owner, admin and operator dashboards.
- Browser favicon.

The file is validated by its magic bytes on the server, stored in `data/uploads/` with a random name, and served through `/api/brand/logo`. Only the stored URL is recorded in settings. Uploading a new logo does not expose your local file path.

If you prefer to edit files directly, replace `public/shared/logo.svg` for the default logo. The admin upload route is the safer and supported way because it survives future updates and keeps the original default available through **Use default**.

---

## 5. Payment methods that open the real payment page

The store supports **Cash on Delivery**, **GCash**, **Maya** and **Bank Transfer**. Payment is link-out only: SkyWorld does not collect or store card details.

The three online methods already point at the official provider pages out of the box, so the links work without any setup:

- GCash → `https://www.gcash.com/`
- Maya → `https://www.maya.ph/`
- Bank Transfer → `https://www.bdo.com.ph/`

Replace them with your own merchant page, payment link or hosted checkout as an administrator:

1. Sign in at `/portal/admin/`.
2. Open **System Settings**.
3. Find **Payment page links**.
4. Paste the official HTTPS page for each method:
   - **GCash payment page URL** — a GCash payment link, merchant page or your GCash dashboard URL.
   - **Maya payment page URL** — the official Maya checkout or merchant page.
   - **Bank transfer payment page URL** — your bank's transfer page or a hosted payment page.
5. Click **Save platform settings**.

Only `https://` links are accepted. Credentials inside a URL are rejected. Leave a field blank if a method is not available; the checkout then shows an honest "not configured" note instead of a dead link.

What the customer sees:

- At checkout, selecting GCash, Maya or Bank Transfer shows a notice and an **Open … payment page** link when that method has a configured URL.
- After the order is placed, the confirmation repeats the link with the order code as the reference.
- If no URL is configured, the customer is told that the stall will send payment instructions; the app never pretends a payment page exists.
- The order records the chosen payment method, but **payment status is not changed automatically** by opening an external page. The stall/admin confirms payment in the normal order workflow.

There is no card form and no payment-provider secret in the frontend. If you later want automatic payment confirmation, integrate the provider's server-side webhook; that is outside the current scope.

---

## 6. Verification and recovery codes by email or SMS

Both **registration verification** and **password recovery** use a real six-digit code delivered through a configured provider. The server has working SMTP and SMS adapters, hashed one-time codes, expiry, attempt limits, resend cooldowns and session revocation after a successful reset.

### Configure delivery in the admin dashboard (recommended)

1. Sign in at `/portal/admin/`.
2. Open **System Settings**.
3. Find **Delivery providers**.
4. For email, fill in the SMTP host, port, encryption, username, password and From address, then click **Save email provider**.
5. For SMS, choose **Semaphore**, **Twilio** or **Webhook**, fill in that provider's fields, then click **Save SMS provider**.
6. Click **Send test email** and/or **Send test SMS**. Test messages go only to the signed-in administrator's own registered email/phone.
7. Register a new account or use **Forgot password** to complete one real end-to-end test.

Provider credentials saved from the dashboard are written to `data/providers.json` with restricted file permissions and are never sent back to the browser. The page only shows masked values and Configured/Not configured status. Changes apply immediately; no restart is needed. Use the **Clear** action on a provider to remove the saved override and fall back to environment variables.

### Configure through environment variables instead

You can also provide credentials in `.env` (or the host's secret manager):

```env
# Email via SMTP (Gmail needs an App Password, never the normal password)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-address@gmail.com
SMTP_PASS=your-16-character-app-password
SMTP_FROM=your-address@gmail.com
SMTP_FROM_NAME=SkyWorld Stall

# SMS via Semaphore (Philippines), Twilio or a webhook
SMS_PROVIDER=semaphore
SEMAPHORE_API_KEY=your-key
SEMAPHORE_SENDER_NAME=SkyWorld
```

A saved dashboard configuration overrides the matching environment values. Set `PROVIDERS_FILE` if the provider file should live somewhere other than `data/providers.json`. Restart the server after changing `.env`.

### Development fallback vs production

- **Development/test without a provider:** the verification screen shows the six-digit code and labels it as a development preview. The code is also recorded in the admin **delivery outbox** (and the `delivery_outbox` table) so it can be retrieved after a page reload. Nothing claims an email or SMS was sent.
- **Production without a provider:** no code is exposed and registration/recovery returns an honest delivery-unavailable error. Configure a provider before opening the portals.
- **With a provider:** codes are sent through the configured channel. The plain code is never stored; only a hash is stored in the database.

Full setup, provider options, limits and troubleshooting: [docs/PROVIDERS.md](docs/PROVIDERS.md).

If only email is configured, email delivery works and SMS delivery is honestly reported as unavailable; the reverse is also true.

---

## 7. Lease and commission editing

Stall owners can edit their own lease and commission from **Stall Profile** in the owner dashboard:

- Monthly rent (decimal amount, stored as integer cents).
- Lease start and end dates.
- Floor area in square metres.
- Lease note.
- Commission percentage (0–30%).

Saving shows a confirmation dialog. End-before-start dates and out-of-range commission are rejected by the server. Saving real terms clears the **Sample lease** label. Every change is recorded in activity logs. Operators and admins can see the updated figures but owners cannot change staff-only operating statuses.

---

## 8. Reports, money and sample data

- Money is stored and calculated in **integer cents**; decimal prices such as ₱149.50 are exact.
- Reports support daily, weekly, monthly, annual and custom ranges.
- Range boundaries use the configured timezone (`F. Calderon St. Baguio City, Benguet`, UTC+8), not the server's local timezone.
- Report preview is generated first. The CSV download is generated from the **same frozen preview** and uses the same records and totals, with a short-lived server-side preview token.
- Gross sales, refunds, discounts, platform fees and net sales are reported separately.
- Only defined order statuses count as sales: **delivered** orders count as completed sales; cancelled and refunded orders are handled according to their status and stock restoration. Pending and confirmed orders are not counted as completed revenue.
- Seeded 2025 and 2026 transactions are marked **Sample** in lists, CSV rows and totals. The sample count is shown next to live totals so demo data is never presented as real revenue.
- CSV exports are available to admin, owner and operator according to their role scope.

---

## 9. Testing and verification

Run the repeatable integration suite:

```bash
npm test
```

The suite starts its own seeded server on a free port with a temporary database and uploads directory, clears all provider environment variables, and removes its temporary files at the end. It does **not** touch `data/skyworld.db`.

Result at the time of this build:

```text
93 checks passed.
```

The checks cover:

- Storefront HTML, 10 stalls, provider flags, payment link defaults, brand logo route, and no staff sign-in button.
- Dedicated owner/admin/operator portals, locked roles, no invitation-code field, shared portal still available.
- Two-step registration start → code → verify for all three roles, wrong-code rejection, login blocked before verification, SMS channel selection, resend cooldown, duplicate email, weak password, and single-claim owner stalls.
- Admin settings, HTTPS-only payment links, unsafe logo URL rejection, logo upload/serve/reset, provider save/clear/masking, provider test failure, recovery unavailable without a provider, development fallback, and no code leak in production configuration.
- Owner lease/commission editing, persistence, sample-label clearing, validation, role isolation.
- Every operator endpoint returning 200 for an operator; operator denied admin and owner data.
- Guest checkout with GCash, integer-cent totals, honest "no SMS" response, order lookup success and wrong-email rejection.
- Annual report preview, CSV equality with the preview totals and order count, reusable preview token within its TTL.

Browser checks performed during development:

- Dedicated role portals render signed-out and signed-in states, with one show/hide eye icon per password field.
- Admin and operator registration forms do not contain a staff invitation code and include the email/SMS channel choice.
- Admin registration submitted a real form, received the development code, verified it, and landed on the admin dashboard with the admin role theme; operator and owner logins landed on their own dashboards with their own themes.
- Owner Stall Profile loads editable lease fields and a successful save shows the confirmation dialog and success message; the change was reverted after testing.
- Admin System Settings shows the Delivery providers panel with save/test controls, the logo upload control, and pre-filled GCash/Maya/bank URLs.
- Store checkout shows working GCash, Maya and bank payment links (`target="_blank"`) for the official default pages; the storefront has no sign-in button.
- Storefront HTML and dashboards load without console errors after the asset version bump.

**Delivery adapters were exercised against local test sinks:** a local SMTP server accepted a registration message with the correct From/To/subject and a decodable body containing the code, and a local SMS webhook received the POST with the bearer token, recipient and message body. **Not tested end-to-end:** real external mailbox or carrier delivery (Gmail/Semaphore/Twilio), which requires your credentials. Configure a provider in Admin → System Settings → Delivery providers and use the built-in delivery test before relying on codes in production. See [docs/PROVIDERS.md](docs/PROVIDERS.md).

Detailed fixed/added/tested lists and the remaining setup checklist are in [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md).

---

## 10. Security summary

The server enforces the security model; the browser is not trusted.

- Server-side sessions with an httpOnly, SameSite=Lax cookie; only a hash of the session token is stored.
- Per-session CSRF token required on unsafe requests, plus same-origin checks.
- scrypt password hashing with per-password salts; passwords are never returned by an API.
- Unique database constraints for email, phone and owner-to-stall assignment.
- Role checks and per-stall scoping on every owner/operator/admin endpoint.
- Admins cannot impersonate owners or retrieve owner passwords.
- Rate limiting for login, registration, availability checks, recovery and reset attempts.
- Generic password-recovery responses; one-time hashed codes; expiry and attempt limits; all sessions revoked after reset.
- Uploads validated by magic bytes and size, stored with random names outside the public source tree, and served with `nosniff`.
- Strict Content-Security-Policy, frame denial, referrer policy, permissions policy and HSTS in production.
- Server-side validation for prices, stock, statuses, dates, payment URLs, review content and archive actions.
- SQLite transactions for multi-row operations such as checkout, stock changes, ownership claims and restore.
- Activity logs for sign-in, account changes, moderation, settings, provider tests, backups and restores.
- Backup/restore restricted to administrators. Backups are versioned JSON documents; restore validates the format and table shape, requires an active administrator in the backup, replaces data in a transaction and revokes all sessions.
- Provider credentials live only in environment variables. `.env.example` contains placeholders, never real secrets.

Full details, production checklist and limitations: [docs/SECURITY.md](docs/SECURITY.md).

---

## 11. Project layout

```text
skyworld/
  server/               shared backend
    index.js            HTTP server, static hosting, routing
    config.js           environment configuration
    db.js               SQLite connection, settings, transactions, logs
    schema.sql          schema and constraints (auto-applied)
    seed.js             demo data and reset
    auth.js             sessions and cookies
    security.js         hashing, validation, rate limits
    mailer.js           SMTP adapter
    sms.js              Semaphore / Twilio / webhook adapters
    reports.js          report ranges and calculations
    reportTokens.js     frozen report previews
    api/                auth, store, owner, admin, operator routes
  public/
    store/              Online Store
    owner/              Stall Owner dashboard
    admin/              Admin dashboard
    operator/           Operator dashboard
    portal/             shared portal + dedicated role portals
    shared/             design system, icons, API client, charts
  data/                 SQLite database and uploads (runtime)
  tests/api.test.js     integration suite
  docs/                 provider, security, database and release notes
```

No build step, bundler or framework is used. Public files are served directly by the Node server.

---

## 12. Package contents and running the delivered ZIPs

The delivered ZIPs are:

- `Online_Store.zip`
- `Stall_Owner_System.zip`
- `Admin_System.zip`
- `Operator_System.zip`
- `SkyWorld_Shared_Backend.zip`

Each ZIP contains the **complete runnable project**, including the shared backend and all four interfaces, so no ZIP is missing its backend and the systems stay connected. The role-specific ZIP includes a `START_HERE.md` that points at that role's portal and dashboard; the code itself is the same shared installation. Do not run two unzipped copies against the same database file at the same time.

Every ZIP needs Node.js 22.5+ and the same start command:

```bash
npm start
```

The shared backend ZIP is the reference copy for deployment, schema, tests and documentation.

---

## 13. Remaining setup checklist

These are the things that require your own accounts or decisions and cannot be done in code alone:

1. Copy `.env.example` to `.env`; set `APP_ORIGIN`, `PORT` and a persistent `RESET_PEPPER`.
2. Configure SMTP and/or SMS with your own provider credentials and run the admin delivery tests.
3. Sign in as admin and upload your logo, then save.
4. Add your GCash/Maya/bank payment page URLs, then save and test the checkout link.
5. Register the stall owners you want; demo owner and demo staff accounts are for development only.
6. Change or remove the demo admin/operator accounts and passwords before production.
7. Restrict access to staff portals (HTTPS plus VPN, allowlist or approval workflow) if self-registration should not be public.
8. Set up backups: use the admin backup download plus your own filesystem/database backups; test a restore on a copy first.
9. Serve over HTTPS in production. Set `NODE_ENV=production` and keep `APP_ORIGIN` on the HTTPS URL so cookies are Secure.
10. Review the known limitations in [docs/SECURITY.md](docs/SECURITY.md) and [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md).

---

## 14. Known limitations

- **Open staff registration:** there is no invitation code or approval queue for admin/operator registration. This follows the requirement but must be restricted at the network/proxy layer for production.
- **Payment is link-out only:** no card processing, no automatic payment confirmation and no payout dashboard. The configured URL must be supplied by you.
- **Real external message delivery is untested here:** SMTP/SMS adapters are implemented and gated by configuration, but no provider credentials were available in this environment.
- **No email/phone verification at registration:** the verification code flow is the password-recovery code flow. Accounts are created immediately, as required by the store/owner registration workflow.
- **Demo seed is development data:** sample records are clearly labelled, but they are not a substitute for your real launch data. Reset removes all registrations and changes.
- **Single-process SQLite:** this fits a small market installation. For multi-server or high-volume deployment, move to a client/server database and a shared session store.

Last updated: 2026-10-21.
