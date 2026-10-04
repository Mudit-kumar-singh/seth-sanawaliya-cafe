# Seth Sanwaliya Restaurant — Phase 6.1 (Staff Permissions)

## Staff permissions

Owner has full management access. Staff has only Orders, Kitchen operations, and own password change. Owner-only dashboard analytics, menu administration, table QR management, reports, staff accounts, and manual payment verification are blocked both in the UI and on the server.

## Test
1. Owner login → Staff → create a staff account.
2. Logout → login as staff.
3. Confirm Staff Portal shows only Orders and Kitchen.
4. Confirm staff can move orders through the kitchen workflow.
5. Confirm owner-only API actions return 403.
6. Log back in as owner and verify all existing features still work.

# Seth Sanwaliya Restaurant — Phase 6

Phase 6 adds a real Razorpay payment-gateway integration architecture on top of the Phase 5.1 restaurant ordering system.

## What changed

- Razorpay Orders API integration on the server
- Razorpay Standard Checkout on the customer page
- Online UPI payment flow for customer orders
- Server-side payment signature verification
- Server-side payment amount/order matching
- Razorpay payment-status lookup before marking an order paid
- Razorpay webhook endpoint with HMAC signature verification
- Duplicate webhook-event protection
- UPI orders are **not sent to the kitchen until payment is captured/verified**
- Owner dashboard payment status shows gateway verification state
- Manual UPI "Mark paid" fallback is available only when the gateway is not configured and only to an owner
- Analytics/revenue exclude unpaid UPI orders
- Existing counter-payment flow remains unchanged

## Important: this ZIP does NOT contain Razorpay secrets

Never put the Razorpay Key Secret or webhook secret in source code or commit them to GitHub. Razorpay recommends keeping API secrets outside version control and validating payment/webhook signatures on the server. See the official security checklist.

## Setup — Razorpay Test Mode first

1. Create/activate a Razorpay merchant account and switch to **Test Mode**.
2. Generate Test Mode API keys.
3. Copy `.env.example` to `.env`.
4. Put the Test Mode values in `.env`:

```env
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_test_secret
RAZORPAY_WEBHOOK_SECRET=your_long_random_webhook_secret
```

5. Start the app:

```bash
npm install
npm start
```

## Local testing

Customer:
`http://localhost:3000/?table=8`

Owner:
`http://localhost:3000/owner.html`

Kitchen:
`http://localhost:3000/kitchen.html`

## Test payment flow

1. Open a table URL such as `?table=8`.
2. Add items.
3. Enter customer name and phone.
4. Select **Pay online by UPI**.
5. Click **Pay securely with UPI**.
6. Razorpay Test Mode opens.
7. Use Razorpay's current Test Mode payment instructions/credentials. No real money should be charged in Test Mode.
8. After checkout returns, the server verifies the signature and checks the payment/order/amount before marking the cafe order paid.
9. The paid UPI order can then appear on the Kitchen Display.

For UPI Test Mode, Razorpay's current documentation describes simulated success/failure flows; use the exact test credentials shown in the Razorpay Dashboard/docs rather than real UPI credentials.

## Webhook setup

For production, configure a Razorpay webhook pointing to:

`https://YOUR-DOMAIN/api/payments/webhook`

Subscribe to at least:
- `payment.captured`
- `payment.failed`
- `order.paid`

Use the same value as `RAZORPAY_WEBHOOK_SECRET` in the Razorpay webhook configuration and the server `.env`.

A localhost URL cannot receive Razorpay's server-to-server webhook directly. During local development, test the checkout/signature flow first; webhook testing can be done after the app has a publicly reachable HTTPS URL/tunnel.

## Go-live

After Test Mode passes:

1. Complete Razorpay merchant onboarding/KYC.
2. Switch the Razorpay Dashboard to Live Mode.
3. Generate Live API keys.
4. Replace only the server-side environment variables with the Live keys.
5. Configure the production webhook URL and secret.
6. Deploy behind HTTPS.
7. Run a small real transaction and verify the payment appears as `captured` before serving customers.

Do not paste API secrets into ChatGPT or into the browser-side JavaScript.
