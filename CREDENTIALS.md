# SkyWorld Stall — Accounts

Location label: **F. Calderon St. Baguio City, Benguet**

## Important

No Admin, Operator, or Owner accounts are pre-created.

1. Start the server (`npm start`).
2. Open **http://localhost:3000/portal/admin/** and **register the first Administrator**.
3. Register Operator and Owner accounts from their portals the same way — **no email/SMS verification**. Accounts are created immediately and open the matching dashboard.
4. Existing administrators receive a **dashboard notification** for every new registration so they can review whether to keep the account (deactivate from the admin desk if needed).

## Portals

- Main portal picker: `/portal/`
- Admin: `/portal/admin/` → `/admin/`
- Operator: `/portal/operator/` → `/operator/`
- Stall owner: `/portal/owner/` → `/owner/`
- Public store: `/store/`

## Stalls

- All stalls start **available**.
- A stall becomes **taken** only when an **active** owner account is linked to it.
- Deactivating an owner releases the stall so another owner can claim it.

## Notes

- Register/login use an on-screen CAPTCHA.
- **Store name** is collected only for **stall owner** registration (not for admin or operator).
- Payments: GCash, Maya, Bank Transfer (BDO), Bank Transfer (BPI). Destination account numbers are configured by the administrator; official site links open in a new tab. Orders are not marked paid until staff confirms payment.
