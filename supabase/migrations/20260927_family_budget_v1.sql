-- Family Budget v1. Public repository contains no financial records, credentials, or member IDs.
-- Bootstrap household membership through Supabase SQL editor / trusted administrative context only.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Family' check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

-- Function deliberately bypasses member-table RLS to avoid policy recursion.
-- It cannot grant membership; it only checks the authenticated user.
create function public.is_household_member(house_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.household_members m
    where m.household_id = house_id and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

create table public.monthly_plans (
  household_id uuid not null references public.households(id),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  net_income_cents bigint not null default 0 check (net_income_cents between 0 and 100000000000),
  fixed_costs_cents bigint not null default 0 check (fixed_costs_cents between 0 and 100000000000),
  euro_to_usd numeric(12,6) not null default 1.14 check (euro_to_usd > 0 and euro_to_usd < 10),
  updated_at timestamptz not null default now(),
  primary key (household_id, month)
);

create table public.monthly_guidelines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  month text not null,
  category text not null check (length(trim(category)) between 1 and 60),
  target_cents bigint not null default 0 check (target_cents between 0 and 100000000000),
  display_order integer not null default 0 check (display_order between 0 and 1000),
  unique (household_id, month, category),
  unique (id, household_id, month),
  foreign key (household_id, month) references public.monthly_plans(household_id, month)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  month text not null,
  guideline_id uuid not null,
  spent_on date not null,
  original_amount_cents bigint not null check (original_amount_cents between 1 and 100000000000),
  currency text not null check (currency in ('USD','EUR')),
  usd_cents bigint not null check (usd_cents between 1 and 100000000000),
  note text not null default '' check (length(note) <= 280),
  recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, month) references public.monthly_plans(household_id, month),
  foreign key (guideline_id, household_id, month)
    references public.monthly_guidelines(id, household_id, month)
);
create index purchases_month_idx on public.purchases(household_id, month, spent_on desc, created_at desc);

-- Normalize currency on the server so the browser cannot forge the USD equivalent.
create function public.normalize_purchase()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare rate numeric(12,6);
begin
  if new.month <> to_char(new.spent_on, 'YYYY-MM') then
    raise exception 'Purchase date must be in the selected month.';
  end if;
  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id or new.month <> old.month
       or new.recorded_by <> old.recorded_by then
      raise exception 'Purchase ownership and month cannot be changed.';
    end if;
    new.created_at := old.created_at;
  end if;
  select p.euro_to_usd into rate from public.monthly_plans p
    where p.household_id = new.household_id and p.month = new.month;
  if not found then
    raise exception 'Month is not configured.';
  end if;
  if new.currency = 'USD' then
    new.usd_cents := new.original_amount_cents;
  elsif new.currency = 'EUR' then
    new.usd_cents := round(new.original_amount_cents * rate)::bigint;
  else
    raise exception 'Unsupported currency.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger normalize_purchase_before_write
before insert or update on public.purchases
for each row execute function public.normalize_purchase();

create function public.touch_monthly_plan()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_monthly_plan_before_update
before update on public.monthly_plans for each row execute function public.touch_monthly_plan();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.monthly_plans enable row level security;
alter table public.monthly_guidelines enable row level security;
alter table public.purchases enable row level security;

create policy "See own household" on public.households for select to authenticated
 using (public.is_household_member(id));
create policy "See own membership" on public.household_members for select to authenticated
 using (user_id = (select auth.uid()));

create policy "Members see monthly plans" on public.monthly_plans for select to authenticated
 using (public.is_household_member(household_id));
create policy "Members create monthly plans" on public.monthly_plans for insert to authenticated
 with check (public.is_household_member(household_id));
create policy "Members update monthly plans" on public.monthly_plans for update to authenticated
 using (public.is_household_member(household_id))
 with check (public.is_household_member(household_id));

create policy "Members see guidelines" on public.monthly_guidelines for select to authenticated
 using (public.is_household_member(household_id));
create policy "Members add guidelines" on public.monthly_guidelines for insert to authenticated
 with check (public.is_household_member(household_id));
create policy "Members edit guidelines" on public.monthly_guidelines for update to authenticated
 using (public.is_household_member(household_id))
 with check (public.is_household_member(household_id));
create policy "Members remove empty guidelines" on public.monthly_guidelines for delete to authenticated
 using (public.is_household_member(household_id));

create policy "Members see purchases" on public.purchases for select to authenticated
 using (public.is_household_member(household_id));
create policy "Members record purchases" on public.purchases for insert to authenticated
 with check (public.is_household_member(household_id) and recorded_by = (select auth.uid()));
create policy "Members correct purchases" on public.purchases for update to authenticated
 using (public.is_household_member(household_id))
 with check (public.is_household_member(household_id));
create policy "Members remove purchases" on public.purchases for delete to authenticated
 using (public.is_household_member(household_id));

revoke all on public.households, public.household_members, public.monthly_plans,
  public.monthly_guidelines, public.purchases from anon;
grant select on public.households, public.household_members to authenticated;
grant select, insert, update on public.monthly_plans to authenticated;
grant select, insert, update, delete on public.monthly_guidelines, public.purchases to authenticated;

-- Realtime notifications are scoped by the row policies above.
alter publication supabase_realtime add table public.monthly_plans;
alter publication supabase_realtime add table public.monthly_guidelines;
alter publication supabase_realtime add table public.purchases;
