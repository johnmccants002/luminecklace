-- Authenticated sender queue editing and reveal-history reads.
-- Only enabled, unrevealed rows participate in active queue-position uniqueness.
drop index if exists public.necklace_lumis_necklace_queue_position_idx;
create unique index necklace_lumis_necklace_queue_position_idx
    on public.necklace_lumis (necklace_id, queue_position)
    where is_enabled = true and revealed_at is null;

create or replace function public.enqueue_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_queue_position integer;
begin
    if p_user_id is null or p_necklace_id is null then
        raise exception 'unauthorized';
    end if;

    if p_content is null or length(trim(p_content)) = 0 or length(trim(p_content)) > 500 then
        raise exception 'invalid content';
    end if;

    select n.*
    into v_necklace
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

    select coalesce(max(l.queue_position), 0) + 1
    into v_queue_position
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    insert into public.necklace_lumis (
        necklace_id,
        author_user_id,
        content,
        queue_position,
        is_enabled,
        theme_key,
        animation_key,
        sound_key
    )
    values (
        p_necklace_id,
        p_user_id,
        trim(p_content),
        v_queue_position,
        true,
        coalesce(v_necklace.theme_key, 'heart'),
        'breathe',
        'soft'
    )
    returning * into v_lumi;

    return jsonb_build_object(
        'id', v_lumi.id,
        'content', v_lumi.content,
        'queue_position', v_lumi.queue_position,
        'theme_key', coalesce(v_lumi.theme_key, v_necklace.theme_key, 'heart'),
        'animation_key', coalesce(v_lumi.animation_key, 'breathe'),
        'sound_key', coalesce(v_lumi.sound_key, 'soft')
    );
end;
$$;

create or replace function public.reorder_necklace_lumis_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_lumi_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_current_ids uuid[];
    v_submitted_ids uuid[];
    v_unique_count integer;
    v_offset integer;
    v_queue jsonb;
begin
    if p_user_id is null or p_necklace_id is null or p_lumi_ids is null then
        return jsonb_build_object('status', 'stale');
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

    select coalesce(array_agg(l.id order by l.id), '{}'::uuid[])
    into v_current_ids
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    select coalesce(array_agg(ids.id order by ids.id), '{}'::uuid[]), count(distinct ids.id)
    into v_submitted_ids, v_unique_count
    from unnest(p_lumi_ids) as ids(id);

    if v_unique_count <> cardinality(p_lumi_ids) or v_submitted_ids <> v_current_ids then
        return jsonb_build_object('status', 'stale');
    end if;

    if cardinality(p_lumi_ids) > 0 then
        select coalesce(max(l.queue_position), 0) + cardinality(p_lumi_ids) + 1
        into v_offset
        from public.necklace_lumis l
        where l.necklace_id = p_necklace_id
          and l.is_enabled = true
          and l.revealed_at is null;

        with current_order as (
            select l.id, row_number() over (
                order by l.queue_position asc, l.created_at asc, l.id asc
            )::integer as position
            from public.necklace_lumis l
            where l.necklace_id = p_necklace_id
              and l.is_enabled = true
              and l.revealed_at is null
        )
        update public.necklace_lumis l
        set queue_position = v_offset + current_order.position
        from current_order
        where l.id = current_order.id;

        update public.necklace_lumis l
        set queue_position = submitted.position::integer
        from unnest(p_lumi_ids) with ordinality as submitted(id, position)
        where l.id = submitted.id
          and l.necklace_id = p_necklace_id
          and l.is_enabled = true
          and l.revealed_at is null;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'content', l.content,
        'queue_position', l.queue_position,
        'theme_key', coalesce(l.theme_key, v_necklace.theme_key, 'heart'),
        'animation_key', coalesce(l.animation_key, 'breathe'),
        'sound_key', coalesce(l.sound_key, 'soft')
    ) order by l.queue_position asc, l.created_at asc, l.id asc), '[]'::jsonb)
    into v_queue
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    return jsonb_build_object('status', 'ok', 'queue', v_queue);
end;
$$;

create or replace function public.edit_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_lumi_id uuid,
    p_content text
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
    if p_content is null or length(trim(p_content)) = 0 or length(trim(p_content)) > 500 then
        raise exception 'invalid content';
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

    select l.* into v_lumi
    from public.necklace_lumis l
    where l.id = p_lumi_id and l.necklace_id = p_necklace_id;

    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_lumi.is_enabled = false or v_lumi.revealed_at is not null then
        return jsonb_build_object('status', 'conflict');
    end if;

    update public.necklace_lumis
    set content = trim(p_content)
    where id = p_lumi_id
    returning * into v_lumi;

    return jsonb_build_object(
        'status', 'ok',
        'lumi', jsonb_build_object(
            'id', v_lumi.id,
            'content', v_lumi.content,
            'queue_position', v_lumi.queue_position,
            'theme_key', coalesce(v_lumi.theme_key, v_necklace.theme_key, 'heart'),
            'animation_key', coalesce(v_lumi.animation_key, 'breathe'),
            'sound_key', coalesce(v_lumi.sound_key, 'soft')
        )
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
    v_remaining_count integer;
    v_offset integer;
    v_queue jsonb;
begin
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

    select l.* into v_lumi
    from public.necklace_lumis l
    where l.id = p_lumi_id and l.necklace_id = p_necklace_id;

    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_lumi.is_enabled = false or v_lumi.revealed_at is not null then
        return jsonb_build_object('status', 'conflict');
    end if;

    update public.necklace_lumis
    set is_enabled = false
    where id = p_lumi_id;

    select count(*), coalesce(max(l.queue_position), 0) + count(*) + 1
    into v_remaining_count, v_offset
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    if v_remaining_count > 0 then
        with current_order as (
            select l.id, row_number() over (
                order by l.queue_position asc, l.created_at asc, l.id asc
            )::integer as position
            from public.necklace_lumis l
            where l.necklace_id = p_necklace_id
              and l.is_enabled = true
              and l.revealed_at is null
        )
        update public.necklace_lumis l
        set queue_position = v_offset + current_order.position
        from current_order
        where l.id = current_order.id;

        with compacted as (
            select l.id, row_number() over (
                order by l.queue_position asc, l.created_at asc, l.id asc
            )::integer as position
            from public.necklace_lumis l
            where l.necklace_id = p_necklace_id
              and l.is_enabled = true
              and l.revealed_at is null
        )
        update public.necklace_lumis l
        set queue_position = compacted.position
        from compacted
        where l.id = compacted.id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'content', l.content,
        'queue_position', l.queue_position,
        'theme_key', coalesce(l.theme_key, v_necklace.theme_key, 'heart'),
        'animation_key', coalesce(l.animation_key, 'breathe'),
        'sound_key', coalesce(l.sound_key, 'soft')
    ) order by l.queue_position asc, l.created_at asc, l.id asc), '[]'::jsonb)
    into v_queue
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    return jsonb_build_object(
        'status', 'ok',
        'deleted_lumi_id', p_lumi_id,
        'queue', v_queue
    );
end;
$$;

-- Reveal confirmation also takes the necklace lock before changing revealed_at,
-- matching resolve and all sender queue mutations.
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
    v_lumi public.necklace_lumis%rowtype;
    v_revealed_at timestamptz;
begin
    if p_reveal_session_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select * into v_session
    from public.lumi_reveal_sessions s
    where s.id = p_reveal_session_id
    for update;

    if not found then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_session.expires_at <= now() then
        return jsonb_build_object('status', 'expired');
    end if;

    perform 1
    from public.necklaces n
    where n.id = v_session.necklace_id
    for update;

    select * into v_lumi
    from public.necklace_lumis l
    where l.id = v_session.necklace_lumi_id
    for update;

    if not found then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_lumi.revealed_at is null then
        v_revealed_at := now();

        update public.necklace_lumis
        set revealed_at = v_revealed_at
        where id = v_lumi.id and revealed_at is null;

        begin
            insert into public.tap_events (
                necklace_id, necklace_lumi_id, reveal_session_id, status, context
            ) values (
                v_session.necklace_id, v_lumi.id, v_session.id, 'lumi_revealed',
                jsonb_build_object('source', 'recipient_reveal')
            );
        exception when unique_violation then
            null;
        end;
    else
        v_revealed_at := v_lumi.revealed_at;
    end if;

    update public.lumi_reveal_sessions
    set completed_at = coalesce(completed_at, now()),
        revealed_at = coalesce(revealed_at, v_revealed_at)
    where id = v_session.id;

    return jsonb_build_object('status', 'revealed', 'revealed_at', v_revealed_at);
end;
$$;

revoke execute on function public.enqueue_necklace_lumi_for_sender(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(uuid, uuid, text)
to service_role;

revoke execute on function public.reorder_necklace_lumis_for_sender(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.reorder_necklace_lumis_for_sender(uuid, uuid, uuid[])
to service_role;

revoke execute on function public.edit_necklace_lumi_for_sender(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.edit_necklace_lumi_for_sender(uuid, uuid, uuid, text)
to service_role;

revoke execute on function public.remove_necklace_lumi_for_sender(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.remove_necklace_lumi_for_sender(uuid, uuid, uuid)
to service_role;

revoke execute on function public.confirm_necklace_lumi_reveal(uuid)
from public, anon, authenticated;
grant execute on function public.confirm_necklace_lumi_reveal(uuid)
to service_role;
