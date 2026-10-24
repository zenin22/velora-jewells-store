-- Let trusted server-managed admin users inspect wishlists in the admin dashboard.
-- Customers retain access only to their own wishlist rows.
drop policy if exists "Admins read all wishlists" on public.wishlist_items;

create policy "Admins read all wishlists"
on public.wishlist_items
for select
to authenticated
using ((select ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)) = 'admin');
