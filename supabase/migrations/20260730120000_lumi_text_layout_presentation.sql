-- Per-Lumi text layout presets. Catalog presentation is copied into
-- necklace_lumis at enqueue time so queued messages remain immutable snapshots.
alter table public.necklace_lumis
    add column if not exists text_size_key text not null default 'medium',
    add column if not exists text_alignment_key text not null default 'center',
    add column if not exists text_position_key text not null default 'center';

alter table public.messages
    add column if not exists text_size_key text not null default 'medium',
    add column if not exists text_alignment_key text not null default 'center',
    add column if not exists text_position_key text not null default 'center';

update public.necklace_lumis
set text_size_key = coalesce(text_size_key, 'medium'),
    text_alignment_key = coalesce(text_alignment_key, 'center'),
    text_position_key = coalesce(text_position_key, 'center')
where text_size_key is null
   or text_alignment_key is null
   or text_position_key is null;

update public.messages
set text_size_key = coalesce(text_size_key, 'medium'),
    text_alignment_key = coalesce(text_alignment_key, 'center'),
    text_position_key = coalesce(text_position_key, 'center')
where text_size_key is null
   or text_alignment_key is null
   or text_position_key is null;

alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_text_size_key_check,
    drop constraint if exists necklace_lumis_text_alignment_key_check,
    drop constraint if exists necklace_lumis_text_position_key_check,
    add constraint necklace_lumis_text_size_key_check
        check (text_size_key in ('small', 'medium', 'large')),
    add constraint necklace_lumis_text_alignment_key_check
        check (text_alignment_key in ('leading', 'center', 'trailing')),
    add constraint necklace_lumis_text_position_key_check
        check (text_position_key in ('top', 'center', 'bottom'));

alter table public.messages
    drop constraint if exists messages_text_size_key_check,
    drop constraint if exists messages_text_alignment_key_check,
    drop constraint if exists messages_text_position_key_check,
    add constraint messages_text_size_key_check
        check (text_size_key in ('small', 'medium', 'large')),
    add constraint messages_text_alignment_key_check
        check (text_alignment_key in ('leading', 'center', 'trailing')),
    add constraint messages_text_position_key_check
        check (text_position_key in ('top', 'center', 'bottom'));

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
        'font_key', coalesce(p_lumi.font_key, 'serif'),
        'text_size_key', coalesce(p_lumi.text_size_key, 'medium'),
        'text_alignment_key', coalesce(p_lumi.text_alignment_key, 'center'),
        'text_position_key', coalesce(p_lumi.text_position_key, 'center')
    );
$$;

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
            'font', coalesce(p_lumi.font_key, 'serif'),
            'textSize', coalesce(p_lumi.text_size_key, 'medium'),
            'textAlignment', coalesce(p_lumi.text_alignment_key, 'center'),
            'textPosition', coalesce(p_lumi.text_position_key, 'center')
        )
    );
$$;

revoke execute on function public.sender_lumi_json(
    public.necklace_lumis, text
) from public, anon, authenticated;
grant execute on function public.sender_lumi_json(
    public.necklace_lumis, text
) to service_role;

revoke execute on function public.queue_lumi_json(
    public.necklace_lumis, text
) from public, anon, authenticated;
grant execute on function public.queue_lumi_json(
    public.necklace_lumis, text
) to service_role;

-- Drop dependent callers before changing the enqueue signature.
drop function if exists public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
);
drop function if exists public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text
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
    p_font_key text default 'serif',
    p_text_size_key text default 'medium',
    p_text_alignment_key text default 'center',
    p_text_position_key text default 'center'
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
    ) or coalesce(p_text_size_key, 'medium') not in (
        'small', 'medium', 'large'
    ) or coalesce(p_text_alignment_key, 'center') not in (
        'leading', 'center', 'trailing'
    ) or coalesce(p_text_position_key, 'center') not in (
        'top', 'center', 'bottom'
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
        font_key,
        text_size_key,
        text_alignment_key,
        text_position_key
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
        coalesce(p_font_key, 'serif'),
        coalesce(p_text_size_key, 'medium'),
        coalesce(p_text_alignment_key, 'center'),
        coalesce(p_text_position_key, 'center')
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
        v_message.font_key,
        v_message.text_size_key,
        v_message.text_alignment_key,
        v_message.text_position_key
    );
end;
$$;

revoke execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text, text, text, text
) to service_role;

revoke execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) to service_role;

drop function if exists public.edit_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text
);

create function public.edit_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_lumi_id uuid,
    p_content text,
    p_background_key text default 'rose_glow',
    p_font_key text default 'serif',
    p_text_size_key text default 'medium',
    p_text_alignment_key text default 'center',
    p_text_position_key text default 'center'
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
    ) or coalesce(p_text_size_key, 'medium') not in (
        'small', 'medium', 'large'
    ) or coalesce(p_text_alignment_key, 'center') not in (
        'leading', 'center', 'trailing'
    ) or coalesce(p_text_position_key, 'center') not in (
        'top', 'center', 'bottom'
    ) then
        raise exception 'invalid presentation';
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
        font_key = coalesce(p_font_key, 'serif'),
        text_size_key = coalesce(p_text_size_key, 'medium'),
        text_alignment_key = coalesce(p_text_alignment_key, 'center'),
        text_position_key = coalesce(p_text_position_key, 'center')
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

revoke execute on function public.edit_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.edit_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;

-- Preserve the ordered queue resolver and stable reveal-session behavior, then
-- enrich its presentation from the immutable source row.
alter function public.resolve_next_necklace_lumi(text)
rename to resolve_next_necklace_lumi_layout_v1;

revoke execute on function public.resolve_next_necklace_lumi_layout_v1(text)
from public, anon, authenticated, service_role;

-- Earlier resolver implementations remain only as internal migration helpers;
-- prevent callers from bypassing the current presentation contract.
revoke execute on function public.resolve_next_necklace_lumi_presentation_v1(text)
from public, anon, authenticated, service_role;

create function public.resolve_next_necklace_lumi(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result jsonb;
    v_session public.lumi_reveal_sessions%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_message public.messages%rowtype;
    v_text_size text := 'medium';
    v_text_alignment text := 'center';
    v_text_position text := 'center';
begin
    v_result := public.resolve_next_necklace_lumi_layout_v1(p_token_hash);
    if v_result ->> 'status' <> 'ready' then
        return v_result;
    end if;

    select s.* into v_session
    from public.lumi_reveal_sessions s
    where s.id = (v_result ->> 'reveal_session_id')::uuid;

    if found and v_session.necklace_lumi_id is not null then
        select l.* into v_lumi
        from public.necklace_lumis l
        where l.id = v_session.necklace_lumi_id;
        if found then
            v_text_size := coalesce(v_lumi.text_size_key, 'medium');
            v_text_alignment :=
                coalesce(v_lumi.text_alignment_key, 'center');
            v_text_position := coalesce(v_lumi.text_position_key, 'center');
        end if;
    elsif found and v_session.reserve_message_id is not null then
        select m.* into v_message
        from public.messages m
        where m.id = v_session.reserve_message_id;
        if found then
            v_text_size := coalesce(v_message.text_size_key, 'medium');
            v_text_alignment :=
                coalesce(v_message.text_alignment_key, 'center');
            v_text_position := coalesce(v_message.text_position_key, 'center');
        end if;
    end if;

    v_result := jsonb_set(
        v_result,
        '{presentation,textSize}',
        to_jsonb(v_text_size),
        true
    );
    v_result := jsonb_set(
        v_result,
        '{presentation,textAlignment}',
        to_jsonb(v_text_alignment),
        true
    );
    return jsonb_set(
        v_result,
        '{presentation,textPosition}',
        to_jsonb(v_text_position),
        true
    );
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text)
to service_role;

comment on column public.necklace_lumis.text_size_key is
    'Immutable queued Lumi text-size preset snapshot.';
comment on column public.necklace_lumis.text_alignment_key is
    'Immutable queued Lumi horizontal-alignment preset snapshot.';
comment on column public.necklace_lumis.text_position_key is
    'Immutable queued Lumi vertical-position preset snapshot.';
