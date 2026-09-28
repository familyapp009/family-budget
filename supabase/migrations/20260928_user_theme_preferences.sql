-- Personal display preference, not shared between household members.
create table public.user_theme_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  updated_at timestamptz not null default now()
);

alter table public.user_theme_preferences enable row level security;

create policy "Users can view their own theme"
on public.user_theme_preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users can create their own theme"
on public.user_theme_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update their own theme"
on public.user_theme_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.user_theme_preferences from anon;
grant select, insert, update on public.user_theme_preferences to authenticated;
