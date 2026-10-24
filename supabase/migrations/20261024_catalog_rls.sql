drop policy if exists "Admins read payment events" on public.payment_events;
drop policy if exists "Public can read active products" on public.products;
drop policy if exists "Admins manage products" on public.products;
create policy "Read published products or admin catalog" on public.products for select to anon,authenticated using (is_active = true or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins insert products" on public.products for insert to authenticated with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins update products" on public.products for update to authenticated using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins delete products" on public.products for delete to authenticated using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');