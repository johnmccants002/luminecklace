-- One-way recipient acknowledgment feedback for revealed personal Lumis.
create table public.lumi_reveal_feedback (
    id uuid primary key default gen_random_uuid(),
    necklace_lumi_id uuid not null
        references public.necklace_lumis (id) on delete cascade,
    reveal_session_id uuid not null
        references public.lumi_reveal_sessions (id) on delete cascade,
    reaction_key text,
    response_text text,
    reacted_at timestamptz,
    responded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint lumi_reveal_feedback_necklace_lumi_key unique (necklace_lumi_id),
    constraint lumi_reveal_feedback_reaction_key_check check (
        reaction_key is null
        or reaction_key in ('heart', 'touched', 'laugh', 'sparkle', 'hug', 'wow')
    ),
    constraint lumi_reveal_feedback_response_text_check check (
        response_text is null
        or char_length(btrim(response_text)) between 1 and 250
    ),
    constraint lumi_reveal_feedback_not_empty_check check (
        reaction_key is not null or response_text is not null
    ),
    constraint lumi_reveal_feedback_reaction_timestamp_check check (
        (reaction_key is null) = (reacted_at is null)
    ),
    constraint lumi_reveal_feedback_response_timestamp_check check (
        (response_text is null) = (responded_at is null)
    )
);

create index lumi_reveal_feedback_reveal_session_idx
    on public.lumi_reveal_feedback (reveal_session_id);

create index lumi_reveal_feedback_recent_activity_idx
    on public.lumi_reveal_feedback (updated_at desc);

create trigger lumi_reveal_feedback_set_updated_at
before update on public.lumi_reveal_feedback
for each row execute function public.set_updated_at();

alter table public.lumi_reveal_feedback enable row level security;

revoke all on table public.lumi_reveal_feedback
from public, anon, authenticated;
grant all on table public.lumi_reveal_feedback to service_role;

create function public.set_lumi_reaction(
    p_reveal_session_id uuid,
    p_reaction_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.lumi_reveal_sessions%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_feedback public.lumi_reveal_feedback%rowtype;
    v_reaction_key text := p_reaction_key;
begin
    if v_reaction_key is null or v_reaction_key not in (
        'heart', 'touched', 'laugh', 'sparkle', 'hug', 'wow'
    ) then
        return jsonb_build_object('status', 'invalid_reaction');
    end if;

    if p_reveal_session_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select *
    into v_session
    from public.lumi_reveal_sessions s
    where s.id = p_reveal_session_id
    for update;

    if not found
       or v_session.source_type <> 'personal'
       or v_session.necklace_lumi_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_session.expires_at <= now() then
        return jsonb_build_object('status', 'expired');
    end if;

    if v_session.completed_at is null or v_session.revealed_at is null then
        return jsonb_build_object('status', 'not_revealed');
    end if;

    select *
    into v_lumi
    from public.necklace_lumis l
    where l.id = v_session.necklace_lumi_id
      and l.necklace_id = v_session.necklace_id
    for update;

    if not found then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_lumi.revealed_at is null then
        return jsonb_build_object('status', 'not_revealed');
    end if;

    insert into public.lumi_reveal_feedback (
        necklace_lumi_id,
        reveal_session_id,
        reaction_key,
        reacted_at
    )
    values (
        v_lumi.id,
        v_session.id,
        v_reaction_key,
        now()
    )
    on conflict (necklace_lumi_id) do update
    set
        reaction_key = excluded.reaction_key,
        reacted_at = now()
    where lumi_reveal_feedback.reaction_key is distinct from excluded.reaction_key
    returning * into v_feedback;

    if not found then
        select *
        into v_feedback
        from public.lumi_reveal_feedback f
        where f.necklace_lumi_id = v_lumi.id;
    end if;

    return jsonb_build_object(
        'status', 'reacted',
        'feedback', jsonb_build_object(
            'necklace_lumi_id', v_feedback.necklace_lumi_id,
            'reveal_session_id', v_feedback.reveal_session_id,
            'reaction_key', v_feedback.reaction_key,
            'reacted_at', v_feedback.reacted_at,
            'response_text', v_feedback.response_text,
            'responded_at', v_feedback.responded_at
        )
    );
end;
$$;

create function public.submit_lumi_response(
    p_reveal_session_id uuid,
    p_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.lumi_reveal_sessions%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_feedback public.lumi_reveal_feedback%rowtype;
    v_response_text text := btrim(p_response_text);
begin
    if v_response_text is null
       or char_length(v_response_text) < 1
       or char_length(v_response_text) > 250 then
        return jsonb_build_object('status', 'invalid_response');
    end if;

    if p_reveal_session_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select *
    into v_session
    from public.lumi_reveal_sessions s
    where s.id = p_reveal_session_id
    for update;

    if not found
       or v_session.source_type <> 'personal'
       or v_session.necklace_lumi_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_session.expires_at <= now() then
        return jsonb_build_object('status', 'expired');
    end if;

    if v_session.completed_at is null or v_session.revealed_at is null then
        return jsonb_build_object('status', 'not_revealed');
    end if;

    select *
    into v_lumi
    from public.necklace_lumis l
    where l.id = v_session.necklace_lumi_id
      and l.necklace_id = v_session.necklace_id
    for update;

    if not found then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_lumi.revealed_at is null then
        return jsonb_build_object('status', 'not_revealed');
    end if;

    insert into public.lumi_reveal_feedback (
        necklace_lumi_id,
        reveal_session_id,
        response_text,
        responded_at
    )
    values (
        v_lumi.id,
        v_session.id,
        v_response_text,
        now()
    )
    on conflict (necklace_lumi_id) do update
    set
        response_text = excluded.response_text,
        responded_at = excluded.responded_at
    where lumi_reveal_feedback.response_text is null
    returning * into v_feedback;

    if not found then
        select *
        into v_feedback
        from public.lumi_reveal_feedback f
        where f.necklace_lumi_id = v_lumi.id;

        return jsonb_build_object(
            'status', 'already_responded',
            'feedback', jsonb_build_object(
                'necklace_lumi_id', v_feedback.necklace_lumi_id,
                'reveal_session_id', v_feedback.reveal_session_id,
                'reaction_key', v_feedback.reaction_key,
                'reacted_at', v_feedback.reacted_at,
                'response_text', v_feedback.response_text,
                'responded_at', v_feedback.responded_at
            )
        );
    end if;

    return jsonb_build_object(
        'status', 'responded',
        'feedback', jsonb_build_object(
            'necklace_lumi_id', v_feedback.necklace_lumi_id,
            'reveal_session_id', v_feedback.reveal_session_id,
            'reaction_key', v_feedback.reaction_key,
            'reacted_at', v_feedback.reacted_at,
            'response_text', v_feedback.response_text,
            'responded_at', v_feedback.responded_at
        )
    );
end;
$$;

revoke execute on function public.set_lumi_reaction(uuid, text)
from public, anon, authenticated;
grant execute on function public.set_lumi_reaction(uuid, text)
to service_role;

revoke execute on function public.submit_lumi_response(uuid, text)
from public, anon, authenticated;
grant execute on function public.submit_lumi_response(uuid, text)
to service_role;

comment on table public.lumi_reveal_feedback is
    'One-way recipient acknowledgment attached to a revealed personal Lumi; not a message thread.';
