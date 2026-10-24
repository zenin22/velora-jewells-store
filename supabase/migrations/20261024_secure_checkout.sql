-- Velora Jewells secure checkout migration
alter table public.orders
  add column if not exists paid_amount_inr integer not null default 0 check (paid_amount_inr >= 0),
  add column if not exists amount_due_inr integer not null default 0 check (amount_due_inr >= 0),
  add column if not exists payment_provider_order_id text unique;

create unique index if not exists orders_payment_reference_unique
  on public.orders(payment_reference) where payment_reference is not null;

create or replace function public.create_paid_order(
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_shipping_address jsonb, p_payment_method text, p_payment_id text,
  p_provider_order_id text, p_paid_amount_inr integer, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_subtotal integer := 0;
  v_expected integer;
  v_order_id uuid;
begin
  select * into v_order from public.orders
  where payment_reference = p_payment_id or payment_provider_order_id = p_provider_order_id limit 1;
  if found then
    return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'subtotal_inr',v_order.subtotal_inr,'paid_amount_inr',v_order.paid_amount_inr,'amount_due_inr',v_order.amount_due_inr,'payment_method',v_order.payment_method);
  end if;
  if p_customer_name is null or length(trim(p_customer_name)) < 2 or length(p_customer_name) > 120 then raise exception 'Enter a valid customer name'; end if;
  if p_customer_phone is null or p_customer_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;
  if p_payment_method not in ('cod','prepaid') then raise exception 'Invalid payment method'; end if;
  if jsonb_typeof(p_shipping_address) <> 'object'
     or length(coalesce(p_shipping_address->>'line1','')) < 5
     or length(coalesce(p_shipping_address->>'city','')) < 2
     or length(coalesce(p_shipping_address->>'state','')) < 2
     or coalesce(p_shipping_address->>'pincode','') !~ '^[0-9]{6}$' then raise exception 'Enter a complete shipping address'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 40 then raise exception 'Invalid cart'; end if;
  for v_item in select value from jsonb_array_elements(p_items) order by (value->>'id')::uuid loop
    if coalesce((v_item->>'quantity')::integer,0) < 1 or (v_item->>'quantity')::integer > 20 then raise exception 'Invalid quantity'; end if;
    select * into v_product from public.products where id=(v_item->>'id')::uuid and is_active=true for update;
    if not found then raise exception 'A product is no longer available'; end if;
    if v_product.stock_quantity < (v_item->>'quantity')::integer then raise exception 'Insufficient stock for %',v_product.name; end if;
    v_subtotal := v_subtotal + v_product.price_inr * (v_item->>'quantity')::integer;
  end loop;
  if v_subtotal < 500 then raise exception 'Minimum product subtotal is ₹500'; end if;
  v_expected := case when p_payment_method='cod' then 70 else v_subtotal end;
  if p_paid_amount_inr <> v_expected then raise exception 'Payment amount does not match the order'; end if;
  insert into public.orders(customer_name,customer_email,customer_phone,shipping_address,subtotal_inr,shipping_fee_inr,payment_method,payment_status,order_status,payment_provider,payment_reference,payment_provider_order_id,paid_amount_inr,amount_due_inr)
  values(trim(p_customer_name),nullif(trim(coalesce(p_customer_email,'')),''),p_customer_phone,p_shipping_address,v_subtotal,0,p_payment_method,'paid','confirmed','razorpay',p_payment_id,p_provider_order_id,p_paid_amount_inr,greatest(v_subtotal-p_paid_amount_inr,0))
  returning id into v_order_id;
  for v_item in select value from jsonb_array_elements(p_items) order by (value->>'id')::uuid loop
    select * into v_product from public.products where id=(v_item->>'id')::uuid for update;
    if v_product.stock_quantity < (v_item->>'quantity')::integer then raise exception 'Stock changed during checkout'; end if;
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

create or replace function public.restore_stock_on_cancel()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.order_status='cancelled' and new.order_status<>'cancelled' then raise exception 'A cancelled order cannot be reactivated; create a new order instead'; end if;
  if old.order_status in ('shipped','delivered','returned') and new.order_status='cancelled' then raise exception 'An order that has shipped cannot be cancelled from the admin dashboard'; end if;
  if old.order_status<>'cancelled' and new.order_status='cancelled' then
    update public.products p set stock_quantity=p.stock_quantity+oi.quantity
    from public.order_items oi where oi.order_id=old.id and oi.product_id=p.id;
  end if;
  return new;
end;
$$;
drop trigger if exists restore_stock_when_order_cancelled on public.orders;
create trigger restore_stock_when_order_cancelled before update of order_status on public.orders for each row execute function public.restore_stock_on_cancel();
revoke all on function public.restore_stock_on_cancel() from public,anon,authenticated;
grant execute on function public.restore_stock_on_cancel() to postgres,service_role;
