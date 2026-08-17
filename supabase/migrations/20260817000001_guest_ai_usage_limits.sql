-- Guest identifiers are client-generated UUIDs used solely for server-enforced
-- free-tier quotas. They are not auth.users records and grant no data access.
create table if not exists public.guest_meal_plan_generation_limits (
    guest_id uuid primary key,
    successful_generations smallint not null default 0 check (successful_generations >= 0 and successful_generations <= 3)
);

create table if not exists public.guest_pantry_scan_limits (
    guest_id uuid primary key,
    successful_scans smallint not null default 0 check (successful_scans >= 0 and successful_scans <= 1)
);

create or replace function public.record_successful_guest_meal_plan_generation(
    p_guest_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
    with incremented as (
        update public.guest_meal_plan_generation_limits
        set successful_generations = successful_generations + 1
        where guest_id = p_guest_id
          and successful_generations < 3
        returning true as accepted
    ), inserted as (
        insert into public.guest_meal_plan_generation_limits (guest_id, successful_generations)
        select p_guest_id, 1
        where not exists (
            select 1 from public.guest_meal_plan_generation_limits where guest_id = p_guest_id
        )
        on conflict (guest_id) do nothing
        returning true as accepted
    )
    select coalesce(
        (select accepted from incremented),
        (select accepted from inserted),
        false
    );
$$;

create or replace function public.record_successful_guest_pantry_scan(
    p_guest_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
    with incremented as (
        update public.guest_pantry_scan_limits
        set successful_scans = successful_scans + 1
        where guest_id = p_guest_id
          and successful_scans < 1
        returning true as accepted
    ), inserted as (
        insert into public.guest_pantry_scan_limits (guest_id, successful_scans)
        select p_guest_id, 1
        where not exists (
            select 1 from public.guest_pantry_scan_limits where guest_id = p_guest_id
        )
        on conflict (guest_id) do nothing
        returning true as accepted
    )
    select coalesce(
        (select accepted from incremented),
        (select accepted from inserted),
        false
    );
$$;

revoke all on function public.record_successful_guest_meal_plan_generation(uuid) from public;
grant execute on function public.record_successful_guest_meal_plan_generation(uuid) to service_role;
revoke all on function public.record_successful_guest_pantry_scan(uuid) from public;
grant execute on function public.record_successful_guest_pantry_scan(uuid) to service_role;
