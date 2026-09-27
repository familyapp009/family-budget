-- Private household-wide defaults. Financial amounts are entered privately in Supabase,
-- never embedded in public migration files or JavaScript.
create table public.household_budget_defaults (
  household_id uuid primary key references public.households(id) on delete cascade,
  net_income_cents bigint not null default 0 check (net_income_cents between 0 and 100000000000),
  euro_to_usd numeric(12,6) not null default 1.14 check (euro_to_usd > 0 and euro_to_usd < 10),
  updated_at timestamptz not null default now()
);

create table public.fixed_obligation_defaults (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 80),
  original_amount_cents bigint not null check (original_amount_cents between 0 and 100000000000),
  currency text not null check (currency in ('USD','EUR')),
  enabled boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 1000),
  unique (household_id, label)
);
create index fixed_obligation_defaults_household_idx
on public.fixed_obligation_defaults(household_id,display_order);

alter table public.household_budget_defaults enable row level security;
alter table public.fixed_obligation_defaults enable row level security;

create policy "Household members view persistent budget defaults"
on public.household_budget_defaults for select to authenticated
using (private.is_household_member(household_id));

create policy "Household members create persistent budget defaults"
on public.household_budget_defaults for insert to authenticated
with check (private.is_household_member(household_id));

create policy "Household members edit persistent budget defaults"
on public.household_budget_defaults for update to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

create policy "Household members view automatic obligation defaults"
on public.fixed_obligation_defaults for select to authenticated
using (private.is_household_member(household_id));

create policy "Household members add automatic obligation defaults"
on public.fixed_obligation_defaults for insert to authenticated
with check (private.is_household_member(household_id));

create policy "Household members edit automatic obligation defaults"
on public.fixed_obligation_defaults for update to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

create policy "Household members remove automatic obligation defaults"
on public.fixed_obligation_defaults for delete to authenticated
using (private.is_household_member(household_id));

revoke all on public.household_budget_defaults,public.fixed_obligation_defaults from anon;
grant select,insert,update on public.household_budget_defaults to authenticated;
grant select,insert,update,delete on public.fixed_obligation_defaults to authenticated;

alter publication supabase_realtime add table public.household_budget_defaults;
alter publication supabase_realtime add table public.fixed_obligation_defaults;
