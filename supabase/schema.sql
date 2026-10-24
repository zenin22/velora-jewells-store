-- Velora Jewells Store schema reference. Live schema is applied to the Supabase project.
create extension if not exists pgcrypto;
create table if not exists public.products (id uuid primary key default gen_random_uuid(),name text not null,slug text unique,description text not null default '',category text not null default 'Chains',price_inr integer not null check(price_inr>=0),compare_at_price_inr integer check(compare_at_price_inr is null or compare_at_price_inr>=price_inr),image_url text not null default '',stock_quantity integer not null default 0 check(stock_quantity>=0),is_active boolean not null default false,is_featured boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade,display_name text,created_at timestamptz not null default now());
create table if not exists public.orders (id uuid primary key default gen_random_uuid(),order_number text not null unique default ('VJ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),user_id uuid references auth.users(id) on delete set null,customer_name text not null,customer_email text,customer_phone text not null,shipping_address jsonb not null,subtotal_inr integer not null check(subtotal_inr>=0),shipping_fee_inr integer not null default 0 check(shipping_fee_inr>=0),payment_method text not null check(payment_method in ('cod','prepaid')),payment_status text not null default 'pending' check(payment_status in ('pending','paid','failed','refunded')),order_status text not null default 'pending' check(order_status in ('pending','confirmed','packed','shipped','delivered','cancelled','returned')),payment_provider text,payment_reference text,tracking_company text,tracking_number text,tracking_url text,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.order_items (id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,product_id uuid references public.products(id) on delete set null,product_name text not null,product_image_url text not null default '',unit_price_inr integer not null check(unit_price_inr>=0),quantity integer not null check(quantity>0),line_total_inr integer generated always as (unit_price_inr*quantity) stored);
create table if not exists public.payment_events (id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id) on delete set null,provider text not null,provider_event_id text unique,event_type text not null,payload jsonb not null default '{}'::jsonb,processed_at timestamptz,created_at timestamptz not null default now());
create table if not exists public.order_status_history (id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,old_status text,new_status text not null,note text,changed_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create table if not exists public.cart_events (id uuid primary key default gen_random_uuid(),session_id text not null,product_id uuid references public.products(id) on delete set null,event_type text not null check(event_type in ('view','add_to_cart','remove_from_cart','checkout_started')),quantity integer not null default 1 check(quantity>0),created_at timestamptz not null default now());
create index if not exists products_active_category_idx on public.products(is_active,category);
create index if not exists products_created_at_idx on public.products(created_at desc);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_status_idx on public.orders(order_status,payment_status);
create index if not exists orders_phone_idx on public.orders(customer_phone);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id,created_at desc);
create index if not exists cart_events_product_id_idx on public.cart_events(product_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists order_status_history_changed_by_idx on public.order_status_history(changed_by);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists payment_events_order_id_idx on public.payment_events(order_id);
alter table public.products enable row level security; alter table public.profiles enable row level security; alter table public.orders enable row level security; alter table public.order_items enable row level security; alter table public.payment_events enable row level security; alter table public.order_status_history enable row level security; alter table public.cart_events enable row level security;
drop policy if exists "Public can read active products" on public.products; create policy "Public can read active products" on public.products for select to anon,authenticated using(is_active=true);
drop policy if exists "Admins manage products" on public.products; create policy "Admins manage products" on public.products for all to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin') with check((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Users read own profile" on public.profiles; create policy "Users read own profile" on public.profiles for select to authenticated using((select auth.uid())=id or (select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Users update own profile" on public.profiles; create policy "Users update own profile" on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
drop policy if exists "Users create own profile" on public.profiles; create policy "Users create own profile" on public.profiles for insert to authenticated with check((select auth.uid())=id);
drop policy if exists "Admins read orders" on public.orders; create policy "Admins read orders" on public.orders for select to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins create orders" on public.orders; create policy "Admins create orders" on public.orders for insert to authenticated with check((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins update orders" on public.orders; create policy "Admins update orders" on public.orders for update to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin') with check((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins manage order items" on public.order_items; create policy "Admins manage order items" on public.order_items for all to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin') with check((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins read payment events" on public.payment_events; create policy "Admins read payment events" on public.payment_events for select to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins manage payment events" on public.payment_events; create policy "Admins manage payment events" on public.payment_events for all to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin') with check((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins read order history" on public.order_status_history; create policy "Admins read order history" on public.order_status_history for select to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Admins add order history" on public.order_status_history; create policy "Admins add order history" on public.order_status_history for insert to authenticated with check((select auth.jwt())->'app_metadata'->>'role'='admin');
drop policy if exists "Public can record cart analytics" on public.cart_events; create policy "Public can record cart analytics" on public.cart_events for insert to anon,authenticated with check(true);
drop policy if exists "Admins read cart analytics" on public.cart_events; create policy "Admins read cart analytics" on public.cart_events for select to authenticated using((select auth.jwt())->'app_metadata'->>'role'='admin');
grant select on public.products to anon,authenticated; grant insert,update,delete on public.products to authenticated; grant select,insert,update on public.profiles to authenticated; grant select,insert,update on public.orders to authenticated; grant select,insert,update,delete on public.order_items to authenticated; grant select,insert,update,delete on public.payment_events to authenticated; grant select,insert on public.order_status_history to authenticated; grant insert on public.cart_events to anon,authenticated; grant select on public.cart_events to authenticated;
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists products_set_updated_at on public.products; create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders; create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name')) on conflict(id) do nothing; return new; end; $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
grant execute on function public.handle_new_user() to postgres,service_role;
drop trigger if exists on_auth_user_created on auth.users; create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();


-- Admin-managed cost tracking, image uploads and sold-out status (reference schema additions).
-- Keep purchase cost in a dedicated RLS-protected table; it is never a products column.
alter table public.products
  add column if not exists is_sold_out boolean not null default false;
alter table public.order_items
  add column if not exists unit_cost_inr integer check (unit_cost_inr is null or unit_cost_inr >= 0);
alter table public.orders
  add column if not exists admin_expenses_inr integer not null default 0 check (admin_expenses_inr >= 0),
  add column if not exists admin_expense_note text;

create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost_price_inr integer not null check (cost_price_inr >= 0),
  updated_at timestamptz not null default now()
);
alter table public.product_costs enable row level security;
revoke all on public.product_costs from public,anon,authenticated;
grant select,insert,update,delete on public.product_costs to authenticated;
drop policy if exists "Admins manage product costs" on public.product_costs;
create policy "Admins manage product costs" on public.product_costs for all to authenticated
using ((select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin')
with check ((select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin');

create or replace function public.snapshot_order_item_cost()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.unit_cost_inr is null and new.product_id is not null then
    select pc.cost_price_inr into new.unit_cost_inr from public.product_costs pc where pc.product_id=new.product_id;
  end if;
  return new;
end;
$$;
drop trigger if exists snapshot_order_item_cost_before_insert on public.order_items;
create trigger snapshot_order_item_cost_before_insert before insert on public.order_items
for each row execute function public.snapshot_order_item_cost();
revoke all on function public.snapshot_order_item_cost() from public,anon,authenticated;
grant execute on function public.snapshot_order_item_cost() to postgres,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('velora-product-images','velora-product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set name=excluded.name,public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Public can view Velora product images" on storage.objects;
create policy "Public can view Velora product images" on storage.objects for select to anon,authenticated
using(bucket_id='velora-product-images');
drop policy if exists "Admins upload Velora product images" on storage.objects;
create policy "Admins upload Velora product images" on storage.objects for insert to authenticated
with check(bucket_id='velora-product-images' and (select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin');
drop policy if exists "Admins update Velora product images" on storage.objects;
create policy "Admins update Velora product images" on storage.objects for update to authenticated
using(bucket_id='velora-product-images' and (select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin')
with check(bucket_id='velora-product-images' and (select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin');
drop policy if exists "Admins delete Velora product images" on storage.objects;
create policy "Admins delete Velora product images" on storage.objects for delete to authenticated
using(bucket_id='velora-product-images' and (select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin');

-- Transactional order-email status (email address/credential secrets are never stored here).
-- Email notification audit for confirmed Velora Jewells orders.
-- The service-role verify-payment Edge Function writes these records.
create table if not exists public.order_email_notifications (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  resend_email_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_email_notifications enable row level security;
revoke all on table public.order_email_notifications from public, anon, authenticated;
grant select on table public.order_email_notifications to authenticated;
grant all on table public.order_email_notifications to service_role;
drop policy if exists "Admins can read order email notification status" on public.order_email_notifications;
create policy "Admins can read order email notification status"
on public.order_email_notifications for select to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

-- Index the wishlist product foreign key for efficient admin joins and deletion checks.
create index if not exists wishlist_items_product_id_idx on public.wishlist_items(product_id);
