create table if not exists public.site_assets (
 asset_key text primary key,
 public_url text not null,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.site_assets enable row level security;
revoke all on public.site_assets from anon, authenticated;
grant select on public.site_assets to anon, authenticated;
grant insert, update, delete on public.site_assets to authenticated;
drop policy if exists "Public can view Velora site assets" on public.site_assets;
create policy "Public can view Velora site assets" on public.site_assets for select to anon, authenticated using (true);
drop policy if exists "Admins manage Velora site assets" on public.site_assets;
create policy "Admins manage Velora site assets" on public.site_assets for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role')='admin')
with check ((select auth.jwt()->'app_metadata'->>'role')='admin');
