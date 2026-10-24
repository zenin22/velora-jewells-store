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
