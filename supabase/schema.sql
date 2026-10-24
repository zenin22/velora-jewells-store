-- Velora Jewells Store schema (reference copy)
-- Full schema and policies are documented above in the database setup history.
-- Security hardening applied to the live project:
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;
create index if not exists cart_events_product_id_idx on public.cart_events(product_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists order_status_history_changed_by_idx on public.order_status_history(changed_by);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists payment_events_order_id_idx on public.payment_events(order_id);
