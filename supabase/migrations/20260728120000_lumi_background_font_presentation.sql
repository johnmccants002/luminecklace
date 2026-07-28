-- Per-Lumi background and font presets. Catalog values are copied into queued
-- necklace_lumis so later catalog edits cannot change an existing queue item.
alter table public.necklace_lumis
    add column if not exists background_key text not null default 'rose_glow',
    add column if not exists font_key text not null default 'serif';

alter table public.messages
    add column if not exists background_key text not null default 'rose_glow',
    add column if not exists font_key text not null default 'serif';

update public.necklace_lumis
set background_key = 'rose_glow'
where background_key is null;

update public.necklace_lumis
set font_key = 'serif'
where font_key is null;

update public.messages
set background_key = 'rose_glow'
where background_key is null;

update public.messages
set font_key = 'serif'
where font_key is null;

alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_background_key_check,
    drop constraint if exists necklace_lumis_font_key_check,
    add constraint necklace_lumis_background_key_check check (
        background_key in (
            'rose_glow', 'midnight', 'champagne', 'sunset', 'ocean', 'lavender'
        )
    ),
    add constraint necklace_lumis_font_key_check check (
        font_key in ('serif', 'rounded', 'modern', 'typewriter')
    );

alter table public.messages
    drop constraint if exists messages_background_key_check,
    drop constraint if exists messages_font_key_check,
    add constraint messages_background_key_check check (
        background_key in (
            'rose_glow', 'midnight', 'champagne', 'sunset', 'ocean', 'lavender'
        )
    ),
    add constraint messages_font_key_check check (
        font_key in ('serif', 'rounded', 'modern', 'typewriter')
    );

create or replace function public.sender_lumi_json(
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
        'content', p_lumi.content,
        'queue_position', p_lumi.queue_position,
        'theme_key', coalesce(p_lumi.theme_key, p_fallback_theme, 'heart'),
        'animation_key', coalesce(p_lumi.animation_key, 'breathe'),
        'sound_key', coalesce(p_lumi.sound_key, 'soft'),
        'background_key', coalesce(p_lumi.background_key, 'rose_glow'),
        'font_key', coalesce(p_lumi.font_key, 'serif')
    );
$$;

revoke execute on function public.sender_lumi_json(public.necklace_lumis, text)
from public, anon, authenticated;
grant execute on function public.sender_lumi_json(public.necklace_lumis, text)
to service_role;

-- Drop callers before replacing the enqueue signature so Postgres does not
-- retain an ambiguous overload or block the dependency change.
drop function if exists public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
);
drop function if exists public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, uuid, text, text, text
);
drop function if exists public.enqueue_necklace_lumi_for_sender(uuid, uuid, text);

create function public.enqueue_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_content text,
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
    v_queue_position integer;
begin
    if p_user_id is null or p_necklace_id is null then
        raise exception 'unauthorized';
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

    select coalesce(max(l.queue_position), 0) + 1
    into v_queue_position
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    insert into public.necklace_lumis (
        necklace_id,
        author_user_id,
        source_message_id,
        content,
        queue_position,
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
        v_queue_position,
        true,
        coalesce(nullif(trim(p_theme_key), ''), v_necklace.theme_key, 'heart'),
        coalesce(nullif(trim(p_animation_key), ''), 'breathe'),
        coalesce(nullif(trim(p_sound_key), ''), 'soft'),
        coalesce(p_background_key, 'rose_glow'),
        coalesce(p_font_key, 'serif')
    )
    returning * into v_lumi;

    return public.sender_lumi_json(v_lumi, v_necklace.theme_key);
end;
$$;

revoke execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, uuid, text, text, text, text, text
) to service_role;

create function public.enqueue_library_message_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_message_id uuid,
    p_personalized_content text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_message public.messages%rowtype;
    v_content text;
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

    v_content := case
        when p_personalized_content is null then v_message.text
        else trim(p_personalized_content)
    end;

    return public.enqueue_necklace_lumi_for_sender(
        p_user_id,
        p_necklace_id,
        v_content,
        v_message.id,
        v_message.theme_key,
        v_message.animation_key,
        v_message.sound_key,
        v_message.background_key,
        v_message.font_key
    );
end;
$$;

revoke execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) to service_role;

drop function if exists public.edit_necklace_lumi_for_sender(
    uuid, uuid, uuid, text
);

create function public.edit_necklace_lumi_for_sender(
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
    set content = trim(p_content),
        background_key = coalesce(p_background_key, 'rose_glow'),
        font_key = coalesce(p_font_key, 'serif')
    where id = p_lumi_id
    returning * into v_lumi;

    return jsonb_build_object(
        'status', 'ok',
        'lumi', public.sender_lumi_json(v_lumi, v_necklace.theme_key)
    );
end;
$$;

revoke execute on function public.edit_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.edit_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text
) to service_role;

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

    select coalesce(array_agg(ids.id order by ids.id), '{}'::uuid[]),
           count(distinct ids.id)
    into v_submitted_ids, v_unique_count
    from unnest(p_lumi_ids) as ids(id);

    if v_unique_count <> cardinality(p_lumi_ids)
       or v_submitted_ids <> v_current_ids then
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
                order by l.queue_position, l.created_at, l.id
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

    select coalesce(jsonb_agg(
        public.sender_lumi_json(l, v_necklace.theme_key)
        order by l.queue_position, l.created_at, l.id
    ), '[]'::jsonb)
    into v_queue
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    return jsonb_build_object('status', 'ok', 'queue', v_queue);
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

    update public.necklace_lumis set is_enabled = false where id = p_lumi_id;

    select count(*), coalesce(max(l.queue_position), 0) + count(*) + 1
    into v_remaining_count, v_offset
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id
      and l.is_enabled = true
      and l.revealed_at is null;

    if v_remaining_count > 0 then
        with current_order as (
            select l.id, row_number() over (
                order by l.queue_position, l.created_at, l.id
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
                order by l.queue_position, l.created_at, l.id
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

    select coalesce(jsonb_agg(
        public.sender_lumi_json(l, v_necklace.theme_key)
        order by l.queue_position, l.created_at, l.id
    ), '[]'::jsonb)
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

revoke execute on function public.reorder_necklace_lumis_for_sender(
    uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.reorder_necklace_lumis_for_sender(
    uuid, uuid, uuid[]
) to service_role;

revoke execute on function public.remove_necklace_lumi_for_sender(
    uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.remove_necklace_lumi_for_sender(
    uuid, uuid, uuid
) to service_role;

-- Keep the mature resolve/Reserve implementation intact and wrap it with the
-- expanded presentation snapshot. The reveal session identifies whether the
-- ready item is personal or Reserve without changing precedence or idempotency.
alter function public.resolve_next_necklace_lumi(text)
rename to resolve_next_necklace_lumi_presentation_v1;

revoke execute on function public.resolve_next_necklace_lumi_presentation_v1(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi_presentation_v1(text)
to service_role;

create function public.resolve_next_necklace_lumi(
    p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result jsonb;
    v_session public.lumi_reveal_sessions%rowtype;
    v_personal public.necklace_lumis%rowtype;
    v_reserve public.messages%rowtype;
    v_background text := 'rose_glow';
    v_font text := 'serif';
begin
    v_result := public.resolve_next_necklace_lumi_presentation_v1(p_token_hash);
    if v_result->>'status' <> 'ready' then
        return v_result;
    end if;

    select s.* into v_session
    from public.lumi_reveal_sessions s
    where s.id = (v_result->>'reveal_session_id')::uuid;

    if found and v_session.source_type = 'personal' then
        select l.* into v_personal
        from public.necklace_lumis l
        where l.id = v_session.necklace_lumi_id;
        if found then
            v_background := coalesce(v_personal.background_key, 'rose_glow');
            v_font := coalesce(v_personal.font_key, 'serif');
        end if;
    elsif found and v_session.source_type = 'reserve' then
        select m.* into v_reserve
        from public.messages m
        where m.id = v_session.reserve_message_id;
        if found then
            v_background := coalesce(v_reserve.background_key, 'rose_glow');
            v_font := coalesce(v_reserve.font_key, 'serif');
        end if;
    end if;

    return jsonb_set(
        jsonb_set(
            jsonb_set(
                v_result,
                '{presentation,revealPreset}',
                to_jsonb('wordRise'::text),
                true
            ),
            '{presentation,background}',
            to_jsonb(v_background),
            true
        ),
        '{presentation,font}',
        to_jsonb(v_font),
        true
    );
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text)
to service_role;

comment on column public.necklace_lumis.background_key is
    'Validated per-queued-Lumi background preset snapshot.';
comment on column public.necklace_lumis.font_key is
    'Validated per-queued-Lumi font preset snapshot.';
comment on column public.messages.background_key is
    'Validated catalog default copied when an Explore message is queued.';
comment on column public.messages.font_key is
    'Validated catalog default copied when an Explore message is queued.';
