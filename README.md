# Velora Jewells Store

Responsive gothic jewellery storefront and admin dashboard built with plain HTML/CSS/JS, Supabase and Razorpay.

## Repository
- Storefront: `index.html`
- Admin: `admin.html`
- Store information/policies: `policies.html`
- Database reference schema: `supabase/schema.sql`
- Secure checkout migration: `supabase/migrations/20261024_secure_checkout.sql`\n- Catalog RLS policy migration: `supabase/migrations/20261024_catalog_rls.sql`
- Edge Function source: `supabase/functions/create-checkout/index.ts`, `supabase/functions/verify-payment/index.ts`
- GitHub Pages workflow: `.github/workflows/pages.yml`

## Supabase project
- Project ref: `arypnpohredubfaymuwm`
- Region: Mumbai (`ap-south-1`)
- URL: `https://arypnpohredubfaymuwm.supabase.co`
- Frontend uses a public publishable key only. Never put a service-role key or Razorpay secret in browser code or GitHub.

## Features currently implemented
- Dark gothic responsive storefront and category filters.
- Live catalog reads only published/active products.
- Shopping bag stored in the customer's browser; stock limits are respected in the UI.
- ₹500 minimum product subtotal and free-shipping display.
- Checkout form for Indian delivery details.
- Razorpay server-side order creation and signature/payment-status verification.
- Prepaid full payment and COD ₹70 online advance; remaining product subtotal is shown as due at delivery.
- Server-side product price/stock validation, order snapshots, stock deduction and payment-event logging.
- Admin-role protected product create/edit/publish and stock dashboard.
- Admin order fulfilment dashboard with status, courier, AWB/tracking URL, gross-sales metrics and cancellation stock restoration.
- Admin product photo uploads via a public product-image bucket with admin-only write policies; JPG/PNG/WebP images up to 5 MB.
- Manual sold-out badge/status that is displayed in the storefront and blocked by both checkout validation layers.
- Purchase-cost entry, per-order cost snapshots, order-level extra-expense tracking, and estimated profit / delivered-sales metrics.
- Admin order counts for pending, confirmed, packed/shipped and delivered; order cards show item quantities, selling costs, purchase costs and item margin.
- Admin customer directory with saved profile/contact/address fields, order counts and wishlist counts; customer and activity CSV exports.
- Admin wishlist overview, recent product/cart/checkout activity, and order-status/payment-event audit trail (all restricted to trusted admin role).
- Store policies for shipping, returns/unboxing evidence, privacy, payments, terms and FAQs.

## Required owner setup before live sales
1. **Set Razorpay secrets in Supabase**: open Supabase Dashboard → Edge Functions → Secrets and add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from the verified Razorpay account. Never share the secret in chat, frontend code or GitHub. Ensure the Razorpay account is activated and payment capture is enabled.
2. **Grant the store owner admin access**: create/sign in the owner's account in Supabase Auth first. Then grant the trusted owner the server-managed `app_metadata.role = admin` claim from a trusted admin process. The admin page intentionally rejects normal accounts. Ask the project owner to provision the role; do not use user-editable metadata.
3. **Configure Google OAuth (optional)**: Supabase Authentication → Providers → Google, set the Google client credentials and add the exact deployed admin URL to the allowed redirect URLs. Password sign-in is also supported.
4. **Enable GitHub Pages**: in the repository open Settings → Pages and select **GitHub Actions** as the build/deploy source. Then open Actions and confirm the Pages workflow completes. The workflow file being present does not itself prove the public site is deployed.
5. **Upload actual inventory**: after admin access is provisioned, add real product names, correct prices, actual stock counts and HTTPS product-image URLs. The database currently starts empty; no fake products or stock are seeded.
6. **Before launch**: run a low-value test payment, confirm both prepaid and ₹70 COD-advance flows, verify order confirmation and stock changes, test cancellation/stock restoration, and confirm a refund path with Razorpay support. Do not advertise checkout as live until this passes.

## Important implementation notes
- Payment confirmation is server-verified using Razorpay's API and checkout signature. A browser redirect alone is never proof of payment.
- If order validation fails after a captured payment, the verification function attempts a refund and checks the gateway response. If the refund request fails, the customer is told to contact support with the payment ID.
- Order/payment/customer tables are not publicly readable or writable; RLS is enabled. Only the trusted service-role function creates paid orders.
- Admin access checks the server-managed JWT claim `app_metadata.role = admin`; never expose the Supabase service-role key.
- Cancelled orders restore stock; shipped/delivered/returned orders cannot be cancelled through the dashboard. Returned stock should be inspected before manually restocking.
- No product images, inventory, Google OAuth credentials, Razorpay secrets or owner admin identity are invented or included in the repo.
