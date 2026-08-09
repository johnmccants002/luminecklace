-- Generic public website attachments use the existing immutable external-link
-- columns. URL safety is enforced by the API without DNS or HTTP access; these
-- checks provide a database-level provider/shape/size backstop.
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
            and octet_length(external_url) <= 4096
            and external_url like 'https://%'
            and (
                (
                    external_provider = 'instagram'
                    and external_url like 'https://instagram.com/%'
                    and external_content_kind in (
                        'post', 'reel', 'story', 'profile', 'link',
                        'instagram_link'
                    )
                )
                or
                (
                    external_provider = 'website'
                    and external_content_kind = 'link'
                    and external_url not like 'https://instagram.com/%'
                    and external_url not like 'https://instagram.com:%'
                    and external_url not like 'https://www.instagram.com/%'
                    and external_url not like 'https://www.instagram.com:%'
                )
            )
        )
    );

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
        'experiencePresetKey', coalesce(
            p_lumi.experience_preset_key, 'classic_word_rise_v1'
        ),
        'queuePosition', p_lumi.queue_position,
        'presentation', jsonb_build_object(
            'theme', case when coalesce(p_lumi.theme_key, p_fallback_theme) in
                ('heart', 'champagne', 'rose', 'midnight')
                then coalesce(p_lumi.theme_key, p_fallback_theme) else 'heart' end,
            'animation', coalesce(p_lumi.animation_key, 'breathe'),
            'sound', coalesce(p_lumi.sound_key, 'soft'),
            'revealPreset', 'wordRise',
            'background', case when coalesce(p_lumi.theme_key, p_fallback_theme) in
                ('heart', 'champagne', 'rose', 'midnight')
                then coalesce(p_lumi.theme_key, p_fallback_theme) else 'heart' end,
            'font', case when p_lumi.font_key in ('serif', 'rounded')
                then p_lumi.font_key else 'serif' end,
            'textSize', coalesce(p_lumi.text_size_key, 'medium'),
            'textAlignment', coalesce(p_lumi.text_alignment_key, 'center'),
            'textPosition', coalesce(p_lumi.text_position_key, 'center')
        )
    )
    || case when p_lumi.secondary_text is null then '{}'::jsonb else
        jsonb_build_object('secondaryText', p_lumi.secondary_text) end
    || case when p_lumi.external_url is null then '{}'::jsonb else
        jsonb_build_object('attachment', jsonb_build_object(
            'type', 'link',
            'provider', p_lumi.external_provider,
            'contentKind', p_lumi.external_content_kind,
            'url', p_lumi.external_url,
            'host', case when p_lumi.external_provider = 'instagram'
                then 'instagram.com'
                else trim(both '[]' from substring(
                    p_lumi.external_url from '^https://(\[[^]]+\]|[^/:?#]+)'
                )) end,
            'ctaLabel', case when p_lumi.external_provider = 'instagram'
                then 'View on Instagram' else 'Open website' end,
            'openMode', 'external'
        )) end;
$$;

create or replace function public.enqueue_necklace_lumi_for_sender(
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
               octet_length(p_external_url) > 4096
               or p_external_url not like 'https://%'
               or not (
                   (
                       p_external_provider = 'instagram'
                       and p_external_url like 'https://instagram.com/%'
                       and p_external_content_kind in (
                           'post', 'reel', 'story', 'profile', 'link',
                           'instagram_link'
                       )
                   )
                   or
                   (
                       p_external_provider = 'website'
                       and p_external_content_kind = 'link'
                       and p_external_url not like 'https://instagram.com/%'
                       and p_external_url not like 'https://instagram.com:%'
                       and p_external_url not like 'https://www.instagram.com/%'
                       and p_external_url not like 'https://www.instagram.com:%'
                   )
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

-- This function remains in the resolver wrapper chain after the experience
-- migration, so replacing it updates recipient attachment serialization too.
create or replace function public.resolve_next_necklace_lumi_shared_links_v1(
    p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result jsonb;
    v_lumi public.necklace_lumis%rowtype;
begin
    v_result := public.resolve_next_necklace_lumi_layout_v1(p_token_hash);
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
            'host', case when v_lumi.external_provider = 'instagram'
                then 'instagram.com'
                else trim(both '[]' from substring(
                    v_lumi.external_url from '^https://(\[[^]]+\]|[^/:?#]+)'
                )) end,
            'ctaLabel', case when v_lumi.external_provider = 'instagram'
                then 'View on Instagram' else 'Open website' end,
            'openMode', 'external'
        )
    );
end;
$$;

comment on column public.necklace_lumis.external_url is
    'Immutable normalized public HTTPS URL snapshot; no destination is fetched.';
