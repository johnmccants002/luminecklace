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

    perform pg_advisory_xact_lock(hashtextextended(p_necklace_id::text, 0));

    select n.*
    into v_necklace
    from public.necklaces n
    join public.necklace_ownerships own on own.necklace_id = n.id
    where n.id = p_necklace_id
      and own.sender_user_id = p_user_id;

    if not found then
        raise exception 'forbidden';
    end if;

    if v_necklace.lifecycle_status not in ('active', 'pending_sender_setup') then
        raise exception 'necklace unavailable';
    end if;

    select coalesce(max(l.queue_position), 0) + 1
    into v_queue_position
    from public.necklace_lumis l
    where l.necklace_id = p_necklace_id;

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
        'theme_key', coalesce(v_lumi.theme_key, 'heart'),
        'animation_key', coalesce(v_lumi.animation_key, 'breathe'),
        'sound_key', coalesce(v_lumi.sound_key, 'soft')
    );
end;
$$;

revoke execute on function public.enqueue_necklace_lumi_for_sender(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.enqueue_necklace_lumi_for_sender(uuid, uuid, text)
to service_role;
