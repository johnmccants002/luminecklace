-- RPC implementation for Current -> Up Next -> Reserve.
-- This follows the 20260727140000_split_up_next_reserve.sql schema foundation and is
-- ordered after the existing 20260728 presentation migration.
--
-- source_message_id identifies the catalog item from which a queued Lumi was
-- snapshotted; it is not the queued Lumi's identity. Historical queues can
-- therefore contain distinct Lumis with the same source_message_id. New
-- duplicate Explore enqueues are prevented below while holding the necklace
-- row lock, which also serializes concurrent enqueue attempts.
drop index if exists public.necklace_lumis_active_source_message_idx;

create or replace function public.queue_lumi_json(
    p_lumi public.necklace_lumis,
    p_fallback_theme text
)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'id', p_lumi.id,
        'text', p_lumi.content,
        'queuePosition', p_lumi.queue_position,
        'presentation', jsonb_build_object(
            'theme', coalesce(p_lumi.theme_key, p_fallback_theme, 'heart'),
            'animation', coalesce(p_lumi.animation_key, 'breathe'),
            'sound', coalesce(p_lumi.sound_key, 'soft'),
            'revealPreset', 'wordRise',
            'background', coalesce(p_lumi.background_key, 'rose_glow'),
            'font', coalesce(p_lumi.font_key, 'serif')
        )
    );
$$;

create or replace function public.necklace_queue_snapshot(p_necklace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_current jsonb;
    v_up_next jsonb;
    v_reserve jsonb;
begin
    select n.* into v_necklace
    from public.necklaces n
    where n.id = p_necklace_id;

    if not found then
        return null;
    end if;

    select public.queue_lumi_json(l, v_necklace.theme_key)
    into v_current
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null
      and l.queue_section = 'current'
    order by l.queue_position, l.created_at, l.id
    limit 1;

    select coalesce(
        jsonb_agg(
            public.queue_lumi_json(l, v_necklace.theme_key)
            order by l.queue_position, l.created_at, l.id
        ),
        '[]'::jsonb
    )
    into v_up_next
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null
      and l.queue_section = 'up_next';

    select coalesce(
        jsonb_agg(
            public.queue_lumi_json(l, v_necklace.theme_key)
            order by l.queue_position, l.created_at, l.id
        ),
        '[]'::jsonb
    )
    into v_reserve
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null
      and l.queue_section = 'reserve';

    return jsonb_build_object(
        'revision', v_necklace.queue_revision,
        'current', v_current,
        'upNext', v_up_next,
        'reserve', v_reserve
    );
end;
$$;

revoke execute on function public.queue_lumi_json(public.necklace_lumis, text)
from public, anon, authenticated;
grant execute on function public.queue_lumi_json(public.necklace_lumis, text)
to service_role;

revoke execute on function public.necklace_queue_snapshot(uuid)
from public, anon, authenticated;
grant execute on function public.necklace_queue_snapshot(uuid) to service_role;

-- Destination-aware creation.
drop function if exists public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
);
drop function if exists public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, uuid, text, text, text, text, text
);

create function public.enqueue_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_content text,
    p_destination text,
    p_source_message_id uuid default null,
    p_theme_key text default null,
    p_animation_key text default null,
    p_sound_key text default null,
    p_background_key text default 'rose_glow',
    p_font_key text default 'serif'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_position integer;
begin
    if p_user_id is null or p_necklace_id is null then
        raise exception 'unauthorized';
    end if;
    if p_destination not in ('up_next', 'reserve') then
        raise exception 'invalid destination';
    end if;
    if p_content is null
       or length(trim(p_content)) = 0
       or length(trim(p_content)) > 500 then
        raise exception 'invalid content';
    end if;
    if coalesce(p_background_key, 'rose_glow') not in (
        'rose_glow', 'midnight', 'champagne', 'sunset', 'ocean', 'lavender'
    ) or coalesce(p_font_key, 'serif') not in (
        'serif', 'rounded', 'modern', 'typewriter'
    ) then
        raise exception 'invalid presentation';
    end if;

    select n.* into v_necklace
    from public.necklaces n
    where n.id = p_necklace_id
    for update;

    if not found then
        raise exception 'necklace not found';
    end if;
    if not exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = p_necklace_id
          and own.sender_user_id = p_user_id
    ) then
        raise exception 'forbidden';
    end if;
    if v_necklace.lifecycle_status not in ('active', 'pending_sender_setup') then
        raise exception 'necklace unavailable';
    end if;
    if p_source_message_id is not null and exists (
        select 1
        from public.necklace_lumis l
        where l.necklace_id = p_necklace_id
          and l.source_message_id = p_source_message_id
          and l.is_enabled = true
          and l.revealed_at is null
          and l.queue_section is not null
    ) then
        raise exception 'duplicate queue membership';
    end if;

    select coalesce(max(l.queue_position), 0) + 1
    into v_position
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.queue_section = p_destination
      and l.is_enabled = true
      and l.revealed_at is null;

    insert into public.necklace_lumis (
        necklace_id,
        author_user_id,
        source_message_id,
        content,
        queue_position,
        queue_section,
        is_enabled,
        theme_key,
        animation_key,
        sound_key,
        background_key,
        font_key
    )
    values (
        p_necklace_id,
        p_user_id,
        p_source_message_id,
        trim(p_content),
        v_position,
        p_destination,
        true,
        coalesce(nullif(trim(p_theme_key), ''), v_necklace.theme_key, 'heart'),
        coalesce(nullif(trim(p_animation_key), ''), 'breathe'),
        coalesce(nullif(trim(p_sound_key), ''), 'soft'),
        coalesce(p_background_key, 'rose_glow'),
        coalesce(p_font_key, 'serif')
    )
    returning * into v_lumi;

    update public.necklaces
    set queue_revision = queue_revision + 1
    where id = p_necklace_id;

    return jsonb_build_object(
        'status', 'ok',
        'lumi', public.queue_lumi_json(v_lumi, v_necklace.theme_key),
        'queue', public.necklace_queue_snapshot(p_necklace_id)
    );
end;
$$;

create function public.enqueue_library_message_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_message_id uuid,
    p_destination text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_message public.messages%rowtype;
begin
    select m.* into v_message
    from public.messages m
    where m.id = p_message_id
      and m.is_active = true
      and m.is_explore_published = true
    for share;

    if not found then
        raise exception 'library message not found';
    end if;

    return public.enqueue_necklace_lumi_for_sender(
        p_user_id,
        p_necklace_id,
        v_message.text,
        p_destination,
        v_message.id,
        v_message.theme_key,
        v_message.animation_key,
        v_message.sound_key,
        v_message.background_key,
        v_message.font_key
    );
end;
$$;

revoke execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text
) to service_role;

revoke execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) to service_role;

-- Optimistic, idempotent sender queue mutations.
create or replace function public.mutate_necklace_queue_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_expected_revision bigint,
    p_idempotency_key uuid,
    p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_saved jsonb;
    v_type text;
    v_section text;
    v_destination text;
    v_placement text;
    v_message_id uuid;
    v_current_ids uuid[];
    v_ordered_ids uuid[];
    v_destination_ids uuid[];
    v_offset integer;
    v_response jsonb;
begin
    if p_user_id is null
       or p_necklace_id is null
       or p_expected_revision is null
       or p_expected_revision < 0
       or p_idempotency_key is null
       or p_operation is null
       or jsonb_typeof(p_operation) <> 'object' then
        raise exception 'invalid mutation';
    end if;

    select n.* into v_necklace
    from public.necklaces n
    where n.id = p_necklace_id
    for update;

    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;
    if not exists (
        select 1 from public.necklace_ownerships own
        where own.necklace_id = p_necklace_id
          and own.sender_user_id = p_user_id
    ) then
        return jsonb_build_object('status', 'forbidden');
    end if;

    select m.response into v_saved
    from public.necklace_queue_mutations m
    where m.necklace_id = p_necklace_id
      and m.idempotency_key = p_idempotency_key;
    if found then
        return v_saved;
    end if;

    if v_necklace.queue_revision <> p_expected_revision then
        return jsonb_build_object(
            'status', 'stale',
            'queue', public.necklace_queue_snapshot(p_necklace_id)
        );
    end if;

    v_type := p_operation ->> 'type';
    v_section := p_operation ->> 'section';
    if v_section not in ('up_next', 'reserve') then
        raise exception 'invalid section';
    end if;

    select coalesce(
        array_agg(l.id order by l.queue_position, l.created_at, l.id),
        '{}'::uuid[]
    )
    into v_current_ids
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.queue_section = v_section
      and l.is_enabled = true
      and l.revealed_at is null;

    if v_type = 'reorder' then
        if jsonb_typeof(p_operation -> 'orderedMessageIds') <> 'array' then
            raise exception 'invalid orderedMessageIds';
        end if;
        begin
            select coalesce(
                array_agg(item.value::uuid order by item.ordinality),
                '{}'::uuid[]
            )
            into v_ordered_ids
            from jsonb_array_elements_text(
                p_operation -> 'orderedMessageIds'
            ) with ordinality as item(value, ordinality);
        exception
            when invalid_text_representation then
                raise exception 'invalid orderedMessageIds';
        end;

        if cardinality(v_ordered_ids) <> (
            select count(distinct id) from unnest(v_ordered_ids) ids(id)
        ) or (
            select coalesce(array_agg(id order by id), '{}'::uuid[])
            from unnest(v_ordered_ids) ids(id)
        ) <> (
            select coalesce(array_agg(id order by id), '{}'::uuid[])
            from unnest(v_current_ids) ids(id)
        ) then
            return jsonb_build_object(
                'status', 'conflict',
                'queue', public.necklace_queue_snapshot(p_necklace_id)
            );
        end if;

        select coalesce(max(queue_position), 0) + cardinality(v_current_ids) + 1
        into v_offset
        from public.necklace_lumis
        where necklace_id = p_necklace_id
          and queue_section = v_section
          and is_enabled = true
          and revealed_at is null;

        update public.necklace_lumis
        set queue_position = queue_position + v_offset
        where necklace_id = p_necklace_id
          and queue_section = v_section
          and is_enabled = true
          and revealed_at is null;

        update public.necklace_lumis l
        set queue_position = ordered.position::integer
        from unnest(v_ordered_ids) with ordinality ordered(id, position)
        where l.id = ordered.id;

    elsif v_type = 'move' then
        begin
            v_message_id := (p_operation ->> 'messageId')::uuid;
        exception
            when invalid_text_representation then
                raise exception 'invalid messageId';
        end;
        v_destination := p_operation ->> 'destination';
        v_placement := p_operation ->> 'placement';
        if v_destination not in ('up_next', 'reserve')
           or v_placement not in ('first', 'last') then
            raise exception 'invalid move';
        end if;
        if not v_message_id = any(v_current_ids) then
            return jsonb_build_object(
                'status', 'conflict',
                'queue', public.necklace_queue_snapshot(p_necklace_id)
            );
        end if;

        if v_destination = v_section then
            v_ordered_ids := array_remove(v_current_ids, v_message_id);
            v_ordered_ids := case
                when v_placement = 'first'
                    then array_prepend(v_message_id, v_ordered_ids)
                else array_append(v_ordered_ids, v_message_id)
            end;
        else
            select coalesce(
                array_agg(l.id order by l.queue_position, l.created_at, l.id),
                '{}'::uuid[]
            )
            into v_destination_ids
            from public.necklace_lumis l
            where l.necklace_id = p_necklace_id
              and l.queue_section = v_destination
              and l.is_enabled = true
              and l.revealed_at is null;
            v_ordered_ids := array_remove(v_current_ids, v_message_id);
            v_destination_ids := case
                when v_placement = 'first'
                    then array_prepend(v_message_id, v_destination_ids)
                else array_append(v_destination_ids, v_message_id)
            end;
        end if;

        select coalesce(max(queue_position), 0)
               + cardinality(v_current_ids)
               + coalesce(cardinality(v_destination_ids), 0) + 2
        into v_offset
        from public.necklace_lumis
        where necklace_id = p_necklace_id
          and queue_section in (v_section, v_destination)
          and is_enabled = true
          and revealed_at is null;

        update public.necklace_lumis
        set queue_position = queue_position + v_offset
        where necklace_id = p_necklace_id
          and queue_section in (v_section, v_destination)
          and is_enabled = true
          and revealed_at is null;

        if v_destination <> v_section then
            update public.necklace_lumis
            set queue_section = v_destination
            where id = v_message_id;
        end if;

        update public.necklace_lumis l
        set queue_position = ordered.position::integer
        from unnest(v_ordered_ids) with ordinality ordered(id, position)
        where l.id = ordered.id;

        if v_destination = v_section then
            null;
        else
            update public.necklace_lumis l
            set queue_position = ordered.position::integer
            from unnest(v_destination_ids)
                with ordinality ordered(id, position)
            where l.id = ordered.id;
        end if;

    elsif v_type = 'remove' then
        begin
            v_message_id := (p_operation ->> 'messageId')::uuid;
        exception
            when invalid_text_representation then
                raise exception 'invalid messageId';
        end;
        if not v_message_id = any(v_current_ids) then
            return jsonb_build_object(
                'status', 'conflict',
                'queue', public.necklace_queue_snapshot(p_necklace_id)
            );
        end if;
        v_ordered_ids := array_remove(v_current_ids, v_message_id);

        update public.necklace_lumis
        set is_enabled = false,
            queue_section = null
        where id = v_message_id;

        select coalesce(max(queue_position), 0) + cardinality(v_ordered_ids) + 1
        into v_offset
        from public.necklace_lumis
        where necklace_id = p_necklace_id
          and queue_section = v_section
          and is_enabled = true
          and revealed_at is null;

        update public.necklace_lumis
        set queue_position = queue_position + v_offset
        where necklace_id = p_necklace_id
          and queue_section = v_section
          and is_enabled = true
          and revealed_at is null;

        update public.necklace_lumis l
        set queue_position = ordered.position::integer
        from unnest(v_ordered_ids) with ordinality ordered(id, position)
        where l.id = ordered.id;
    else
        raise exception 'invalid operation';
    end if;

    update public.necklaces
    set queue_revision = queue_revision + 1
    where id = p_necklace_id;

    v_response := jsonb_build_object(
        'status', 'ok',
        'queue', public.necklace_queue_snapshot(p_necklace_id)
    );
    insert into public.necklace_queue_mutations (
        necklace_id,
        idempotency_key,
        sender_user_id,
        response
    )
    values (
        p_necklace_id,
        p_idempotency_key,
        p_user_id,
        v_response
    );
    return v_response;
end;
$$;

revoke execute on function public.mutate_necklace_queue_for_sender(
    uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.mutate_necklace_queue_for_sender(
    uuid, uuid, bigint, uuid, jsonb
) to service_role;

-- The revisionless reorder endpoint is superseded by queue/mutations. Keeping
-- the RPC as an explicit conflict prevents older clients from changing Current
-- or bypassing optimistic concurrency.
create or replace function public.reorder_necklace_lumis_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_lumi_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'status', 'conflict',
        'queue', public.necklace_queue_snapshot(p_necklace_id)
    );
$$;

-- Legacy edit/remove APIs remain available, but can only touch editable
-- sections and return a full, revisioned snapshot.
create or replace function public.edit_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_lumi_id uuid,
    p_content text,
    p_background_key text default 'rose_glow',
    p_font_key text default 'serif'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
begin
    if p_content is null
       or length(trim(p_content)) = 0
       or length(trim(p_content)) > 500 then
        raise exception 'invalid content';
    end if;

    select n.* into v_necklace
    from public.necklaces n
    where n.id = p_necklace_id
    for update;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if not exists (
        select 1 from public.necklace_ownerships own
        where own.necklace_id = p_necklace_id
          and own.sender_user_id = p_user_id
    ) then
        return jsonb_build_object('status', 'forbidden');
    end if;

    select l.* into v_lumi
    from public.necklace_lumis l
    where l.id = p_lumi_id
      and l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null
      and l.queue_section in ('up_next', 'reserve')
    for update;
    if not found then return jsonb_build_object('status', 'conflict'); end if;

    update public.necklace_lumis
    set content = trim(p_content),
        background_key = coalesce(p_background_key, 'rose_glow'),
        font_key = coalesce(p_font_key, 'serif')
    where id = p_lumi_id
    returning * into v_lumi;

    update public.necklaces
    set queue_revision = queue_revision + 1
    where id = p_necklace_id;

    return jsonb_build_object(
        'status', 'ok',
        'lumi', public.queue_lumi_json(v_lumi, v_necklace.theme_key),
        'queue', public.necklace_queue_snapshot(p_necklace_id)
    );
end;
$$;

create or replace function public.remove_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_lumi_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_section text;
    v_offset integer;
begin
    select n.* into v_necklace
    from public.necklaces n
    where n.id = p_necklace_id
    for update;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if not exists (
        select 1 from public.necklace_ownerships own
        where own.necklace_id = p_necklace_id
          and own.sender_user_id = p_user_id
    ) then
        return jsonb_build_object('status', 'forbidden');
    end if;

    select l.* into v_lumi
    from public.necklace_lumis l
    where l.id = p_lumi_id
      and l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null
      and l.queue_section in ('up_next', 'reserve')
    for update;
    if not found then return jsonb_build_object('status', 'conflict'); end if;
    v_section := v_lumi.queue_section;

    update public.necklace_lumis
    set is_enabled = false,
        queue_section = null
    where id = p_lumi_id;

    select coalesce(max(queue_position), 0) + count(*) + 1
    into v_offset
    from public.necklace_lumis
    where necklace_id = p_necklace_id
      and queue_section = v_section
      and is_enabled = true
      and revealed_at is null;

    update public.necklace_lumis
    set queue_position = queue_position + v_offset
    where necklace_id = p_necklace_id
      and queue_section = v_section
      and is_enabled = true
      and revealed_at is null;

    with ordered as (
        select id, row_number() over (
            order by queue_position, created_at, id
        )::integer as position
        from public.necklace_lumis
        where necklace_id = p_necklace_id
          and queue_section = v_section
          and is_enabled = true
          and revealed_at is null
    )
    update public.necklace_lumis l
    set queue_position = ordered.position
    from ordered
    where l.id = ordered.id;

    update public.necklaces
    set queue_revision = queue_revision + 1
    where id = p_necklace_id;

    return jsonb_build_object(
        'status', 'ok',
        'deleted_lumi_id', p_lumi_id,
        'queue', public.necklace_queue_snapshot(p_necklace_id)
    );
end;
$$;

-- Resolve is a stable read of Current. It never advances or consults either
-- editable Reserve or the legacy Reserve catalog.
create or replace function public.resolve_next_necklace_lumi(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_session public.lumi_reveal_sessions%rowtype;
begin
    if p_token_hash is null or length(trim(p_token_hash)) = 0 then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select n.* into v_necklace
    from public.necklaces n
    where n.tap_token_hash = trim(p_token_hash)
    for update;
    if not found or v_necklace.lifecycle_status <> 'active' then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select l.* into v_lumi
    from public.necklace_lumis l
    where l.necklace_id = v_necklace.id
      and l.queue_section = 'current'
      and l.is_enabled = true
      and l.revealed_at is null
    order by l.queue_position, l.created_at, l.id
    limit 1
    for update;
    if not found then
        return jsonb_build_object('status', 'empty');
    end if;
    if v_lumi.eligible_from is not null and v_lumi.eligible_from > now() then
        return jsonb_build_object('status', 'empty');
    end if;

    select s.* into v_session
    from public.lumi_reveal_sessions s
    where s.necklace_id = v_necklace.id
      and s.necklace_lumi_id = v_lumi.id
      and s.completed_at is null
      and s.expires_at > now()
    order by s.created_at desc, s.id
    limit 1
    for update;

    if not found then
        insert into public.lumi_reveal_sessions (
            necklace_id,
            necklace_lumi_id,
            created_at,
            expires_at
        )
        values (
            v_necklace.id,
            v_lumi.id,
            now(),
            now() + interval '12 minutes'
        )
        returning * into v_session;

        begin
            insert into public.tap_events (
                necklace_id,
                necklace_lumi_id,
                reveal_session_id,
                status,
                context
            )
            values (
                v_necklace.id,
                v_lumi.id,
                v_session.id,
                'tap_ready',
                jsonb_build_object('source', 'recipient_resolve')
            );
        exception
            when others then null;
        end;
    end if;

    return jsonb_build_object(
        'status', 'ready',
        'reveal_session_id', v_session.id,
        'necklace_display_name', v_necklace.name,
        'necklace_lumi_id', v_lumi.id,
        'lumi_text', v_lumi.content,
        'presentation', jsonb_build_object(
            'theme', coalesce(v_lumi.theme_key, v_necklace.theme_key, 'heart'),
            'animation', coalesce(v_lumi.animation_key, 'breathe'),
            'sound', coalesce(v_lumi.sound_key, 'soft'),
            'revealPreset', 'wordRise',
            'background', coalesce(v_lumi.background_key, 'rose_glow'),
            'font', coalesce(v_lumi.font_key, 'serif')
        )
    );
end;
$$;

create or replace function public.confirm_necklace_lumi_reveal(
    p_reveal_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.lumi_reveal_sessions%rowtype;
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_promoted public.necklace_lumis%rowtype;
    v_source text;
    v_revealed_at timestamptz;
    v_offset integer;
begin
    if p_reveal_session_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select s.* into v_session
    from public.lumi_reveal_sessions s
    where s.id = p_reveal_session_id
    for update;
    if not found then return jsonb_build_object('status', 'unavailable'); end if;

    if v_session.completed_at is not null
       and v_session.revealed_at is not null then
        return jsonb_build_object(
            'status', 'revealed',
            'revealed_at', v_session.revealed_at
        );
    end if;
    if v_session.expires_at <= now() then
        return jsonb_build_object('status', 'expired');
    end if;

    select n.* into v_necklace
    from public.necklaces n
    where n.id = v_session.necklace_id
    for update;
    if not found then return jsonb_build_object('status', 'unavailable'); end if;

    select l.* into v_lumi
    from public.necklace_lumis l
    where l.id = v_session.necklace_lumi_id
      and l.necklace_id = v_session.necklace_id
    for update;
    if not found then return jsonb_build_object('status', 'unavailable'); end if;

    if v_lumi.revealed_at is not null then
        v_revealed_at := v_lumi.revealed_at;
    elsif v_lumi.queue_section <> 'current' or v_lumi.is_enabled = false then
        return jsonb_build_object('status', 'unavailable');
    else
        v_revealed_at := now();
        update public.necklace_lumis
        set revealed_at = v_revealed_at,
            is_enabled = false,
            queue_section = null
        where id = v_lumi.id;

        select l.* into v_promoted
        from public.necklace_lumis l
        where l.necklace_id = v_necklace.id
          and l.queue_section = 'up_next'
          and l.is_enabled = true
          and l.revealed_at is null
        order by l.queue_position, l.created_at, l.id
        limit 1
        for update;

        if found then
            v_source := 'up_next';
        else
            select l.* into v_promoted
            from public.necklace_lumis l
            where l.necklace_id = v_necklace.id
              and l.queue_section = 'reserve'
              and l.is_enabled = true
              and l.revealed_at is null
            order by l.queue_position, l.created_at, l.id
            limit 1
            for update;
            if found then v_source := 'reserve'; end if;
        end if;

        if v_source is not null then
            update public.necklace_lumis
            set queue_section = 'current',
                queue_position = 1
            where id = v_promoted.id;

            select coalesce(max(queue_position), 0) + count(*) + 1
            into v_offset
            from public.necklace_lumis
            where necklace_id = v_necklace.id
              and queue_section = v_source
              and is_enabled = true
              and revealed_at is null;

            update public.necklace_lumis
            set queue_position = queue_position + v_offset
            where necklace_id = v_necklace.id
              and queue_section = v_source
              and is_enabled = true
              and revealed_at is null;

            with ordered as (
                select id, row_number() over (
                    order by queue_position, created_at, id
                )::integer as position
                from public.necklace_lumis
                where necklace_id = v_necklace.id
                  and queue_section = v_source
                  and is_enabled = true
                  and revealed_at is null
            )
            update public.necklace_lumis l
            set queue_position = ordered.position
            from ordered
            where l.id = ordered.id;
        end if;

        update public.necklaces
        set queue_revision = queue_revision + 1
        where id = v_necklace.id;
    end if;

    update public.lumi_reveal_sessions
    set completed_at = coalesce(completed_at, now()),
        revealed_at = coalesce(revealed_at, v_revealed_at)
    where id = v_session.id;

    begin
        insert into public.tap_events (
            necklace_id,
            necklace_lumi_id,
            reveal_session_id,
            status,
            context
        )
        values (
            v_session.necklace_id,
            v_lumi.id,
            v_session.id,
            'lumi_revealed',
            jsonb_build_object('source', 'recipient_reveal')
        );
    exception
        when unique_violation then null;
    end;

    return jsonb_build_object(
        'status', 'revealed',
        'revealed_at', v_revealed_at
    );
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text)
to service_role;

revoke execute on function public.confirm_necklace_lumi_reveal(uuid)
from public, anon, authenticated;
grant execute on function public.confirm_necklace_lumi_reveal(uuid)
to service_role;
