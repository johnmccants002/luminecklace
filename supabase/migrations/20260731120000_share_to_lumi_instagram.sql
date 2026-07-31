-- Optional immutable Instagram attachments on normal queued Lumis.
-- Complete the fixed presentation-contract cleanup from the preceding
-- migration: its background values changed, but its legacy constraints and
-- defaults remained in place.
alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_background_key_check;
alter table public.messages
    drop constraint if exists messages_background_key_check;

update public.necklace_lumis
set background_key = case
    when theme_key in ('heart', 'champagne', 'rose', 'midnight')
        then theme_key
    else 'heart'
end
where background_key not in ('heart', 'champagne', 'rose', 'midnight');

update public.messages
set background_key = case
    when theme_key in ('heart', 'champagne', 'rose', 'midnight')
        then theme_key
    else 'heart'
end
where background_key not in ('heart', 'champagne', 'rose', 'midnight');

alter table public.necklace_lumis
    alter column background_key set default 'heart',
    add constraint necklace_lumis_background_key_check check (
        background_key in ('heart', 'champagne', 'rose', 'midnight')
    );
alter table public.messages
    alter column background_key set default 'heart',
    add constraint messages_background_key_check check (
        background_key in ('heart', 'champagne', 'rose', 'midnight')
    );

alter table public.necklace_lumis
    add column if not exists client_request_id uuid,
    add column if not exists client_request_fingerprint text,
    add column if not exists external_url text,
    add column if not exists external_provider text,
    add column if not exists external_content_kind text;

alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_external_link_check,
    add constraint necklace_lumis_external_link_check check (
        (
            client_request_id is null
            and client_request_fingerprint is null
            and external_url is null
            and external_provider is null
            and external_content_kind is null
        )
        or
        (
            client_request_id is not null
            and client_request_fingerprint ~ '^[0-9a-f]{64}$'
            and external_url is not null
            and length(external_url) <= 2048
            and external_url like 'https://instagram.com/%'
            and external_provider = 'instagram'
            and external_content_kind in (
                'post', 'reel', 'story', 'profile', 'instagram_link'
            )
        )
    );

create unique index if not exists necklace_lumis_sender_client_request_idx
    on public.necklace_lumis (author_user_id, client_request_id)
    where client_request_id is not null;

create or replace function public.prevent_necklace_lumi_link_snapshot_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if old.client_request_id is distinct from new.client_request_id
       or old.client_request_fingerprint is distinct from new.client_request_fingerprint
       or old.external_url is distinct from new.external_url
       or old.external_provider is distinct from new.external_provider
       or old.external_content_kind is distinct from new.external_content_kind then
        raise exception 'external link snapshot is immutable';
    end if;
    return new;
end;
$$;

drop trigger if exists necklace_lumis_immutable_link_snapshot
on public.necklace_lumis;
create trigger necklace_lumis_immutable_link_snapshot
before update of
    client_request_id,
    client_request_fingerprint,
    external_url,
    external_provider,
    external_content_kind
on public.necklace_lumis
for each row execute function public.prevent_necklace_lumi_link_snapshot_update();

-- Sender queue JSON gains an attachment only for link-backed rows. Text-only
-- objects retain their exact historical key set.
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
            'theme', case
                when coalesce(p_lumi.theme_key, p_fallback_theme) in
                    ('heart', 'champagne', 'rose', 'midnight')
                    then coalesce(p_lumi.theme_key, p_fallback_theme)
                else 'heart'
            end,
            'animation', coalesce(p_lumi.animation_key, 'breathe'),
            'sound', coalesce(p_lumi.sound_key, 'soft'),
            'revealPreset', 'wordRise',
            'background', case
                when coalesce(p_lumi.theme_key, p_fallback_theme) in
                    ('heart', 'champagne', 'rose', 'midnight')
                    then coalesce(p_lumi.theme_key, p_fallback_theme)
                else 'heart'
            end,
            'font', case
                when p_lumi.font_key in ('serif', 'rounded')
                    then p_lumi.font_key
                else 'serif'
            end,
            'textSize', coalesce(p_lumi.text_size_key, 'medium'),
            'textAlignment', coalesce(p_lumi.text_alignment_key, 'center'),
            'textPosition', coalesce(p_lumi.text_position_key, 'center')
        )
    ) || case
        when p_lumi.external_url is null then '{}'::jsonb
        else jsonb_build_object(
            'attachment', jsonb_build_object(
                'type', 'link',
                'provider', p_lumi.external_provider,
                'contentKind', p_lumi.external_content_kind,
                'url', p_lumi.external_url,
                'host', 'instagram.com',
                'ctaLabel', 'View on Instagram',
                'openMode', 'external'
            )
        )
    end;
$$;

-- Recreate the existing enqueue RPC with optional link snapshot parameters.
-- Existing named callers remain source-compatible because all additions have
-- defaults. The library wrapper is recreated because PostgreSQL tracks its
-- dependency on the prior function signature.
drop function if exists public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
);
drop function if exists public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text, text, text, text
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
    p_background_key text default 'heart',
    p_font_key text default 'serif',
    p_text_size_key text default 'medium',
    p_text_alignment_key text default 'center',
    p_text_position_key text default 'center',
    p_client_request_id uuid default null,
    p_external_url text default null,
    p_external_provider text default null,
    p_external_content_kind text default null
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
    v_fingerprint text;
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
    if coalesce(p_background_key, 'heart') not in (
        'heart', 'champagne', 'rose', 'midnight'
    ) or coalesce(p_font_key, 'serif') not in (
        'serif', 'rounded'
    ) or coalesce(p_text_size_key, 'medium') not in (
        'small', 'medium', 'large'
    ) or coalesce(p_text_alignment_key, 'center') not in (
        'leading', 'center', 'trailing'
    ) or coalesce(p_text_position_key, 'center') not in (
        'top', 'center', 'bottom'
    ) then
        raise exception 'invalid presentation';
    end if;
    if (p_client_request_id is null) <> (p_external_url is null)
       or (p_external_url is null) <> (p_external_provider is null)
       or (p_external_provider is null) <> (p_external_content_kind is null)
       or (
           p_external_url is not null
           and (
               length(p_external_url) > 2048
               or p_external_url not like 'https://instagram.com/%'
               or p_external_provider <> 'instagram'
               or p_external_content_kind not in (
                   'post', 'reel', 'story', 'profile', 'instagram_link'
               )
           )
       ) then
        raise exception 'invalid external link';
    end if;

    if p_client_request_id is not null then
        perform pg_advisory_xact_lock(
            hashtextextended(
                p_user_id::text || ':' || p_client_request_id::text,
                0
            )
        );
        v_fingerprint := encode(
            digest(
                jsonb_build_object(
                    'necklaceId', p_necklace_id,
                    'url', p_external_url,
                    'text', trim(p_content),
                    'destination', p_destination,
                    'background', coalesce(p_background_key, 'heart'),
                    'font', coalesce(p_font_key, 'serif'),
                    'textSize', coalesce(p_text_size_key, 'medium'),
                    'textAlignment',
                        coalesce(p_text_alignment_key, 'center'),
                    'textPosition', coalesce(p_text_position_key, 'center')
                )::text,
                'sha256'
            ),
            'hex'
        );
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
    if v_necklace.lifecycle_status not in ('active', 'pending_sender_setup') then
        return jsonb_build_object('status', 'conflict');
    end if;

    if p_client_request_id is not null then
        select l.* into v_lumi
        from public.necklace_lumis l
        where l.author_user_id = p_user_id
          and l.client_request_id = p_client_request_id;
        if found then
            if v_lumi.client_request_fingerprint <> v_fingerprint then
                return jsonb_build_object(
                    'status', 'idempotency_conflict'
                );
            end if;
            return jsonb_build_object(
                'status', 'ok',
                'lumi', public.queue_lumi_json(
                    v_lumi,
                    v_necklace.theme_key
                ),
                'queue', public.necklace_queue_snapshot(p_necklace_id),
                'idempotent_replay', true
            );
        end if;
    end if;

    if p_source_message_id is not null and exists (
        select 1 from public.necklace_lumis l
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
        necklace_id, author_user_id, source_message_id, content,
        queue_position, queue_section, is_enabled, theme_key,
        animation_key, sound_key, background_key, font_key,
        text_size_key, text_alignment_key, text_position_key,
        client_request_id, client_request_fingerprint, external_url,
        external_provider, external_content_kind
    )
    values (
        p_necklace_id, p_user_id, p_source_message_id, trim(p_content),
        v_position, p_destination, true,
        coalesce(p_background_key, 'heart'),
        coalesce(nullif(trim(p_animation_key), ''), 'breathe'),
        coalesce(nullif(trim(p_sound_key), ''), 'soft'),
        coalesce(p_background_key, 'heart'),
        coalesce(p_font_key, 'serif'),
        coalesce(p_text_size_key, 'medium'),
        coalesce(p_text_alignment_key, 'center'),
        coalesce(p_text_position_key, 'center'),
        p_client_request_id, v_fingerprint, p_external_url,
        p_external_provider, p_external_content_kind
    )
    returning * into v_lumi;

    update public.necklaces
    set queue_revision = queue_revision + 1
    where id = p_necklace_id;

    return jsonb_build_object(
        'status', 'ok',
        'lumi', public.queue_lumi_json(v_lumi, v_necklace.theme_key),
        'queue', public.necklace_queue_snapshot(p_necklace_id),
        'idempotent_replay', false
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
    if not found then raise exception 'library message not found'; end if;

    return public.enqueue_necklace_lumi_for_sender(
        p_user_id, p_necklace_id, v_message.text, p_destination,
        v_message.id, v_message.theme_key, v_message.animation_key,
        v_message.sound_key, v_message.theme_key, v_message.font_key,
        v_message.text_size_key, v_message.text_alignment_key,
        v_message.text_position_key
    );
end;
$$;

create function public.enqueue_shared_necklace_lumi_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_client_request_id uuid,
    p_content text,
    p_destination text,
    p_external_url text,
    p_external_provider text,
    p_external_content_kind text,
    p_background_key text default 'heart',
    p_font_key text default 'serif',
    p_text_size_key text default 'medium',
    p_text_alignment_key text default 'center',
    p_text_position_key text default 'center'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
    select public.enqueue_necklace_lumi_for_sender(
        p_user_id, p_necklace_id, p_content, p_destination,
        null, null, null, null, p_background_key, p_font_key,
        p_text_size_key, p_text_alignment_key, p_text_position_key,
        p_client_request_id, p_external_url, p_external_provider,
        p_external_content_kind
    );
$$;

revoke execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text, text,
    text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(
    uuid, uuid, text, text, uuid, text, text, text, text, text, text,
    text, text, uuid, text, text, text
) to service_role;

revoke execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
) to service_role;

revoke execute on function public.enqueue_shared_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text, text, text, text, text, text,
    text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_shared_necklace_lumi_for_sender(
    uuid, uuid, uuid, text, text, text, text, text, text, text, text,
    text, text
) to service_role;

-- Preserve the current resolver and add an attachment bound to the exact
-- necklace_lumi_id held by its reveal session.
alter function public.resolve_next_necklace_lumi(text)
rename to resolve_next_necklace_lumi_shared_links_v1;

revoke execute on function public.resolve_next_necklace_lumi_shared_links_v1(text)
from public, anon, authenticated, service_role;

create function public.resolve_next_necklace_lumi(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result jsonb;
    v_lumi public.necklace_lumis%rowtype;
begin
    v_result :=
        public.resolve_next_necklace_lumi_shared_links_v1(p_token_hash);
    if v_result ->> 'status' <> 'ready' then return v_result; end if;

    select l.* into v_lumi
    from public.lumi_reveal_sessions s
    join public.necklace_lumis l on l.id = s.necklace_lumi_id
    where s.id = (v_result ->> 'reveal_session_id')::uuid;

    if not found or v_lumi.external_url is null then return v_result; end if;
    return v_result || jsonb_build_object(
        'attachment', jsonb_build_object(
            'type', 'link',
            'provider', v_lumi.external_provider,
            'contentKind', v_lumi.external_content_kind,
            'url', v_lumi.external_url,
            'host', 'instagram.com',
            'ctaLabel', 'View on Instagram',
            'openMode', 'external'
        )
    );
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text)
to service_role;

comment on column public.necklace_lumis.external_url is
    'Immutable normalized HTTPS URL snapshot; no remote media is stored.';
comment on column public.necklace_lumis.client_request_fingerprint is
    'SHA-256 of the immutable normalized share request used for replay checks.';
