-- Remove remaining public API SECURITY DEFINER warning by moving RLS helper
-- to a schema that is not exposed through PostgREST.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_household_member(house_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.household_members m
    where m.household_id = house_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_household_member(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;

alter policy "See own household" on public.households
  using (private.is_household_member(id));

alter policy "Members see monthly plans" on public.monthly_plans
  using (private.is_household_member(household_id));
alter policy "Members create monthly plans" on public.monthly_plans
  with check (private.is_household_member(household_id));
alter policy "Members update monthly plans" on public.monthly_plans
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

alter policy "Members see guidelines" on public.monthly_guidelines
  using (private.is_household_member(household_id));
alter policy "Members add guidelines" on public.monthly_guidelines
  with check (private.is_household_member(household_id));
alter policy "Members edit guidelines" on public.monthly_guidelines
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
alter policy "Members remove empty guidelines" on public.monthly_guidelines
  using (private.is_household_member(household_id));

alter policy "Members see purchases" on public.purchases
  using (private.is_household_member(household_id));
alter policy "Members record purchases" on public.purchases
  with check (private.is_household_member(household_id) and recorded_by = (select auth.uid()));
alter policy "Members correct purchases" on public.purchases
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
alter policy "Members remove purchases" on public.purchases
  using (private.is_household_member(household_id));

drop function public.is_household_member(uuid);
