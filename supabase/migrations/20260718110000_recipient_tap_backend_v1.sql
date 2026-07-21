-- Recipient tap backend for Lumi App Clip (v1)
create extension if not exists pgcrypto;

create table if not exists public.necklace_lumis (
    id uuid primary key default gen_random_uuid(),
    necklace_id uuid not null references public.necklaces (id) on delete cascade,
    author_user_id uuid not null references auth.users (id) on delete cascade,
    source_message_id uuid references public.messages (id) on delete set null,
    content text not null,
    queue_position integer not null check (queue_position > 0),
    is_enabled boolean not null default true,
    eligible_from timestamptz,
    revealed_at timestamptz,
    theme_key text,
    animation_key text,
    sound_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists necklace_lumis_necklace_queue_position_idx
    on public.necklace_lumis (necklace_id, queue_position);

create index if not exists necklace_lumis_resolution_idx
    on public.necklace_lumis (necklace_id, is_enabled, revealed_at, queue_position, created_at, id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists necklace_lumis_set_updated_at on public.necklace_lumis;
create trigger necklace_lumis_set_updated_at
before update on public.necklace_lumis
for each row
execute function public.set_updated_at();

create table if not exists public.lumi_reveal_sessions (
    id uuid primary key default gen_random_uuid(),
    necklace_id uuid not null references public.necklaces (id) on delete cascade,
    necklace_lumi_id uuid not null references public.necklace_lumis (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    completed_at timestamptz,
    revealed_at timestamptz
);

create index if not exists lumi_reveal_sessions_necklace_idx
    on public.lumi_reveal_sessions (necklace_id, created_at desc);

create index if not exists lumi_reveal_sessions_expiry_idx
    on public.lumi_reveal_sessions (expires_at);

alter table public.necklace_lumis enable row level security;
alter table public.lumi_reveal_sessions enable row level security;

drop policy if exists necklace_lumis_sender_select on public.necklace_lumis;
create policy necklace_lumis_sender_select on public.necklace_lumis
    for select using (
        exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = necklace_lumis.necklace_id
              and own.sender_user_id = auth.uid()
        )
    );

drop policy if exists necklace_lumis_sender_insert on public.necklace_lumis;
create policy necklace_lumis_sender_insert on public.necklace_lumis
    for insert with check (
        author_user_id = auth.uid()
        and exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = necklace_lumis.necklace_id
              and own.sender_user_id = auth.uid()
        )
    );

drop policy if exists necklace_lumis_sender_update on public.necklace_lumis;
create policy necklace_lumis_sender_update on public.necklace_lumis
    for update using (
        exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = necklace_lumis.necklace_id
              and own.sender_user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = necklace_lumis.necklace_id
              and own.sender_user_id = auth.uid()
        )
    );

drop policy if exists necklace_lumis_sender_delete on public.necklace_lumis;
create policy necklace_lumis_sender_delete on public.necklace_lumis
    for delete using (
        exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = necklace_lumis.necklace_id
              and own.sender_user_id = auth.uid()
        )
    );

alter table public.tap_events
    add column if not exists necklace_lumi_id uuid references public.necklace_lumis (id) on delete set null,
    add column if not exists reveal_session_id uuid references public.lumi_reveal_sessions (id) on delete set null;

create index if not exists tap_events_necklace_lumi_idx
    on public.tap_events (necklace_lumi_id);

create unique index if not exists tap_events_one_reveal_log_per_session
    on public.tap_events (reveal_session_id)
    where status = 'lumi_revealed';

create or replace function public.resolve_next_necklace_lumi(
    p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace public.necklaces%rowtype;
    v_lumi public.necklace_lumis%rowtype;
    v_reveal_session_id uuid;
    v_reveal_expires_at timestamptz;
    v_theme text;
    v_animation text;
    v_sound text;
begin
    if p_token_hash is null or length(trim(p_token_hash)) = 0 then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select *
    into v_necklace
    from public.necklaces n
    where n.tap_token_hash = trim(p_token_hash)
    for update;

    if not found then
        begin
            insert into public.tap_events (status, context)
            values ('tap_unavailable', jsonb_build_object('source', 'recipient_resolve'));
        exception
            when others then
                null;
        end;

        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_necklace.lifecycle_status <> 'active' then
        begin
            insert into public.tap_events (necklace_id, status, context)
            values (v_necklace.id, 'tap_unavailable', jsonb_build_object('source', 'recipient_resolve'));
        exception
            when others then
                null;
        end;

        return jsonb_build_object('status', 'unavailable');
    end if;

    select *
    into v_lumi
    from public.necklace_lumis l
    where l.necklace_id = v_necklace.id
      and l.is_enabled = true
      and l.revealed_at is null
    order by l.queue_position asc, l.created_at asc, l.id asc
    limit 1
    for update;

    if not found then
        begin
            insert into public.tap_events (necklace_id, status, context)
            values (v_necklace.id, 'tap_empty', jsonb_build_object('source', 'recipient_resolve'));
        exception
            when others then
                null;
        end;

        return jsonb_build_object('status', 'empty');
    end if;

    if v_lumi.eligible_from is not null and v_lumi.eligible_from > now() then
        begin
            insert into public.tap_events (necklace_id, necklace_lumi_id, status, context)
            values (
                v_necklace.id,
                v_lumi.id,
                'tap_empty',
                jsonb_build_object('source', 'recipient_resolve', 'reason', 'not_eligible_yet')
            );
        exception
            when others then
                null;
        end;

        return jsonb_build_object('status', 'empty');
    end if;

    v_reveal_session_id := gen_random_uuid();
    v_reveal_expires_at := now() + interval '12 minutes';

    insert into public.lumi_reveal_sessions (
        id,
        necklace_id,
        necklace_lumi_id,
        created_at,
        expires_at
    )
    values (
        v_reveal_session_id,
        v_necklace.id,
        v_lumi.id,
        now(),
        v_reveal_expires_at
    );

    v_theme := coalesce(v_lumi.theme_key, v_necklace.theme_key, 'heart');
    v_animation := coalesce(v_lumi.animation_key, 'breathe');
    v_sound := coalesce(v_lumi.sound_key, 'soft');

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
            v_reveal_session_id,
            'tap_ready',
            jsonb_build_object('source', 'recipient_resolve')
        );
    exception
        when others then
            null;
    end;

    return jsonb_build_object(
        'status', 'ready',
        'reveal_session_id', v_reveal_session_id,
        'necklace_display_name', v_necklace.name,
        'necklace_lumi_id', v_lumi.id,
        'lumi_text', v_lumi.content,
        'presentation', jsonb_build_object(
            'theme', v_theme,
            'animation', v_animation,
            'sound', v_sound
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
    v_lumi public.necklace_lumis%rowtype;
    v_revealed_at timestamptz;
begin
    if p_reveal_session_id is null then
        return jsonb_build_object('status', 'unavailable');
    end if;

    select *
    into v_session
    from public.lumi_reveal_sessions s
    where s.id = p_reveal_session_id
    for update;

    if not found then
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_session.expires_at <= now() then
        return jsonb_build_object('status', 'expired');
    end if;

    select *
    into v_lumi
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
        where id = v_lumi.id
          and revealed_at is null;

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
            when unique_violation then
                null;
        end;
    else
        v_revealed_at := v_lumi.revealed_at;
    end if;

    update public.lumi_reveal_sessions
    set
        completed_at = coalesce(completed_at, now()),
        revealed_at = coalesce(revealed_at, v_revealed_at)
    where id = v_session.id;

    return jsonb_build_object(
        'status', 'revealed',
        'revealed_at', v_revealed_at
    );
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text) from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text) to service_role;

revoke execute on function public.confirm_necklace_lumi_reveal(uuid) from public, anon, authenticated;
grant execute on function public.confirm_necklace_lumi_reveal(uuid) to service_role;
