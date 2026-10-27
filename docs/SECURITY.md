# Security guide

This document describes what the application enforces, what it intentionally does not do, and what you must configure for a production deployment.

The guiding rule is: **the server is the security boundary**. Hiding a button is a usability improvement, not an authorization control.

---

## 1. Authentication and sessions

- Passwords are hashed with **scrypt** and a random per-password salt. Plain passwords are never stored, returned by an API, written to logs, or included in backups as plaintext.
- Sign-in accepts an email address or a normalized Philippine mobile number.
- A session uses a random 32-byte token in the `sky_session` cookie:
  - `HttpOnly`
  - `SameSite=Lax`
  - `Secure` automatically in production or when `APP_ORIGIN` is HTTPS
  - Max-Age based on `SESSION_DAYS` (1–30 days, default 7)
- Only a SHA-256 hash of the session token is stored in the database. A database leak does not directly hand over live cookie tokens.
- Sessions are checked on every API request; expired sessions and deactivated users are rejected.
- A successful password reset deletes every session for that user.
- Logging out deletes the current session row and clears the cookie.
- The admin Security page can revoke sessions; revocation is server-side.
- A session token is not rotated on login because each login creates a new token and a new row.

### CSRF and same-origin protection

- Every unsafe API request (`POST`, `PUT`, `PATCH`, `DELETE`) must come from a trusted origin. The check accepts the request `Host` variants and `APP_ORIGIN`.
- When a session exists, unsafe requests must also send the per-session `X-CSRF-Token` header.
- The token is delivered in the `/api/auth/me` response and stored in memory by the frontend. It is not stored in localStorage.
- Cross-origin form posts, missing tokens, and stale tokens are rejected with 403.

### Rate limiting

Rate limits are stored in SQLite and keyed by IP and, for login, a hash of the identifier:

- Login failures: 6 failures in 15 minutes → 15-minute lock for that IP/identifier pair.
- Registration starts: 12 per IP per hour, then a 30-minute lock.
- Verification code sends: 5 per contact per hour; resends 20 per IP per hour; verification attempts 40 per IP per 15 minutes.
- Availability checks: 60 per IP per minute.
- Forgot password: 8 per IP per 15 minutes.
- Reset attempts: 20 per IP per hour, plus five code attempts per reset record.

`http.clientIp` trusts `X-Forwarded-For` only when `TRUST_PROXY=1`. Set that only behind a trusted reverse proxy that overwrites the header.

---

## 2. Authorization and role isolation

There are three roles: `admin`, `operator`, `owner`. The store is public and has no staff session requirement.

| Area | Server rule |
| --- | --- |
| Owner endpoints | Requires `owner`; every query is scoped to the owner's own `stall_id` |
| Admin endpoints | Requires `admin` |
| Operator endpoints | Requires `operator` |
| Staff-only stall statuses | Owners cannot set `under_maintenance` or `inactive`; operator/admin paths enforce allowed transitions |
| Admin data in owner/operator UIs | Not exposed by API, so a modified browser cannot fetch it |
| Owner password access | No endpoint returns a password or password hash; admin cannot sign in as an owner |
| Impersonation | Not implemented anywhere |
| Cross-stall product/order/supplier access | Rejected server-side by stall ownership checks |
| Customer PII | Only returned to the relevant owner, admin/operator roles, or through order lookup with the order code plus checkout email |

Owners are assigned to one stall through a unique database constraint, and an owner account must have a stall. Admin and operator accounts must not have a stall. This is enforced by a table `CHECK` constraint as well as API validation.

Changing a role to `owner` without a stall is rejected. Ownership and occupancy edits are not exposed as arbitrary admin fields; owner registration is the supported assignment path.

---

## 3. Registration and account rules

- Name, email, phone, role and password are validated server-side.
- Email is normalized and case-insensitive unique.
- Phone is normalized to `639xxxxxxxxx`; uniqueness is enforced by the database.
- Password policy: 8–20 characters, letters/numbers/symbols only, at least three of lowercase, uppercase, number, symbol. The server repeats the check even if the browser is bypassed.
- Password confirmation must match.
- Owners must select an available stall. The occupancy check and the insert happen inside a transaction; a unique index on `users.stall_id` prevents a second owner even under concurrency.
- Registration is a **two-step verification flow**. Submitting the form creates a pending `signup_codes` row, not a user. The row stores a hash of the pending token, a hash of the password and a hash of the six-digit code; it never stores the plain code.
- The code must be entered from the browser and is valid for 10 minutes, with six attempts, up to three resends (30-second cooldown) and a 30-minute pending window. Attempts, expiry and resend caps are enforced server-side.
- The user and the owner stall are created only after the code matches. Email/phone uniqueness and stall availability are checked again at verification time inside the transaction.
- Registration is open for all three roles **without an invitation code**, per the requirement. This is a deliberate product decision and a production risk. Restrict staff portals at the network layer or add an approval workflow if the installation is internet-facing.
- In development only, when no provider is configured, the code is returned to the browser and recorded in `delivery_outbox` to make the flow testable. In production this never happens; registration fails until a provider is configured.

---

## 4. Password recovery

- Codes are six digits, generated with cryptographic randomness and hashed with the user id, expiry and a server pepper.
- The plain code exists only in memory while sending and in the delivered email/SMS.
- Codes expire after 15 minutes, allow five attempts, are single-use and are invalidated when a new code is requested.
- Responses are generic whether or not the account exists; the UI does not reveal account existence.
- In production, no code is returned in JSON, logged in the browser, embedded in HTML or stored in localStorage. In development without a provider, a clearly labelled preview code is returned to make the flow testable; this fallback is disabled in production.
- If no provider is configured, production returns a clear 503 `provider_not_configured` instead of generating or exposing a code.
- Delivery status is recorded (`sent`, `not_configured`, `provider_error`, …) for audit, without storing the plain code. Development fallback codes go to `delivery_outbox`, which is never read in production.
- A successful reset invalidates all sessions for that user.
- `RESET_PEPPER` should be a long random value in production. Without it, a new pepper is generated at boot; pending codes from before a restart become invalid.

See [PROVIDERS.md](PROVIDERS.md) for provider configuration.

---

## 5. Input validation and data integrity

- JSON bodies are limited to 1 MB; backups to 20 MB; uploads to 5 MB.
- JSON must be an object, not an array or primitive.
- Money is accepted as decimal strings or integer cents and converted to integer cents with a maximum. Negative values are rejected where not meaningful.
- Quantities, stock, discounts, commission rates, ratings and status values are range-checked.
- Order statuses are restricted to `pending`, `confirmed`, `shipped`, `delivered`, `cancelled`, `refunded`; payment statuses to `unpaid`, `paid`, `refunded`.
- Checkout validates the product, stall, stock, color, size, quantity, voucher, customer details and idempotency key server-side.
- Stock is reduced inside a transaction when an order is placed, and restored once when a qualifying cancellation/refund occurs. `stock_restored` prevents double restoration.
- Starting/ending lease dates are validated; commission is limited to 0–30%.
- Review content is filtered on the server. HTML is escaped when rendered.
- SQL uses prepared statements with parameters; table names used in the backup restore are drawn from a fixed allowlist.
- Static file resolution rejects `..`, backslashes, null bytes and paths outside `public/` or `uploads/`.
- Uploaded files are validated by magic bytes (JPEG/PNG/WebP), given random names, written with mode 0600 and served with `X-Content-Type-Options: nosniff`. SVG is not accepted for uploads.

---

## 6. Browser hardening

Every response includes:

- `Content-Security-Policy` with `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`. Inline styles are allowed for the design system; there are no inline scripts.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` disabling camera, microphone, geolocation and payment
- `Strict-Transport-Security` when `NODE_ENV=production`

Static HTML is served `no-store`; other static assets use a short cache. API responses use `Cache-Control: no-store`.

All user-provided strings rendered into the DOM go through escaping helpers. The frontend never uses unsanitized HTML from an API field without escaping.

---

## 7. Provider credentials and secrets

- SMTP and SMS credentials can be saved from Admin → System Settings → Delivery providers, or supplied through environment variables (`.env` locally or the host's secret manager).
- Dashboard-saved credentials are stored in `data/providers.json` (or `PROVIDERS_FILE`) with restricted file permissions. Saved settings override the matching environment values.
- `.env.example` contains placeholders only and is safe to distribute.
- `.env`, provider files, database files, WAL files and uploaded files are excluded by `.gitignore`.
- Provider secrets are never sent to the browser. The Settings page returns only masked usernames, boolean "has secret" flags and the configured source.
- The provider test endpoint sends only to the signed-in administrator's own registered contact.
- Do not put API keys in payment URLs, custom scripts, screenshots or support messages.
- Rotate any credential that was ever shared or committed. Use the **Clear** action to remove a dashboard-saved provider.

---

## 8. Audit logging and backups

Activity logs record sign-in, logout, registration, password reset, settings changes, provider tests, owner/stall changes, product and order changes, moderation decisions, backups and restores. Logs include actor, role, action, entity, details, IP and timestamp. Sample rows are labelled.

The admin backup:

- Exports selected tables as a JSON document (`format: skyworld-backup`, versioned), not a raw SQLite file.
- Contains hashed passwords and customer PII. Treat it as sensitive; store it encrypted and restrict access.
- The restore path checks the format/version, table shapes, and requires at least one active administrator in the backup.
- Restore validates the uploaded JSON, replaces tables inside a transaction and deletes all sessions, forcing re-authentication.
- The request must include the exact confirmation string and is limited to 20 MB.

The backup is a convenience for this application, not a substitute for filesystem snapshots. For production, also copy the SQLite database and uploads folder with your normal backup tooling, and test restores on a separate copy.

---

## 9. Deployment checklist

1. Use Node.js 22.5+ and a supported OS with current security updates.
2. Put the app behind HTTPS. Set `APP_ORIGIN=https://your-domain` and `NODE_ENV=production`.
3. Set a strong, stable `RESET_PEPPER`.
4. Configure SMTP/SMS in Admin → System Settings → Delivery providers (or `.env`), then run both admin delivery tests and complete one real registration/recovery test.
5. Change or remove demo accounts and demo passwords.
6. Restrict `/portal/admin/` and `/portal/operator/` if staff self-registration should not be reachable by the public.
7. Set `TRUST_PROXY=1` only behind a proxy that overwrites `X-Forwarded-For`.
8. Persist `data/` (database, providers file and uploads) on durable storage with restricted permissions and backups.
9. Ensure `data/skyworld.db`, `data/providers.json` and `.env` are not served publicly. The server serves only `public/` and the uploads folder, not the project root.
10. Set `SKIP_SEED=1` in production if you do not want an empty database to be auto-seeded with demo accounts.
11. Monitor server logs for provider errors, API 500s and repeated 401/403/429 responses.
12. Review the open-staff-registration limitation before exposing the portals. Email/SMS verification proves control of a contact, not authorization to hold a staff role.

### Production environment example

```env
NODE_ENV=production
PORT=443
APP_ORIGIN=https://market.example.com
DB_PATH=data/skyworld.db
UPLOADS_DIR=data/uploads
RESET_PEPPER=replace-with-a-long-random-secret
SESSION_DAYS=7
SKIP_SEED=1
TRUST_PROXY=1
```

Do not run TLS termination inside this app; use a reverse proxy or managed platform and forward HTTP to the Node process.

---

## 10. Known security limitations

- **Open staff registration:** no invitation code or approval queue. Anyone who can reach the staff portals can register as admin/operator. This is a product requirement, not an oversight, but it needs network controls in production.
- **No multi-factor authentication:** not implemented.
- **No account lockout dashboard:** rate limits are automatic but there is no admin unlock UI beyond revoking sessions or waiting.
- **SQLite:** a single-process database with WAL. Not suitable for horizontally scaled multi-writer deployments.
- **CSRF token in memory:** a full page reload fetches a fresh token from `/api/auth/me`; stale tokens produce a clear refresh error rather than silently retrying.
- **Recovery rate limits are per IP:** distributed attacks from many IPs are not fully mitigated; add an upstream rate limiter/WAF for public deployments.
- **Payment is link-out only:** no card data touches this app. Do not add sensitive payment forms without a proper PCI-compliant provider integration.
- **Activity logs can contain PII:** customer names/order references may appear in details. Protect database backups accordingly, and define a retention policy.
- **No automatic malware scan for images:** only type/size/magic-byte checks. On a high-risk public deployment, scan uploads with an external service and serve them from a separate domain.
- **Email/SMS delivery not tested externally here:** the code paths are provider-gated; configure and test with your own credentials.
