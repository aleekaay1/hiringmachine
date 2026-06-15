-- Internal staff notifications (bell icon): email replies, check-ins, pipeline alerts, ops broadcasts.

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  target_roles text[] default null,
  category text not null check (category in (
    'email_reply', 'check_in', 'low_dials', 'no_show', 'callback', 'ops', 'system', 'support'
  )),
  title text not null,
  body text,
  link_route text,
  link_label text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists staff_notifications_user_created_idx
  on public.staff_notifications (user_id, created_at desc)
  where dismissed_at is null;

create index if not exists staff_notifications_role_created_idx
  on public.staff_notifications (created_at desc)
  where user_id is null and dismissed_at is null;

create unique index if not exists staff_notifications_user_dedupe_idx
  on public.staff_notifications (user_id, dedupe_key)
  where dedupe_key is not null and dismissed_at is null;

alter table public.staff_notifications enable row level security;

drop policy if exists staff_notifications_select on public.staff_notifications;
create policy staff_notifications_select
on public.staff_notifications
for select to authenticated
using (
  dismissed_at is null
  and (expires_at is null or expires_at > now())
  and (
    user_id = auth.uid()
    or (
      user_id is null
      and (
        target_roles is null
        or exists (
          select 1 from public.user_profiles up
          where up.user_id = auth.uid()
            and up.role::text = any(target_roles)
        )
      )
    )
  )
);

drop policy if exists staff_notifications_update_own on public.staff_notifications;
create policy staff_notifications_update_own
on public.staff_notifications
for update to authenticated
using (user_id = auth.uid() or user_id is null)
with check (user_id = auth.uid() or user_id is null);

comment on table public.staff_notifications is 'In-app staff notifications for recruiters and leadership.';
