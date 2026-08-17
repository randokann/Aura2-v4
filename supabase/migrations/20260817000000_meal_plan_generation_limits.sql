-- Persistent per-user, per-UTC-day successful meal-plan generation count.
-- The backend uses the service-role Supabase client, so no browser access is granted.
create table if not exists public.meal_plan_generation_limits (
    user_id uuid not null references auth.users(id) on delete cascade,
    generation_date date not null,
    successful_generations smallint not null default 0 check (successful_generations >= 0 and successful_generations <= 2),
    primary key (user_id, generation_date)
);

create or replace function public.record_successful_meal_plan_generation(
    p_user_id uuid,
    p_generation_date date
)
returns boolean
language sql
security definer
set search_path = public
as $$
    with incremented as (
        update public.meal_plan_generation_limits
        set successful_generations = successful_generations + 1
        where user_id = p_user_id
          and generation_date = p_generation_date
          and successful_generations < 2
        returning true as accepted
    ), inserted as (
        insert into public.meal_plan_generation_limits (
            user_id,
            generation_date,
            successful_generations
        )
        select p_user_id, p_generation_date, 1
        where not exists (
            select 1
            from public.meal_plan_generation_limits
            where user_id = p_user_id
              and generation_date = p_generation_date
        )
        on conflict (user_id, generation_date) do nothing
        returning true as accepted
    )
    select coalesce(
        (select accepted from incremented),
        (select accepted from inserted),
        false
    );
$$;

revoke all on function public.record_successful_meal_plan_generation(uuid, date) from public;
grant execute on function public.record_successful_meal_plan_generation(uuid, date) to service_role;
