-- Velora Jewells: product cost snapshots, manual sold-out status and image storage.
-- Applied to the live Supabase database on 2026-10-24.
alter table public.products
  add column if not exists cost_price_inr integer check (cost_price_inr is null or cost_price_inr >= 0),
  add column if not exists is_sold_out boolean not null default false;

-- Purchase costs live in a separate authenticated admin-only table, never in the public catalog.
create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost_price_inr integer not null check (cost_price_inr >= 0),
  updated_at timestamptz not null default now()
);
insert into public.product_costs(product_id,cost_price_inr)
select id,cost_price_inr from public.products where cost_price_inr is not null
on conflict(product_id) do update set cost_price_inr=excluded.cost_price_inr,updated_at=now();
alter table public.product_costs enable row level security;
revoke all on public.product_costs from public, anon, authenticated;
grant select,insert,update,delete on public.product_costs to authenticated;
drop policy if exists "Admins manage product costs" on public.product_costs;
create policy "Admins manage product costs" on public.product_costs for all to authenticated
using ((select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin')
with check ((select ((auth.jwt()->'app_metadata'::text)->>'role'::text))='admin');

alter table public.order_items
  add column if not exists unit_cost_inr integer check (unit_cost_inr is null or unit_cost_inr >= 0);

alter table public.orders
  add column if not exists admin_expenses_inr integer not null default 0 check (admin_expenses_inr >= 0),
  add column if not exists admin_expense_note text;

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

create or replace function public.create_paid_order(
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_shipping_address jsonb, p_payment_method text, p_payment_id text,
  p_provider_order_id text, p_paid_amount_inr integer, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype; v_item jsonb; v_product public.products%rowtype;
  v_subtotal integer:=0; v_expected integer; v_order_id uuid; v_user_id uuid;
begin
  select * into v_order from public.orders
  where payment_reference=p_payment_id or payment_provider_order_id=p_provider_order_id limit 1;
  if found then return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'subtotal_inr',v_order.subtotal_inr,'paid_amount_inr',v_order.paid_amount_inr,'amount_due_inr',v_order.amount_due_inr,'payment_method',v_order.payment_method); end if;
  if p_customer_name is null or length(trim(p_customer_name))<2 or length(p_customer_name)>120 then raise exception 'Enter a valid customer name'; end if;
  if p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;
  if p_payment_method not in ('cod','prepaid') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_shipping_address)<>'object' or length(coalesce(p_shipping_address->>'line1',''))<5 or length(coalesce(p_shipping_address->>'city',''))<2 or length(coalesce(p_shipping_address->>'state',''))<2 or (p_shipping_address->>'pincode') !~ '^[0-9]{6}$' then raise exception 'Enter a complete shipping address'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>40 then raise exception 'Invalid cart'; end if;
  for v_item in select value from jsonb_array_elements(p_items) order by (value->>'id')::uuid loop
    if coalesce((v_item->>'quantity')::integer,0)<1 or (v_item->>'quantity')::integer>20 then raise exception 'Invalid quantity'; end if;
    select * into v_product from public.products where id=(v_item->>'id')::uuid and is_active=true and is_sold_out=false for update;
    if not found then raise exception 'A product is no longer available or is marked sold out'; end if;
    if v_product.stock_quantity<(v_item->>'quantity')::integer then raise exception 'Insufficient stock for %',v_product.name; end if;
    v_subtotal:=v_subtotal+v_product.price_inr*(v_item->>'quantity')::integer;
  end loop;
  if v_subtotal<500 then raise exception 'Minimum product subtotal is ₹500'; end if;
  v_expected:=case when p_payment_method='cod' then 70 else v_subtotal end;
  if p_paid_amount_inr<>v_expected then raise exception 'Payment amount does not match the order'; end if;
  select u.id into v_user_id from auth.users u where lower(u.email)=lower(nullif(trim(coalesce(p_customer_email,'')),'')) and u.email_confirmed_at is not null limit 1;
  insert into public.orders(user_id,customer_name,customer_email,customer_phone,shipping_address,subtotal_inr,shipping_fee_inr,payment_method,payment_status,order_status,payment_provider,payment_reference,payment_provider_order_id,paid_amount_inr,amount_due_inr)
  values(v_user_id,trim(p_customer_name),nullif(trim(coalesce(p_customer_email,'')),''),p_customer_phone,p_shipping_address,v_subtotal,0,p_payment_method,'paid','confirmed','razorpay',p_payment_id,p_provider_order_id,p_paid_amount_inr,greatest(v_subtotal-p_paid_amount_inr,0))
  returning id into v_order_id;
  for v_item in select value from jsonb_array_elements(p_items) order by (value->>'id')::uuid loop
    select * into v_product from public.products where id=(v_item->>'id')::uuid for update;
    if v_product.is_sold_out or not v_product.is_active or v_product.stock_quantity<(v_item->>'quantity')::integer then raise exception 'Stock changed during checkout'; end if;
    insert into public.order_items(order_id,product_id,product_name,product_image_url,unit_price_inr,quantity)
    values(v_order_id,v_product.id,v_product.name,v_product.image_url,v_product.price_inr,(v_item->>'quantity')::integer);
    update public.products set stock_quantity=stock_quantity-(v_item->>'quantity')::integer where id=v_product.id;
  end loop;
  insert into public.order_status_history(order_id,old_status,new_status,note) values(v_order_id,null,'confirmed','Payment verified by server');
  insert into public.payment_events(order_id,provider,provider_event_id,event_type,payload,processed_at)
  values(v_order_id,'razorpay',p_payment_id,'payment.captured',jsonb_build_object('payment_id',p_payment_id,'order_id',p_provider_order_id,'amount_inr',p_paid_amount_inr),now())
  on conflict(provider_event_id) do nothing;
  select * into v_order from public.orders where id=v_order_id;
  return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'subtotal_inr',v_order.subtotal_inr,'paid_amount_inr',v_order.paid_amount_inr,'amount_due_inr',v_order.amount_due_inr,'payment_method',v_order.payment_method);
end;
$$;
revoke all on function public.create_paid_order(text,text,text,jsonb,text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_paid_order(text,text,text,jsonb,text,text,text,integer,jsonb) to service_role;

-- Remove the transitional cost column so it can never be exposed with public catalog reads.
alter table public.products drop column if exists cost_price_inr;
