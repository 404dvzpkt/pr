# Email and SMS provider setup

SkyWorld Stall sends real messages through a provider you configure. Provider credentials can be saved from **Admin → System Settings → Delivery providers** or supplied through environment variables. Credentials are never sent back to the browser.

This guide covers:

1. Registration verification codes.
2. Password-recovery codes.
3. Order-confirmation SMS.
4. Configuring SMTP and SMS from the admin dashboard or `.env`.
5. The development outbox fallback and production behavior.
6. Testing, troubleshooting and limits.

---

## 1. Where codes are used

### Registration verification

1. A user opens a role portal (`/portal/owner/`, `/portal/admin/`, `/portal/operator/`) and submits the registration form.
2. The user chooses **email** or **SMS** and the server sends a six-digit code to that contact.
3. The account is **not created yet**. The server stores the pending registration with hashed token, hashed password and hashed code.
4. The user enters the code on the verification screen.
5. Only after a successful code check does the server create the account (and claim the owner's stall) inside a transaction, then sign the user in.

Rules:

- Code lifetime: **10 minutes**.
- Wrong-code limit: **6 attempts**, after which the user must request a new code.
- Resends: up to **3**, with a **30-second cooldown** between sends.
- Pending registration expires after **30 minutes**.
- Rate limits: 12 registration starts per IP per hour, 5 code sends per contact per hour, 20 resends per IP per hour, 40 verification attempts per IP per 15 minutes.
- A duplicate email/phone or an owner stall claimed in the meantime is rejected again at verification time.

### Password recovery

1. The user clicks **Forgot password** in any portal and enters the account email or mobile number.
2. The server finds the account and sends a six-digit code to the registered contact.
3. The response is deliberately generic for known and unknown accounts.
4. The code expires after **15 minutes**, allows **5 attempts**, is single-use, and is invalidated when a new code is requested.
5. A successful reset invalidates every existing session for that user.

---

## 2. Configure delivery in the admin dashboard (recommended)

1. Sign in at `/portal/admin/`.
2. Open **System Settings**.
3. Find **Delivery providers**.
4. **Email · SMTP:** enter host, port, connection type, username, password and From address, then click **Save email provider**.
5. **SMS:** choose Semaphore, Twilio or Webhook, fill in that provider's fields, then click **Save SMS provider**.
6. Click **Send test email** / **Send test SMS**. Tests go only to the signed-in administrator's own registered email and mobile number.
7. Register a test account or use **Forgot password** to complete one real delivery test.

Behavior:

- Saved settings are written to `data/providers.json` (override with `PROVIDERS_FILE`). The file is created with restricted permissions where the OS supports them.
- Saved dashboard values override the corresponding environment values.
- Blank password/API-key fields keep the previously saved secret, so you can edit other fields without retyping it.
- **Clear** removes a saved provider and falls back to environment configuration.
- The page shows Configured/Not configured, the source (`settings`, `environment`, `none`), masked usernames, and whether a secret is stored. It never shows the secret itself.
- Changes apply immediately; no restart is required for dashboard changes.

---

## 3. Configure through environment variables

Add values to `.env` (copy `.env.example`) or the host's secret manager, then restart the server.

### SMTP email

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@example.com
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=postmaster@example.com
SMTP_FROM_NAME=SkyWorld Stall
```

| Variable | Meaning |
| --- | --- |
| `SMTP_HOST` | SMTP server hostname. Required. |
| `SMTP_PORT` | Usually 587 (STARTTLS) or 465 (implicit TLS). |
| `SMTP_SECURE` | `true` for implicit TLS on port 465; `false` for STARTTLS. |
| `SMTP_USER` | Login username, usually the full email address. |
| `SMTP_PASS` | Password or app password. Never a normal Gmail password. |
| `SMTP_FROM` | From address. Required for email to count as configured. |
| `SMTP_FROM_NAME` | Display name in the mailbox. |

`SMTP_HOST` and `SMTP_FROM` must both be present for email to be considered configured.

#### Gmail

1. Enable 2-Step Verification on the Google account.
2. Open Google Account → Security → App passwords.
3. Create an app password for Mail.
4. Use:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-address@gmail.com
SMTP_PASS=the-16-character-app-password
SMTP_FROM=your-address@gmail.com
SMTP_FROM_NAME=SkyWorld Stall
```

#### Other SMTP providers

- Zoho Mail: `smtp.zoho.com`, port 587, STARTTLS.
- Microsoft 365: `smtp.office365.com`, port 587, STARTTLS (tenant policies may require SMTP AUTH).
- Mailgun/Postmark/SendGrid SMTP endpoints: use the credentials issued by that service.

If the provider requires a verified sender domain, verify it before testing.

### SMS

Choose exactly one provider:

```env
SMS_PROVIDER=semaphore   # or twilio, or webhook
```

Leave `SMS_PROVIDER` blank to disable SMS.

#### Semaphore (Philippines)

```env
SMS_PROVIDER=semaphore
SEMAPHORE_API_KEY=your-semaphore-api-key
SEMAPHORE_SENDER_NAME=SkyWorld
```

- Create an API key in your Semaphore account.
- The sender name may need approval.
- Posts to `https://api.semaphore.co/api/v4/messages`.
- Numbers are normalized to the `639xxxxxxxxx` form.

#### Twilio

```env
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM=+15551234567
```

- The sender must be an SMS-capable Twilio number.
- Posts to the Twilio Messages API with HTTP Basic authentication.
- Trial accounts can usually send only to verified recipient numbers.

#### Custom webhook

```env
SMS_PROVIDER=webhook
SMS_WEBHOOK_URL=https://sms-gateway.example.com/send
SMS_WEBHOOK_TOKEN=your-bearer-token
```

The server sends:

```json
{
  "to": "+639171234567",
  "message": "SkyWorld Stall: ..."
}
```

with `Authorization: Bearer <token>` when `SMS_WEBHOOK_TOKEN` is set. The endpoint must return a 2xx response.

> Treat the webhook URL and token as secrets. Anyone with them can send messages through your gateway.

---

## 4. Development fallback, outbox and production behavior

### Development/test with no provider

- The code is returned to the verification screen as a clearly labelled **development preview**.
- The code is also written to the `delivery_outbox` table and shown in the admin **Delivery providers** panel (masked recipient).
- The response says delivery was not sent; nothing pretends an email or SMS went out.
- Outbox rows older than two days are pruned automatically.

This makes the full registration and recovery flow testable without credentials. Never enable this behavior for production.

### Production with no provider

- Registration cannot proceed: the start route returns a delivery-unavailable error and the account is not created.
- Forgot-password returns HTTP 503 `provider_not_configured` before generating a code.
- No code is returned in JSON, embedded in HTML, or written to the outbox.

### Provider configured but delivery fails

- The API returns an honest failure; the code is not exposed.
- Provider error details are written to the server console, not to the browser.
- For registration, the pending row remains available so the user can try a resend after the cooldown.
- For password recovery, the response tells the user delivery failed and to ask the administrator.

---

## 5. Verify delivery

1. Save provider credentials in **Admin → System Settings → Delivery providers** (or `.env` + restart).
2. The provider row should show **Configured** and its source.
3. Click **Send test email** and/or **Send test SMS**.
   - Test email goes only to the signed-in administrator's account email.
   - Test SMS goes only to the signed-in administrator's account mobile number.
   - Results are shown in the page, recorded in the delivery status and written to the activity log.
4. Test registration:
   - Sign out.
   - Open `/portal/owner/` (or another portal) and choose **Create account**.
   - Pick email or SMS, submit, and check the inbox/phone for the code.
5. Test recovery:
   - Sign out, open a role portal, choose **Forgot password**.
   - Enter the registered email or phone and check the message.

The code is sent to the contact stored on the account or entered during registration. It cannot be redirected to an arbitrary address from the browser.

---

## 6. Order confirmation SMS

When a guest places an order:

- If an SMS provider is configured, the server attempts to send the order confirmation to the checkout phone number.
- The result is stored on the order (`sms_status`, `sms_detail`).
- The thank-you page shows the provider result when accepted. If delivery fails or no provider exists, it says so explicitly; it never displays "sent" unless the provider accepted the message.
- An unconfigured installation returns `smsConfigured: false` and an honest "No SMS provider" message.

SMS is a notification, not a payment or delivery guarantee. It is not retried indefinitely and does not replace the on-screen order code.

---

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| Providers still show **Not configured** | The admin-saved config must include the required fields; environment SMTP needs `SMTP_HOST` and `SMTP_FROM`; SMS needs the selected provider's required fields. Dashboard changes apply immediately; `.env` changes need a restart. |
| Test email fails | Host/port/encryption mismatch, wrong app password, sender not allowed, provider requiring SPF/DKIM, or outbound port blocked by the host. Check the server console and provider logs. |
| Gmail rejects the login | Use an App Password with 2-Step Verification; do not use the normal account password. |
| Test SMS fails | Sender name/number not approved, trial recipient not verified, insufficient balance, wrong country format, or webhook returning non-2xx. |
| Registration says delivery is unavailable | Neither channel is configured, or the selected channel's provider is not configured. Configure it in Admin → System Settings or `.env`. |
| Registration code rejected | Codes expire after 10 minutes, allow six attempts, and are replaced when you resend. Use the latest code. |
| Recovery code rejected | Codes expire after 15 minutes and allow five attempts. Request a new code. |
| Provider accepts but mailbox does not receive | Check spam/quarantine, sender reputation, SPF/DKIM/DMARC and the provider's delivery logs. "Accepted by provider" is not a guarantee of inbox delivery. |
| Development code is visible on screen | Expected when no provider is configured in development. Add real credentials before treating the installation as production. |

Server-side failures return generic messages to users. Detailed provider errors are not exposed to the browser; use the server console and provider dashboards for diagnosis.

---

## 8. Security notes

- Keep credentials in `data/providers.json` (restricted permissions) or in `.env`/the production secret manager. Never put them in frontend code, screenshots, documentation or delivered ZIPs.
- `.env.example` contains placeholders only.
- SMTP TLS certificates are verified; there is no "ignore certificate errors" option.
- The custom SMTP client has a 15-second socket timeout and the SMS adapter has a 15-second request timeout.
- Registration and recovery codes are hashed and single-use. In production, they are never shown in the UI, API responses, browser logs or HTML.
- Development preview codes are a deliberate testing aid and are disabled automatically when `NODE_ENV=production`.
- Password recovery deliberately returns the same message for known and unknown accounts.
- Rate limits apply per IP and per contact; repeated wrong codes consume attempts.
- If `RESET_PEPPER` is empty, a random pepper is generated at boot and pending codes become invalid after a restart. Set a long random `RESET_PEPPER` in production if codes should survive restarts.
- Provider test messages can only go to the signed-in administrator's own registered contact.
- Run the server over HTTPS in production and keep `APP_ORIGIN` on that HTTPS URL.
