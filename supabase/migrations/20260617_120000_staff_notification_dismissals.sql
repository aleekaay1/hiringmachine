-- Per-user dismissals for broadcast staff notifications.

create table if not exists public.staff_notification_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid not null references public.staff_notifications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);

create index if not exists staff_notification_dismissals_user_idx
  on public.staff_notification_dismissals (user_id, created_at desc);

alter table public.staff_notification_dismissals enable row level security;

drop policy if exists staff_notification_dismissals_select on public.staff_notification_dismissals;
create policy staff_notification_dismissals_select
on public.staff_notification_dismissals
for select to authenticated
using (user_id = auth.uid());

drop policy if exists staff_notification_dismissals_insert on public.staff_notification_dismissals;
create policy staff_notification_dismissals_insert
on public.staff_notification_dismissals
for insert to authenticated
with check (user_id = auth.uid());

comment on table public.staff_notification_dismissals is
  'Per-user hides for broadcast staff_notifications (user_id is null on the parent row).';
