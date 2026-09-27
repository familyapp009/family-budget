-- Hardening for browser API roles, plus stable per-purchase FX snapshots.
revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
revoke all on function public.normalize_purchase() from public, anon, authenticated;
revoke all on function public.touch_monthly_plan() from public, anon, authenticated;

alter table public.purchases
  add column conversion_rate numeric(12,6) not null default 1
  check (conversion_rate > 0 and conversion_rate < 10);

create or replace function public.normalize_purchase()
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
    new.conversion_rate := old.conversion_rate;
  else
    select p.euro_to_usd into rate from public.monthly_plans p
      where p.household_id = new.household_id and p.month = new.month;
    if not found then
      raise exception 'Month is not configured.';
    end if;
    new.conversion_rate := rate;
  end if;

  if new.currency = 'USD' then
    new.usd_cents := new.original_amount_cents;
  elsif new.currency = 'EUR' then
    new.usd_cents := round(new.original_amount_cents * new.conversion_rate)::bigint;
  else
    raise exception 'Unsupported currency.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
-- CREATE OR REPLACE retains the original function's ACL. Keep it trigger-only.
revoke all on function public.normalize_purchase() from public, anon, authenticated;
create index purchases_guideline_fk_idx on public.purchases(guideline_id,household_id,month);
create index purchases_recorder_fk_idx on public.purchases(recorded_by);
