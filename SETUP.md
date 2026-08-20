# LeadPilot AI — production-ready application package

This package contains the application code. It is designed for Cloudflare Workers + D1, with Stripe Billing and Resend email as external services.

## Included
- Account signup/login with hashed passwords and secure session cookies
- Business onboarding
- Lead capture API
- Authenticated customer dashboard
- Lead history
- Scheduled follow-up worker
- Resend email integration hook
- Stripe Checkout subscription integration
- Stripe webhook signature verification and subscription-state handling
- D1 schema + indexes
- Cloudflare Worker configuration and 15-minute cron

## Required account configuration
These cannot be fabricated by the application and must be supplied from your accounts:

1. Create a Cloudflare D1 database called `leadpilot` and put its ID into `wrangler.toml`.
2. Apply `schema.sql` to the remote database.
3. Add Worker secrets:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `RESEND_API_KEY`
   - `FROM_EMAIL` (optional; defaults to Resend's onboarding sender)
4. Add Worker variable `STRIPE_PRICE_ID` for the £49/month Stripe recurring Price.
5. In Stripe, create a webhook for `/api/stripe-webhook` and subscribe to at least:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
6. Deploy with Wrangler.

## Important
Do not put API keys in frontend files or the ZIP. Use Cloudflare Worker secrets. Stripe webhook signatures are verified before events are accepted.

The scheduled follow-up runs every 15 minutes. It sends up to three follow-ups when a lead has an email address and the Resend secret is configured.

## Embedding the lead form
After onboarding, the dashboard/onboarding response provides a `public_token`. Your client-facing form should POST JSON to `/api/leads/public` with `public_token`, `name`, `email`, `phone`, and `message`. Never expose the account ID or any secret key in the public form.
