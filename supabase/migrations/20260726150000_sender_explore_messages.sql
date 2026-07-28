-- Sender Explore Messages library. Explore publication is intentionally
-- independent from automatic Reserve eligibility.
create extension if not exists pg_trgm;

alter table public.messages
    add column if not exists text text,
    add column if not exists is_active boolean not null default true,
    add column if not exists is_explore_published boolean not null default false,
    add column if not exists explore_sort_order integer,
    add column if not exists category text,
    add column if not exists theme_key text not null default 'heart',
    add column if not exists animation_key text not null default 'breathe',
    add column if not exists sound_key text not null default 'soft';

-- Global catalog rows do not belong to a necklace or customer author.
alter table public.messages
    alter column necklace_id drop not null,
    alter column author_user_id drop not null;

-- The catalog predates sender-authored messages in some environments. Keep the
-- legacy `text` and newer `content` representations synchronized for existing
-- catalog rows without changing queued Lumi snapshots.
update public.messages
set text = nullif(btrim(content), '')
where text is null
  and content is not null
  and length(btrim(content)) between 1 and 500;

update public.messages
set content = text
where (content is null or length(btrim(content)) = 0)
  and text is not null;

alter table public.messages
    drop constraint if exists messages_explore_publication_check;
alter table public.messages
    add constraint messages_explore_publication_check check (
        not is_explore_published
        or (
            is_active
            and text is not null
            and length(btrim(text)) between 1 and 500
            and category in (
                'affection',
                'comfort',
                'encouragement',
                'presence',
                'reassurance'
            )
            and explore_sort_order is not null
            and explore_sort_order >= 0
        )
    );

create index if not exists messages_explore_catalog_idx
    on public.messages (category, explore_sort_order, id)
    where is_active = true and is_explore_published = true;

create index if not exists messages_explore_text_search_idx
    on public.messages using gin (text gin_trgm_ops)
    where is_active = true and is_explore_published = true;

alter table public.necklace_lumis
    add column if not exists source_message_id uuid
        references public.messages (id) on delete set null;

create index if not exists necklace_lumis_source_message_usage_idx
    on public.necklace_lumis (
        necklace_id,
        source_message_id,
        revealed_at,
        created_at desc
    )
    where source_message_id is not null;

-- Preserve the existing RPC name and queue lock. Optional values are only
-- supplied by server-side services; browser roles cannot execute this function.
drop function if exists public.enqueue_necklace_lumi_for_sender(uuid, uuid, text);

create function public.enqueue_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_content text,
    p_source_message_id uuid default null,
    p_theme_key text default null,
    p_animation_key text default null,
    p_sound_key text default null
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
        source_message_id,
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
        p_source_message_id,
        trim(p_content),
        v_queue_position,
        true,
        coalesce(nullif(trim(p_theme_key), ''), v_necklace.theme_key, 'heart'),
        coalesce(nullif(trim(p_animation_key), ''), 'breathe'),
        coalesce(nullif(trim(p_sound_key), ''), 'soft')
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

revoke execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, uuid, text, text, text
) to service_role;

create or replace function public.enqueue_library_message_for_sender(
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
    select m.*
    into v_message
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
        v_message.sound_key
    );
end;
$$;

revoke execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) to service_role;

comment on column public.messages.is_explore_published is
    'Published to the authenticated sender Explore library; independent of Reserve.';
comment on column public.messages.explore_sort_order is
    'Stable sender-library display order within a category.';
comment on column public.necklace_lumis.source_message_id is
    'Optional library provenance only. Lumi content/presentation remain snapshots.';
