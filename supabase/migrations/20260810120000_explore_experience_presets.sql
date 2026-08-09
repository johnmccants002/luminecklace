-- Versioned, curated Explore experiences. The preset key is a renderer
-- contract, not arbitrary animation data. Queued rows keep their own snapshot.
alter table public.messages
    add column if not exists experience_preset_key text not null
        default 'classic_word_rise_v1',
    add column if not exists secondary_text text,
    add column if not exists mood text,
    add column if not exists duration_seconds integer;

alter table public.necklace_lumis
    add column if not exists experience_preset_key text not null
        default 'classic_word_rise_v1',
    add column if not exists secondary_text text;

alter table public.messages
    drop constraint if exists messages_experience_preset_key_check,
    drop constraint if exists messages_secondary_text_check,
    drop constraint if exists messages_duration_seconds_check,
    add constraint messages_experience_preset_key_check check (
        experience_preset_key in (
            'classic_word_rise_v1', 'golden_hour_v1', 'midnight_v1',
            'proud_of_you_v1', 'playful_v1', 'calm_v1', 'memory_v1',
            'timed_surprise_v1'
        )
    ),
    add constraint messages_secondary_text_check check (
        secondary_text is null or length(btrim(secondary_text)) between 1 and 250
    ),
    add constraint messages_duration_seconds_check check (
        duration_seconds is null or duration_seconds between 1 and 60
    );

alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_experience_preset_key_check,
    drop constraint if exists necklace_lumis_secondary_text_check,
    add constraint necklace_lumis_experience_preset_key_check check (
        experience_preset_key in (
            'classic_word_rise_v1', 'golden_hour_v1', 'midnight_v1',
            'proud_of_you_v1', 'playful_v1', 'calm_v1', 'memory_v1',
            'timed_surprise_v1'
        )
    ),
    add constraint necklace_lumis_secondary_text_check check (
        secondary_text is null or length(btrim(secondary_text)) between 1 and 250
    );

-- Catalog messages require a valid package. Keep this migration self-contained
-- instead of depending on the optional application seed script having run.
insert into public.packages (id, title, is_premium)
values ('experience-v1', 'Lumi Experiences', false)
on conflict (id) do nothing;

insert into public.messages (
    package_id, import_key, title, text, content, secondary_text, mood,
    duration_seconds, experience_preset_key, category, state, is_active,
    is_explore_published, explore_sort_order, is_reserve_eligible,
    reserve_default_approved, theme_key, animation_key, sound_key,
    background_key, font_key, text_size_key, text_alignment_key,
    text_position_key
)
values
    ('experience-v1', 'experience:golden-hour-v1', 'Golden Hour',
     'Just a reminder that someone is thinking about you.',
     'Just a reminder that someone is thinking about you.', null, 'Warm', 8,
     'golden_hour_v1', 'presence', 'published', true, true, 10, false, false,
     'champagne', 'breathe', 'soft', 'champagne', 'serif', 'medium', 'center', 'center'),
    ('experience-v1', 'experience:midnight-v1', 'Midnight',
     'You crossed my mind tonight.', 'You crossed my mind tonight.', null,
     'Intimate', 7, 'midnight_v1', 'affection', 'published', true, true, 20,
     false, false, 'midnight', 'breathe', 'soft', 'midnight', 'serif',
     'medium', 'center', 'center'),
    ('experience-v1', 'experience:proud-of-you-v1', 'Proud of You',
     'Look how far you''ve come.', 'Look how far you''ve come.', null,
     'Uplifting', 6, 'proud_of_you_v1', 'encouragement', 'published', true,
     true, 30, false, false, 'rose', 'breathe', 'soft', 'rose', 'rounded',
     'large', 'center', 'center'),
    ('experience-v1', 'experience:playful-v1', 'Playful',
     'Okay but seriously… you''re my favorite person.',
     'Okay but seriously… you''re my favorite person.', null, 'Playful', 6,
     'playful_v1', 'affection', 'published', true, true, 40, false, false,
     'rose', 'breathe', 'soft', 'rose', 'rounded', 'medium', 'center', 'center'),
    ('experience-v1', 'experience:calm-v1', 'Calm',
     'You don''t have to figure everything out tonight.',
     'You don''t have to figure everything out tonight.', null, 'Calm', 9,
     'calm_v1', 'comfort', 'published', true, true, 50, false, false,
     'heart', 'breathe', 'soft', 'heart', 'serif', 'medium', 'center', 'center'),
    ('experience-v1', 'experience:memory-v1', 'Memory',
     'Remember that night we couldn''t stop laughing?',
     'Remember that night we couldn''t stop laughing?', null, 'Nostalgic', 8,
     'memory_v1', 'presence', 'published', true, true, 60, false, false,
     'champagne', 'breathe', 'soft', 'champagne', 'serif', 'medium', 'center', 'center'),
    ('experience-v1', 'experience:timed-surprise-v1', 'Surprise',
     'I have something to tell you…', 'I have something to tell you…',
     'I''m really glad you''re in my life.', 'Heartfelt', 10,
     'timed_surprise_v1', 'affection', 'published', true, true, 70, false,
     false, 'midnight', 'breathe', 'soft', 'midnight', 'rounded', 'large',
     'center', 'center')
on conflict (import_key) do update set
    title = excluded.title,
    text = excluded.text,
    content = excluded.content,
    secondary_text = excluded.secondary_text,
    mood = excluded.mood,
    duration_seconds = excluded.duration_seconds,
    experience_preset_key = excluded.experience_preset_key,
    category = excluded.category,
    state = excluded.state,
    is_active = excluded.is_active,
    is_explore_published = excluded.is_explore_published,
    explore_sort_order = excluded.explore_sort_order,
    theme_key = excluded.theme_key,
    animation_key = excluded.animation_key,
    sound_key = excluded.sound_key,
    background_key = excluded.background_key,
    font_key = excluded.font_key,
    text_size_key = excluded.text_size_key,
    text_alignment_key = excluded.text_alignment_key,
    text_position_key = excluded.text_position_key;

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
            'type', 'link', 'provider', p_lumi.external_provider,
            'contentKind', p_lumi.external_content_kind,
            'url', p_lumi.external_url, 'host', 'instagram.com',
            'ctaLabel', 'View on Instagram', 'openMode', 'external'
        )) end;
$$;

drop function if exists public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text
);

create function public.enqueue_library_message_for_sender(
    p_user_id uuid,
    p_necklace_id uuid,
    p_message_id uuid,
    p_destination text,
    p_primary_text text default null,
    p_secondary_text text default null,
    p_has_secondary_text boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_message public.messages%rowtype;
    v_result jsonb;
    v_lumi public.necklace_lumis%rowtype;
    v_primary text;
    v_secondary text;
begin
    select m.* into v_message from public.messages m
    where m.id = p_message_id and m.is_active = true
      and m.is_explore_published = true
    for share;
    if not found then raise exception 'library message not found'; end if;

    v_primary := coalesce(nullif(btrim(p_primary_text), ''), v_message.text);
    v_secondary := case when p_has_secondary_text
        then nullif(btrim(p_secondary_text), '') else v_message.secondary_text end;
    if v_primary is null or length(v_primary) > 500 then
        raise exception 'invalid content';
    end if;
    if v_secondary is not null and length(v_secondary) > 250 then
        raise exception 'invalid secondary content';
    end if;

    v_result := public.enqueue_necklace_lumi_for_sender(
        p_user_id, p_necklace_id, v_primary, p_destination,
        v_message.id, v_message.theme_key, v_message.animation_key,
        v_message.sound_key, v_message.theme_key, v_message.font_key,
        v_message.text_size_key, v_message.text_alignment_key,
        v_message.text_position_key
    );

    select l.* into v_lumi from public.necklace_lumis l
    where l.id = (v_result -> 'lumi' ->> 'id')::uuid for update;
    update public.necklace_lumis set
        experience_preset_key = v_message.experience_preset_key,
        secondary_text = v_secondary
    where id = v_lumi.id
    returning * into v_lumi;

    return jsonb_set(
        jsonb_set(v_result, '{lumi}', public.queue_lumi_json(
            v_lumi, v_message.theme_key
        )),
        '{queue}', public.necklace_queue_snapshot(p_necklace_id)
    );
end;
$$;

revoke execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.enqueue_library_message_for_sender(
    uuid, uuid, uuid, text, text, text, boolean
) to service_role;

alter function public.resolve_next_necklace_lumi(text)
rename to resolve_next_necklace_lumi_experience_v1;

revoke execute on function public.resolve_next_necklace_lumi_experience_v1(text)
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
    v_result := public.resolve_next_necklace_lumi_experience_v1(p_token_hash);
    if v_result ->> 'status' <> 'ready' then return v_result; end if;

    select l.* into v_lumi
    from public.lumi_reveal_sessions s
    join public.necklace_lumis l on l.id = s.necklace_lumi_id
    where s.id = (v_result ->> 'reveal_session_id')::uuid;
    if not found then return v_result; end if;

    return v_result || jsonb_build_object(
        'experience_preset_key', coalesce(
            v_lumi.experience_preset_key, 'classic_word_rise_v1'
        )
    ) || case when v_lumi.secondary_text is null then '{}'::jsonb else
        jsonb_build_object('secondary_text', v_lumi.secondary_text) end;
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text)
to service_role;

comment on column public.messages.experience_preset_key is
    'Immutable versioned key for a curated client renderer; never animation JSON.';
comment on column public.necklace_lumis.experience_preset_key is
    'Versioned renderer key copied from its source catalog row at enqueue time.';
