# Release notes — 2026-10-22

This build extends the cream-latte SkyWorld prototypes into four connected systems with one shared backend.

---

## Added

- **Dedicated role portals**
  - `/portal/owner/` for stall owners.
  - `/portal/admin/` for administrators.
  - `/portal/operator/` for operators.
  - Each portal locks its role, hides the role picker, uses role-specific copy, and has no staff invitation-code field.
  - The shared portal at `/portal/` remains for users who want to choose a role, and links to all three dedicated portals.
  - Dashboards link back to their own role portal; portal footers cross-link the other systems.
- **Admin System** with Overview, Stall Owner Management, Stall Management, User & Role Management, Platform Analytics, Platform Reports, Commission & Fee Settings, Archives, Backup & Restore, Feedback Management, Activity Logs, Security Settings and System Settings.
- **Operator System** with Daily Operations, Stall Status Monitoring, Issue Monitoring, Support Tickets, Space/Lease Monitoring, Daily Reports, Monthly Visits, Activity Logs and Feedback Monitoring.
- **Owner stall profile editing**: lease start/end, rent, area, note and commission percentage, with validation and a confirmation dialog.
- **Admin and operator are visually distinct systems**: the admin dashboard uses a slate-navy/steel-blue platform-oversight theme and management-heavy navigation; the operator dashboard uses an olive/terracotta field-operations theme and daily-operations navigation. The owner dashboard keeps its warm cream-latte stall-workspace look. All four share one API, database and session model.
- **Two-step registration verification** for owners, admins and operators: details → email/SMS channel → six-digit code → verify. No account exists until the code is verified. Codes are hashed, expire in 10 minutes, allow six attempts and up to three resends, and owner stalls are claimed only on verification.
- **Delivery providers editable in Admin → System Settings**: SMTP and Semaphore/Twilio/webhook forms with save, test, clear, masked statuses and a development outbox. Credentials persist to `data/providers.json` (or `PROVIDERS_FILE`) and override environment values; changes apply without a restart.
- **Brand logo upload** in Admin → System Settings, with preview, save and **Use default** reset. PNG/JPEG/WebP up to 5 MB, magic-byte validation, `/api/brand/logo` serving and a bundled SVG fallback.
- **Payment page links** for GCash, Maya and bank transfer, pre-filled with the official provider pages so they work immediately and replaceable by an admin. Store checkout and order confirmation link out to the real payment page with the order code; blank methods show an honest unconfigured state.
- **Real provider adapters**
  - Custom SMTP client with STARTTLS/TLS, AUTH LOGIN/PLAIN, MIME multipart messages.
  - SMS via Semaphore (Philippines), Twilio or a custom webhook.
  - Registration verification and password-recovery codes are delivered only through a configured provider; the browser never receives a code in production.
  - Admin delivery tests send only to the signed-in administrator's own email/phone.
- **Development fallback**: without a provider, codes appear as a clearly labelled development preview and are recorded in `delivery_outbox`/the admin panel. Production exposes no codes and fails registration/recovery honestly until a provider is configured.
- **Honest provider state**: "Configured"/"Not configured" indicators with source and masked values, explicit order SMS failure states, and no simulated "sent".
- **Integration test suite** (`tests/api.test.js`) with 93 checks and an isolated temporary database/uploads/provider file.
- **Documentation**: README, provider setup, security guide, database/demo guide and these release notes.

---

## Fixed / improved

- Admin and operator registration no longer asks for a staff invitation code, and now requires a verified email or mobile number before the account exists.
- The storefront no longer shows a staff sign-in button or portal link; customers buy as guests.
- Store payment methods now link out to real GCash, Maya and bank pages by default, instead of being a display-only choice.
- Dashboard styling is no longer identical for admin and operator: each role has its own accent palette, sidebar treatment and navigation wording.
- Owner lease and commission values are editable and persist; seeded values are clearly labelled **Sample**, and saving real terms clears the label.
- Logo replacement is available through the admin UI, with an easy reset to the bundled logo.
- Dedicated role portals no longer show the wrong role's stall picker or owner-specific copy.
- Dashboard brand links now go to the correct role portal.
- Uploads can be redirected to a test directory, so the integration suite no longer writes test images into `data/uploads`.
- The brand logo endpoint no longer raises an "headers already sent" error after serving the file.
- Report CSV export uses the frozen preview snapshot, so records and totals match the preview.
- Recovery and registration are gated by real provider configuration; unconfigured installs never imply that an email or SMS was sent.
- Provider credentials can be changed from the admin UI without editing files or restarting, and secrets are never returned to the browser.
- Role isolation was rechecked: operators cannot read admin/owner data, owners cannot read admin/operator data, and admin endpoints never expose owner passwords or impersonation.

---

## Verified

### Automated

Command:

```bash
npm test
```

Result:

```text
93 checks passed.
```

The suite starts a seeded server on a free port with a temporary database, provider file and uploads directory, clears provider environment variables, and cleans up. It verifies storefront metadata and payment defaults, role portals, no invitation-code field, the two-step verification flow (wrong code, pre-verification login block, SMS channel, resend cooldown), duplicate/weak-password rejection, stall-claim uniqueness, admin settings and logo handling, HTTPS payment-link validation, provider save/clear/masking and failure states, development code fallback, owner lease editing, operator endpoint access, role isolation, guest checkout, order lookup and report/CSV parity.

### Browser checks

- Owner/admin/operator dedicated portals and dashboards load signed-out and signed-in.
- Role-specific registration forms have no invitation code and exactly one eye icon per password field.
- Admin registration with the email channel showed the development code, accepted it, created the account and opened `/admin/` with the admin role theme.
- Operator and owner logins opened their own dashboards with their own themes and navigation.
- Owner lease/commission fields are editable; saving showed the confirmation dialog, the success message, and persisted the values (the test change was reverted).
- Admin System Settings shows the Delivery providers panel (save/test controls), the logo upload control, and pre-filled GCash/Maya/bank URLs.
- Store checkout with GCash, Maya and Bank Transfer shows working `target="_blank"` links to the official provider pages.
- Storefront has no sign-in button/portal link and no console errors during navigation.

### Not verified here

- **External email/SMS delivery**: no real SMTP or carrier credentials were available. The SMTP and SMS webhook adapters were exercised against local test sinks and correctly transmitted the recipient, code and subject/body, but real mailbox/carrier delivery depends on your provider and sender reputation. Use the admin delivery tests after configuring your own credentials; do not treat codes as production-ready until one real message arrives.
- **Automatic payment confirmation**: intentionally out of scope. Payment is link-out only.
- **Load/performance testing**: not performed.

---

## Remaining setup for you

1. Create `.env` from `.env.example` and set `APP_ORIGIN`, port and a persistent `RESET_PEPPER`.
2. Add SMTP credentials and/or an SMS provider in **Admin → System Settings → Delivery providers** (or `.env`), then use **Send test email/SMS** and complete one real registration and one real password-recovery test.
3. Upload your own logo in **Admin → System Settings** and save.
4. Replace the default GCash/Maya/bank URLs with your own payment links if you have them, then test the checkout link.
5. Register the stall owners you want. The demo owner is only an example.
6. Change or remove the demo admin/operator accounts before production.
7. Restrict access to staff portals if open self-registration is not acceptable for your deployment.
8. Choose HTTPS, production mode, backups and a data-retention policy.
9. For a real launch, decide whether to keep the sample 2025/2026 data or reset to a clean database.

---

## Compatibility and data notes

- Node.js 22.5+ required.
- No npm runtime dependencies.
- Existing SQLite data from this build is compatible with this build; schema changes for future versions require an explicit migration.
- `npm run seed:reset` preserves platform settings and uploaded files but removes accounts, orders and other operational rows.
- Backups are versioned JSON files and contain sensitive hashed credentials and customer data. Protect them accordingly.
