create table public.guest_import_items (
    user_id uuid not null
        references auth.users(id) on delete cascade,
    source_guest_id uuid not null,
    entity_type text not null
        check (entity_type in ('profile', 'meal', 'workout', 'meal_plan')),
    client_import_id text not null
        check (char_length(client_import_id) between 1 and 128)
        check (client_import_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
    payload_hash text not null
        check (payload_hash ~ '^[0-9a-f]{64}$'),
    target_id uuid,
    outcome text not null
        check (outcome in ('imported', 'skipped_existing')),
    imported_at timestamptz not null default now(),

    primary key (
        user_id,
        source_guest_id,
        entity_type,
        client_import_id
    ),

    check (
        (outcome = 'imported' and target_id is not null)
        or
        (outcome = 'skipped_existing' and target_id is null)
    ),
    check (outcome <> 'skipped_existing' or entity_type = 'profile')
);

alter table public.guest_import_items enable row level security;

revoke all on table public.guest_import_items
    from public, anon, authenticated, service_role;


create or replace function public.import_guest_data(
    p_user_id uuid,
    p_source_guest_id uuid,
    p_confirm_existing_account boolean,
    p_profile jsonb,
    p_meals jsonb,
    p_workouts jsonb,
    p_meal_plans jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_requested jsonb := '[]'::jsonb;
    v_item jsonb;
    v_entity_type text;
    v_client_import_id text;
    v_target_id uuid;
    v_ledger_outcome text;
    v_new_item_count integer := 0;

    v_existing_profile boolean := false;
    v_existing_meals boolean := false;
    v_existing_workouts boolean := false;
    v_existing_meal_plans boolean := false;
    v_account_had_data boolean := false;

    v_profile_result jsonb := null;
    v_meal_results jsonb := '[]'::jsonb;
    v_workout_results jsonb := '[]'::jsonb;
    v_meal_plan_results jsonb := '[]'::jsonb;
begin
    if p_user_id is null or p_source_guest_id is null then
        raise exception using
            errcode = '22023',
            message = 'GUEST_IMPORT_INVALID_ARGUMENT';
    end if;

    if p_confirm_existing_account is null then
        raise exception using
            errcode = '22023',
            message = 'GUEST_IMPORT_INVALID_CONFIRMATION';
    end if;

    if p_profile is not null
       and pg_catalog.jsonb_typeof(p_profile) is distinct from 'object' then
        raise exception using
            errcode = '22023',
            message = 'GUEST_IMPORT_INVALID_PROFILE';
    end if;

    if p_meals is null
       or pg_catalog.jsonb_typeof(p_meals) is distinct from 'array'
       or p_workouts is null
       or pg_catalog.jsonb_typeof(p_workouts) is distinct from 'array'
       or p_meal_plans is null
       or pg_catalog.jsonb_typeof(p_meal_plans) is distinct from 'array' then
        raise exception using
            errcode = '22023',
            message = 'GUEST_IMPORT_INVALID_COLLECTION';
    end if;

    if p_profile is not null then
        if p_profile ->> 'client_import_id' is distinct from 'profile'
           or pg_catalog.jsonb_typeof(p_profile -> 'data') is distinct from 'object'
           or coalesce(p_profile ->> 'payload_hash', '') !~ '^[0-9a-f]{64}$' then
            raise exception using
                errcode = '22023',
                message = 'GUEST_IMPORT_INVALID_PROFILE_ITEM';
        end if;

        v_requested := v_requested || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'entity_type', 'profile',
                'client_import_id', 'profile',
                'payload_hash', p_profile ->> 'payload_hash'
            )
        );
    end if;

    for v_item in
        select item.value
        from pg_catalog.jsonb_array_elements(p_meals) as item(value)
    loop
        if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
           or pg_catalog.jsonb_typeof(v_item -> 'data') is distinct from 'object'
           or pg_catalog.char_length(coalesce(v_item ->> 'client_import_id', '')) not between 1 and 128
           or coalesce(v_item ->> 'client_import_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
           or coalesce(v_item ->> 'payload_hash', '') !~ '^[0-9a-f]{64}$' then
            raise exception using
                errcode = '22023',
                message = 'GUEST_IMPORT_INVALID_MEAL_ITEM';
        end if;

        v_requested := v_requested || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'entity_type', 'meal',
                'client_import_id', v_item ->> 'client_import_id',
                'payload_hash', v_item ->> 'payload_hash'
            )
        );
    end loop;

    for v_item in
        select item.value
        from pg_catalog.jsonb_array_elements(p_workouts) as item(value)
    loop
        if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
           or pg_catalog.jsonb_typeof(v_item -> 'data') is distinct from 'object'
           or pg_catalog.char_length(coalesce(v_item ->> 'client_import_id', '')) not between 1 and 128
           or coalesce(v_item ->> 'client_import_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
           or coalesce(v_item ->> 'payload_hash', '') !~ '^[0-9a-f]{64}$' then
            raise exception using
                errcode = '22023',
                message = 'GUEST_IMPORT_INVALID_WORKOUT_ITEM';
        end if;

        v_requested := v_requested || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'entity_type', 'workout',
                'client_import_id', v_item ->> 'client_import_id',
                'payload_hash', v_item ->> 'payload_hash'
            )
        );
    end loop;

    for v_item in
        select item.value
        from pg_catalog.jsonb_array_elements(p_meal_plans) as item(value)
    loop
        if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
           or pg_catalog.jsonb_typeof(v_item -> 'data') is distinct from 'object'
           or pg_catalog.char_length(coalesce(v_item ->> 'client_import_id', '')) not between 1 and 128
           or coalesce(v_item ->> 'client_import_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
           or coalesce(v_item ->> 'payload_hash', '') !~ '^[0-9a-f]{64}$' then
            raise exception using
                errcode = '22023',
                message = 'GUEST_IMPORT_INVALID_MEAL_PLAN_ITEM';
        end if;

        v_requested := v_requested || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'entity_type', 'meal_plan',
                'client_import_id', v_item ->> 'client_import_id',
                'payload_hash', v_item ->> 'payload_hash'
            )
        );
    end loop;

    if pg_catalog.jsonb_array_length(v_requested) = 0 then
        raise exception using
            errcode = '22023',
            message = 'GUEST_IMPORT_EMPTY_BATCH';
    end if;

    with requested as (
        select
            item.value ->> 'entity_type' as entity_type,
            item.value ->> 'client_import_id' as client_import_id
        from pg_catalog.jsonb_array_elements(v_requested) as item(value)
    )
    select requested.entity_type, requested.client_import_id
    into v_entity_type, v_client_import_id
    from requested
    group by requested.entity_type, requested.client_import_id
    having pg_catalog.count(*) > 1
    limit 1;

    if found then
        raise exception using
            errcode = '22023',
            message = 'GUEST_IMPORT_DUPLICATE_ITEM';
    end if;

    -- Serialize all guest imports for the authenticated account, even when two
    -- devices use different source_guest_id values.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest-import:' || p_user_id::text, 0)
    );

    -- A changed payload under an existing ledger key is always a collision.
    -- This check happens before any domain or ledger write.
    with requested as (
        select
            item.value ->> 'entity_type' as entity_type,
            item.value ->> 'client_import_id' as client_import_id,
            item.value ->> 'payload_hash' as payload_hash
        from pg_catalog.jsonb_array_elements(v_requested) as item(value)
    )
    select requested.entity_type, requested.client_import_id
    into v_entity_type, v_client_import_id
    from requested
    join public.guest_import_items as ledger
      on ledger.user_id = p_user_id
     and ledger.source_guest_id = p_source_guest_id
     and ledger.entity_type = requested.entity_type
     and ledger.client_import_id = requested.client_import_id
    where ledger.payload_hash <> requested.payload_hash
    limit 1;

    if found then
        raise exception using
            errcode = '23505',
            message = 'GUEST_IMPORT_COLLISION',
            detail = v_entity_type || ':' || v_client_import_id;
    end if;

    with requested as (
        select
            item.value ->> 'entity_type' as entity_type,
            item.value ->> 'client_import_id' as client_import_id
        from pg_catalog.jsonb_array_elements(v_requested) as item(value)
    )
    select pg_catalog.count(*)
    into v_new_item_count
    from requested
    left join public.guest_import_items as ledger
      on ledger.user_id = p_user_id
     and ledger.source_guest_id = p_source_guest_id
     and ledger.entity_type = requested.entity_type
     and ledger.client_import_id = requested.client_import_id
    where ledger.user_id is null;

    select exists (
        select 1 from public.profiles where user_id = p_user_id
    ) into v_existing_profile;
    select exists (
        select 1 from public.meals where user_id = p_user_id
    ) into v_existing_meals;
    select exists (
        select 1 from public.workouts where user_id = p_user_id
    ) into v_existing_workouts;
    select exists (
        select 1 from public.meal_plans where user_id = p_user_id
    ) into v_existing_meal_plans;

    v_account_had_data := v_existing_profile
        or v_existing_meals
        or v_existing_workouts
        or v_existing_meal_plans;

    -- A complete same-hash replay bypasses confirmation. This makes a retry
    -- safe when the first response was lost after its transaction committed.
    if v_account_had_data
       and not p_confirm_existing_account
       and v_new_item_count > 0 then
        return pg_catalog.jsonb_build_object(
            'status', 'confirmation_required',
            'existing_profile', v_existing_profile,
            'guest_meals', pg_catalog.jsonb_array_length(p_meals),
            'guest_workouts', pg_catalog.jsonb_array_length(p_workouts),
            'guest_meal_plans', pg_catalog.jsonb_array_length(p_meal_plans)
        );
    end if;

    if p_profile is not null then
        select ledger.target_id, ledger.outcome
        into v_target_id, v_ledger_outcome
        from public.guest_import_items as ledger
        where ledger.user_id = p_user_id
          and ledger.source_guest_id = p_source_guest_id
          and ledger.entity_type = 'profile'
          and ledger.client_import_id = 'profile';

        if found then
            v_profile_result := pg_catalog.jsonb_build_object(
                'outcome',
                case
                    when v_ledger_outcome = 'imported' then 'already_imported'
                    else 'skipped_existing'
                end
            );
        elsif v_account_had_data then
            insert into public.guest_import_items (
                user_id,
                source_guest_id,
                entity_type,
                client_import_id,
                payload_hash,
                target_id,
                outcome
            ) values (
                p_user_id,
                p_source_guest_id,
                'profile',
                'profile',
                p_profile ->> 'payload_hash',
                null,
                'skipped_existing'
            );

            v_profile_result := pg_catalog.jsonb_build_object(
                'outcome', 'skipped_existing'
            );
        else
            v_target_id := null;

            insert into public.profiles (
                user_id,
                name,
                age,
                sex,
                height_cm,
                current_weight_kg,
                target_weight_kg,
                activity_level,
                goal,
                daily_calorie_goal,
                protein_goal,
                carbs_goal,
                fat_goal,
                fiber_goal,
                bmi,
                bmi_category,
                updated_at
            ) values (
                p_user_id,
                p_profile #>> '{data,name}',
                (p_profile #>> '{data,age}')::integer,
                p_profile #>> '{data,sex}',
                (p_profile #>> '{data,height_cm}')::integer,
                (p_profile #>> '{data,current_weight_kg}')::double precision,
                (p_profile #>> '{data,target_weight_kg}')::double precision,
                p_profile #>> '{data,activity_level}',
                p_profile #>> '{data,goal}',
                (p_profile #>> '{data,daily_calorie_goal}')::integer,
                (p_profile #>> '{data,protein_goal}')::integer,
                (p_profile #>> '{data,carbs_goal}')::integer,
                (p_profile #>> '{data,fat_goal}')::integer,
                (p_profile #>> '{data,fiber_goal}')::integer,
                (p_profile #>> '{data,bmi}')::double precision,
                p_profile #>> '{data,bmi_category}',
                pg_catalog.now()
            )
            on conflict (user_id) do nothing
            returning id into v_target_id;

            if v_target_id is null then
                -- A normal profile save does not take the import advisory lock.
                -- If one raced the empty-account check, preserve it and require
                -- confirmation before this request writes anything.
                if not p_confirm_existing_account then
                    return pg_catalog.jsonb_build_object(
                        'status', 'confirmation_required',
                        'existing_profile', true,
                        'guest_meals', pg_catalog.jsonb_array_length(p_meals),
                        'guest_workouts', pg_catalog.jsonb_array_length(p_workouts),
                        'guest_meal_plans', pg_catalog.jsonb_array_length(p_meal_plans)
                    );
                end if;

                insert into public.guest_import_items (
                    user_id,
                    source_guest_id,
                    entity_type,
                    client_import_id,
                    payload_hash,
                    target_id,
                    outcome
                ) values (
                    p_user_id,
                    p_source_guest_id,
                    'profile',
                    'profile',
                    p_profile ->> 'payload_hash',
                    null,
                    'skipped_existing'
                );

                v_profile_result := pg_catalog.jsonb_build_object(
                    'outcome', 'skipped_existing'
                );
            else
                insert into public.guest_import_items (
                    user_id,
                    source_guest_id,
                    entity_type,
                    client_import_id,
                    payload_hash,
                    target_id,
                    outcome
                ) values (
                    p_user_id,
                    p_source_guest_id,
                    'profile',
                    'profile',
                    p_profile ->> 'payload_hash',
                    v_target_id,
                    'imported'
                );

                v_profile_result := pg_catalog.jsonb_build_object(
                    'outcome', 'imported'
                );
            end if;
        end if;
    end if;

    for v_item in
        select item.value
        from pg_catalog.jsonb_array_elements(p_meals) as item(value)
    loop
        select ledger.target_id, ledger.outcome
        into v_target_id, v_ledger_outcome
        from public.guest_import_items as ledger
        where ledger.user_id = p_user_id
          and ledger.source_guest_id = p_source_guest_id
          and ledger.entity_type = 'meal'
          and ledger.client_import_id = v_item ->> 'client_import_id';

        if found then
            v_meal_results := v_meal_results || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'client_import_id', v_item ->> 'client_import_id',
                    'outcome', 'already_imported',
                    'target_id', v_target_id
                )
            );
        else
            insert into public.meals (
                user_id,
                dish_name,
                foods,
                total_calories,
                total_protein,
                total_carbs,
                total_fat,
                total_fiber,
                meal_date,
                meal_type,
                notes
            ) values (
                p_user_id,
                v_item #>> '{data,dish_name}',
                v_item #> '{data,foods}',
                (v_item #>> '{data,total_calories}')::double precision,
                (v_item #>> '{data,total_protein}')::double precision,
                (v_item #>> '{data,total_carbs}')::double precision,
                (v_item #>> '{data,total_fat}')::double precision,
                (v_item #>> '{data,total_fiber}')::double precision,
                (v_item #>> '{data,meal_date}')::date,
                v_item #>> '{data,meal_type}',
                v_item #>> '{data,notes}'
            )
            returning id into v_target_id;

            insert into public.guest_import_items (
                user_id,
                source_guest_id,
                entity_type,
                client_import_id,
                payload_hash,
                target_id,
                outcome
            ) values (
                p_user_id,
                p_source_guest_id,
                'meal',
                v_item ->> 'client_import_id',
                v_item ->> 'payload_hash',
                v_target_id,
                'imported'
            );

            v_meal_results := v_meal_results || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'client_import_id', v_item ->> 'client_import_id',
                    'outcome', 'imported',
                    'target_id', v_target_id
                )
            );
        end if;
    end loop;

    for v_item in
        select item.value
        from pg_catalog.jsonb_array_elements(p_workouts) as item(value)
    loop
        select ledger.target_id, ledger.outcome
        into v_target_id, v_ledger_outcome
        from public.guest_import_items as ledger
        where ledger.user_id = p_user_id
          and ledger.source_guest_id = p_source_guest_id
          and ledger.entity_type = 'workout'
          and ledger.client_import_id = v_item ->> 'client_import_id';

        if found then
            v_workout_results := v_workout_results || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'client_import_id', v_item ->> 'client_import_id',
                    'outcome', 'already_imported',
                    'target_id', v_target_id
                )
            );
        else
            insert into public.workouts (
                user_id,
                exercise,
                sets,
                reps,
                weight_kg,
                duration_min,
                notes,
                log_date
            ) values (
                p_user_id,
                v_item #>> '{data,exercise}',
                (v_item #>> '{data,sets}')::integer,
                (v_item #>> '{data,reps}')::integer,
                (v_item #>> '{data,weight_kg}')::double precision,
                (v_item #>> '{data,duration_min}')::integer,
                v_item #>> '{data,notes}',
                (v_item #>> '{data,log_date}')::date
            )
            returning id into v_target_id;

            insert into public.guest_import_items (
                user_id,
                source_guest_id,
                entity_type,
                client_import_id,
                payload_hash,
                target_id,
                outcome
            ) values (
                p_user_id,
                p_source_guest_id,
                'workout',
                v_item ->> 'client_import_id',
                v_item ->> 'payload_hash',
                v_target_id,
                'imported'
            );

            v_workout_results := v_workout_results || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'client_import_id', v_item ->> 'client_import_id',
                    'outcome', 'imported',
                    'target_id', v_target_id
                )
            );
        end if;
    end loop;

    for v_item in
        select item.value
        from pg_catalog.jsonb_array_elements(p_meal_plans) as item(value)
    loop
        select ledger.target_id, ledger.outcome
        into v_target_id, v_ledger_outcome
        from public.guest_import_items as ledger
        where ledger.user_id = p_user_id
          and ledger.source_guest_id = p_source_guest_id
          and ledger.entity_type = 'meal_plan'
          and ledger.client_import_id = v_item ->> 'client_import_id';

        if found then
            v_meal_plan_results := v_meal_plan_results || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'client_import_id', v_item ->> 'client_import_id',
                    'outcome', 'already_imported',
                    'target_id', v_target_id
                )
            );
        else
            insert into public.meal_plans (
                user_id,
                title,
                summary,
                preset,
                days
            ) values (
                p_user_id,
                v_item #>> '{data,title}',
                v_item #>> '{data,summary}',
                v_item #>> '{data,preset}',
                v_item #> '{data,days}'
            )
            returning id into v_target_id;

            insert into public.guest_import_items (
                user_id,
                source_guest_id,
                entity_type,
                client_import_id,
                payload_hash,
                target_id,
                outcome
            ) values (
                p_user_id,
                p_source_guest_id,
                'meal_plan',
                v_item ->> 'client_import_id',
                v_item ->> 'payload_hash',
                v_target_id,
                'imported'
            );

            v_meal_plan_results := v_meal_plan_results || pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                    'client_import_id', v_item ->> 'client_import_id',
                    'outcome', 'imported',
                    'target_id', v_target_id
                )
            );
        end if;
    end loop;

    return pg_catalog.jsonb_build_object(
        'status', 'imported',
        'profile', v_profile_result,
        'meals', v_meal_results,
        'workouts', v_workout_results,
        'meal_plans', v_meal_plan_results
    );
end;
$$;

revoke all on function public.import_guest_data(
    uuid, uuid, boolean, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.import_guest_data(
    uuid, uuid, boolean, jsonb, jsonb, jsonb, jsonb
) to service_role;
