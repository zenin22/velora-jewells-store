# Velora Jewells Store

Dark gothic jewellery storefront + Supabase-backed product inventory admin.

## Current deployment setup
- Supabase project: `arypnpohredubfaymuwm`
- Region: Mumbai (`ap-south-1`)
- Public project URL: `https://arypnpohredubfaymuwm.supabase.co`
- Frontend uses the Supabase publishable key only. Never put a service-role/secret key in browser code.

## Files
- `index.html`: responsive storefront, live active-product catalog, category filters, local cart and ₹500 product-subtotal threshold.
- `admin.html`: Supabase email/password + Google OAuth sign-in UI, server-verified admin-role check, product create/edit/publish and stock dashboard.
- `supabase/schema.sql`: schema/RLS reference (same core schema applied to the live project).

## Important setup still required before taking real orders
1. In Supabase Auth settings, configure the site's allowed redirect URLs and configure Google OAuth credentials if Google login is wanted.
2. Provision the store owner's admin role using a trusted server-side method / Supabase Dashboard user app_metadata. The role must be `app_metadata.role = admin`; do not use user-editable metadata. The admin page intentionally rejects regular users.
3. Deploy a server-side order-creation endpoint that validates product IDs/prices/stock and the minimum ₹500 subtotal, calculates the ₹70 COD advance rule if retained, creates orders transactionally, and verifies payment provider webhooks/signatures idempotently. Do not trust a browser redirect as proof of payment.
4. Add a payment provider (e.g. Razorpay) only after account/KYC and webhook secrets are configured server-side. No live payment collection is enabled in this repository yet.
5. Set shipping provider credentials server-side before automating AWB/tracking.
6. Add actual product photos and inventory from the admin dashboard after admin access is provisioned.

## Security notes
- RLS is enabled on all exposed application tables.
- Public users can read only active products and can record minimal cart events.
- Order/customer/payment tables are not publicly readable/writable.
- Admin access relies on the trusted JWT `app_metadata.role` claim.
- Publishable/anon keys are intended for frontend use; secret/service-role keys are not.
- The admin dashboard does not yet provide order management because safe order/payment endpoints are not configured.
- This is a starter implementation, not yet a live-payment production checkout.
