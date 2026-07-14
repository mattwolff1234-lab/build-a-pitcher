# GoatLab Pro — go-live checklist (real money)

Everything is built and wired. Right now Pro shows **"Coming soon"** and Stripe is in **test mode**.
To start charging real money, do these in order. It's a ~15-min job once your Stripe account is
**activated** (business details + an approved bank account for payouts — that's the only blocker;
Stripe won't take real cards until it's done).

## 1. Activate the Stripe account (the gate)
- Stripe Dashboard → **Activate account** → finish business info (Wolff Labs LLC + EIN) and add the
  **bank account** for payouts. Wait for approval. *(This is the part you're waiting on.)*
- While you're in there (Stripe requires these before live): turn on **Stripe Tax**, and add a
  **Terms + Refund/Cancellation** page. A ready-to-fill page ships at `/terms.html` — link it from
  the store/footer and reference it during activation.

## 2. Swap Vercel env to LIVE Stripe keys
Stripe **test and live modes are separate** — different keys AND a different webhook.
- Dashboard → toggle to **Live mode** (top-left).
- **API keys** → copy the live secret/restricted key (`sk_live_…` / `rk_live_…`).
- **Webhooks** → create a **new webhook in Live mode**: URL
  `https://pitchinglab.pitchergami.com/api/stripe-webhook`, events
  `checkout.session.completed` · `invoice.paid` · `customer.subscription.deleted` → copy its live
  `whsec_…`.
- Vercel → env vars → set **Production** `STRIPE_SECRET_KEY` = the live key and
  `STRIPE_WEBHOOK_SECRET` = the live webhook secret. (Keep the TEST keys on Preview/Dev so preview
  builds never charge real cards.)

## 3. Flip the code switch
- In `store.js`, set **`const PRO_LIVE = true;`** — this turns the Pro card's "Coming soon" into the
  real **Subscribe** button. Commit + push (Vercel auto-deploys), or just redeploy after step 2.
  *(No other code change needed — the whole subscription flow is already live-ready.)*

## 4. Verify with one real charge
- Sign in → Store → Get GoatLab Pro → pay $5 with a **real** card.
- Confirm: card flips to **ACTIVE**, ads disappear on a game page, the premium Season Track lane
  unlocks. Then **Manage subscription** → cancel, and **refund yourself** in Stripe.
- If the balance/entitlement doesn't update: Stripe → Webhooks → your **live** endpoint → "recent
  deliveries" → look for a failed one.

## How it all works (for reference)
- **Buy**: `api/buy.js` creates a `mode:'subscription'` Stripe Checkout ($5/mo). No coins involved.
- **Grant**: `api/stripe-webhook.js` on `checkout.session.completed` + every `invoice.paid` sets
  `entitlements.pro_until` (= `no_ads_until`) to the paid period end; `customer.subscription.deleted`
  lets it lapse. Grant is idempotent + tied to the account via subscription metadata.
- **No-ads**: every ad page's loader skips Playwire **only** when that user's cached
  `no_ads_until` is in the future — per-user, defaults to ads-on. (Verified across all 14 ad pages.)
- **Premium lane**: `season-track.js hasPass()` returns true while `pro_until` is active.
- **Manage/cancel**: `api/account.js billingPortal` → Stripe billing portal.

## Reopening the coin store (later, separate from Pro)
- In `store.js` set **`const PRO_ONLY = false;`** to bring back the Get Coins tab (coin packs) and the
  coin-spend items (avatars/consumables). Independent of `PRO_LIVE`.
