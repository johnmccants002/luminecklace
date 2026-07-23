-- Lumi Reserve reuses the global messages catalog and is only considered after
-- a necklace's personal queue is exhausted.

alter table public.messages
    add column if not exists is_reserve_eligible boolean not null default false,
    add column if not exists reserve_default_approved boolean not null default false,
    add column if not exists reserve_sort_order integer;

alter table public.messages
    drop constraint if exists messages_reserve_sort_order_positive,
    drop constraint if exists messages_reserve_default_requires_eligibility;
alter table public.messages
    add constraint messages_reserve_sort_order_positive
        check (reserve_sort_order is null or reserve_sort_order > 0),
    add constraint messages_reserve_default_requires_eligibility
        check (not reserve_default_approved or is_reserve_eligible);

create unique index if not exists messages_active_reserve_sort_order_idx
    on public.messages (reserve_sort_order)
    where is_active = true
      and is_reserve_eligible = true
      and reserve_sort_order is not null;

create table public.necklace_reserve_settings (
    necklace_id uuid primary key
        references public.necklaces (id) on delete cascade,
    is_enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.necklace_reserve_items (
    necklace_id uuid not null
        references public.necklaces (id) on delete cascade,
    message_id uuid not null
        references public.messages (id) on delete cascade,
    is_approved boolean not null default true,
    last_revealed_at timestamptz,
    reveal_count integer not null default 0 check (reveal_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (necklace_id, message_id)
);

create index necklace_reserve_items_selection_idx
    on public.necklace_reserve_items (
        necklace_id,
        is_approved,
        last_revealed_at,
        message_id
    );

create trigger necklace_reserve_settings_set_updated_at
before update on public.necklace_reserve_settings
for each row execute function public.set_updated_at();

create trigger necklace_reserve_items_set_updated_at
before update on public.necklace_reserve_items
for each row execute function public.set_updated_at();

alter table public.necklace_reserve_settings enable row level security;
alter table public.necklace_reserve_items enable row level security;

create policy necklace_reserve_settings_sender_select
on public.necklace_reserve_settings
for select using (
    exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = necklace_reserve_settings.necklace_id
          and own.sender_user_id = auth.uid()
    )
);

create policy necklace_reserve_settings_sender_update
on public.necklace_reserve_settings
for update using (
    exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = necklace_reserve_settings.necklace_id
          and own.sender_user_id = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = necklace_reserve_settings.necklace_id
          and own.sender_user_id = auth.uid()
    )
);

create policy necklace_reserve_items_sender_select
on public.necklace_reserve_items
for select using (
    exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = necklace_reserve_items.necklace_id
          and own.sender_user_id = auth.uid()
    )
);

create policy necklace_reserve_items_sender_update
on public.necklace_reserve_items
for update using (
    exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = necklace_reserve_items.necklace_id
          and own.sender_user_id = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.necklace_ownerships own
        where own.necklace_id = necklace_reserve_items.necklace_id
          and own.sender_user_id = auth.uid()
    )
);

alter table public.lumi_reveal_sessions
    add column source_type text not null default 'personal',
    add column reserve_message_id uuid
        references public.messages (id) on delete set null;

alter table public.lumi_reveal_sessions
    alter column necklace_lumi_id drop not null;

alter table public.lumi_reveal_sessions
    add constraint lumi_reveal_sessions_source_type_check
        check (source_type in ('personal', 'reserve')),
    add constraint lumi_reveal_sessions_exactly_one_source_check
        check (
            (
                source_type = 'personal'
                and necklace_lumi_id is not null
                and reserve_message_id is null
            )
            or
            (
                source_type = 'reserve'
                and necklace_lumi_id is null
                and reserve_message_id is not null
            )
        );

create index lumi_reveal_sessions_active_necklace_idx
    on public.lumi_reveal_sessions (necklace_id, expires_at, created_at)
    where completed_at is null;

alter table public.tap_events
    add column reserve_message_id uuid
        references public.messages (id) on delete set null;

create index tap_events_reserve_message_idx
    on public.tap_events (reserve_message_id);

create or replace function public.initialize_necklace_lumi_reserve(
    p_necklace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_inserted_items integer;
begin
    if p_necklace_id is null or not exists (
        select 1 from public.necklaces where id = p_necklace_id
    ) then
        return jsonb_build_object('status', 'not_found');
    end if;

    insert into public.necklace_reserve_settings (necklace_id)
    values (p_necklace_id)
    on conflict (necklace_id) do nothing;

    insert into public.necklace_reserve_items (
        necklace_id,
        message_id,
        is_approved
    )
    select
        p_necklace_id,
        m.id,
        m.reserve_default_approved
    from public.messages m
    where m.is_active = true
      and m.is_reserve_eligible = true
    on conflict (necklace_id, message_id) do nothing;

    get diagnostics v_inserted_items = row_count;

    return jsonb_build_object(
        'status', 'ok',
        'inserted_items', v_inserted_items
    );
end;
$$;

revoke execute on function public.initialize_necklace_lumi_reserve(uuid)
from public, anon, authenticated;
grant execute on function public.initialize_necklace_lumi_reserve(uuid)
to service_role;

create or replace function public.initialize_new_necklace_lumi_reserve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.initialize_necklace_lumi_reserve(new.id);
    return new;
end;
$$;

create trigger necklaces_initialize_lumi_reserve
after insert on public.necklaces
for each row execute function public.initialize_new_necklace_lumi_reserve();

revoke execute on function public.initialize_new_necklace_lumi_reserve()
from public, anon, authenticated;

-- Existing necklaces receive an explicit settings row now. Reserve items are
-- synchronized by seed.ts after the catalog metadata has been applied.
insert into public.necklace_reserve_settings (necklace_id)
select id from public.necklaces
on conflict (necklace_id) do nothing;

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
    v_session public.lumi_reveal_sessions%rowtype;
    v_personal public.necklace_lumis%rowtype;
    v_reserve_item public.necklace_reserve_items%rowtype;
    v_reserve_message public.messages%rowtype;
    v_session_id uuid;
    v_expires_at timestamptz;
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
        exception when others then null;
        end;
        return jsonb_build_object('status', 'unavailable');
    end if;

    if v_necklace.lifecycle_status <> 'active' then
        begin
            insert into public.tap_events (necklace_id, status, context)
            values (
                v_necklace.id,
                'tap_unavailable',
                jsonb_build_object('source', 'recipient_resolve')
            );
        exception when others then null;
        end;
        return jsonb_build_object('status', 'unavailable');
    end if;

    select *
    into v_session
    from public.lumi_reveal_sessions s
    where s.necklace_id = v_necklace.id
      and s.completed_at is null
      and s.expires_at > now()
    order by s.created_at asc, s.id asc
    limit 1
    for update;

    if found then
        if v_session.source_type = 'personal' then
            select *
            into v_personal
            from public.necklace_lumis l
            where l.id = v_session.necklace_lumi_id;

            if found then
                return jsonb_build_object(
                    'status', 'ready',
                    'reveal_session_id', v_session.id,
                    'necklace_display_name', v_necklace.name,
                    'lumi_id', v_personal.id,
                    'lumi_text', v_personal.content,
                    'presentation', jsonb_build_object(
                        'theme', coalesce(v_personal.theme_key, v_necklace.theme_key, 'heart'),
                        'animation', coalesce(v_personal.animation_key, 'breathe'),
                        'sound', coalesce(v_personal.sound_key, 'soft')
                    )
                );
            end if;
        else
            select *
            into v_reserve_message
            from public.messages m
            where m.id = v_session.reserve_message_id;

            if found then
                return jsonb_build_object(
                    'status', 'ready',
                    'reveal_session_id', v_session.id,
                    'necklace_display_name', v_necklace.name,
                    'lumi_id', v_reserve_message.id,
                    'lumi_text', coalesce(v_reserve_message.text, v_reserve_message.content),
                    'presentation', jsonb_build_object(
                        'theme', coalesce(v_reserve_message.theme_key, v_necklace.theme_key, 'heart'),
                        'animation', coalesce(v_reserve_message.animation_key, 'breathe'),
                        'sound', coalesce(v_reserve_message.sound_key, 'soft')
                    )
                );
            end if;
        end if;
    end if;

    select *
    into v_personal
    from public.necklace_lumis l
    where l.necklace_id = v_necklace.id
      and l.is_enabled = true
      and l.revealed_at is null
    order by l.queue_position asc, l.created_at asc, l.id asc
    limit 1
    for update;

    if found and v_personal.eligible_from is not null and v_personal.eligible_from > now() then
        begin
            insert into public.tap_events (
                necklace_id,
                necklace_lumi_id,
                status,
                context
            )
            values (
                v_necklace.id,
                v_personal.id,
                'tap_empty',
                jsonb_build_object(
                    'source', 'recipient_resolve',
                    'reason', 'not_eligible_yet'
                )
            );
        exception when others then null;
        end;
        return jsonb_build_object('status', 'empty');
    end if;

    if found then
        v_session_id := gen_random_uuid();
        v_expires_at := now() + interval '12 minutes';

        insert into public.lumi_reveal_sessions (
            id,
            necklace_id,
            source_type,
            necklace_lumi_id,
            reserve_message_id,
            created_at,
            expires_at
        )
        values (
            v_session_id,
            v_necklace.id,
            'personal',
            v_personal.id,
            null,
            now(),
            v_expires_at
        );

        v_theme := coalesce(v_personal.theme_key, v_necklace.theme_key, 'heart');
        v_animation := coalesce(v_personal.animation_key, 'breathe');
        v_sound := coalesce(v_personal.sound_key, 'soft');

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
                v_personal.id,
                v_session_id,
                'tap_ready',
                jsonb_build_object('source', 'recipient_resolve')
            );
        exception when others then null;
        end;

        return jsonb_build_object(
            'status', 'ready',
            'reveal_session_id', v_session_id,
            'necklace_display_name', v_necklace.name,
            'lumi_id', v_personal.id,
            'lumi_text', v_personal.content,
            'presentation', jsonb_build_object(
                'theme', v_theme,
                'animation', v_animation,
                'sound', v_sound
            )
        );
    end if;

    select ri.*
    into v_reserve_item
    from public.necklace_reserve_settings settings
    join public.necklace_reserve_items ri
      on ri.necklace_id = settings.necklace_id
    join public.messages m
      on m.id = ri.message_id
    where settings.necklace_id = v_necklace.id
      and settings.is_enabled = true
      and ri.is_approved = true
      and m.is_active = true
      and m.is_reserve_eligible = true
    order by
        ri.last_revealed_at asc nulls first,
        m.reserve_sort_order asc nulls last,
        m.id asc
    limit 1
    for update of ri;

    if not found then
        begin
            insert into public.tap_events (necklace_id, status, context)
            values (
                v_necklace.id,
                'tap_empty',
                jsonb_build_object('source', 'recipient_resolve')
            );
        exception when others then null;
        end;
        return jsonb_build_object('status', 'empty');
    end if;

    select *
    into v_reserve_message
    from public.messages m
    where m.id = v_reserve_item.message_id;

    if not found then
        return jsonb_build_object('status', 'empty');
    end if;

    v_session_id := gen_random_uuid();
    v_expires_at := now() + interval '12 minutes';
    v_theme := coalesce(v_reserve_message.theme_key, v_necklace.theme_key, 'heart');
    v_animation := coalesce(v_reserve_message.animation_key, 'breathe');
    v_sound := coalesce(v_reserve_message.sound_key, 'soft');

    insert into public.lumi_reveal_sessions (
        id,
        necklace_id,
        source_type,
        necklace_lumi_id,
        reserve_message_id,
        created_at,
        expires_at
    )
    values (
        v_session_id,
        v_necklace.id,
        'reserve',
        null,
        v_reserve_message.id,
        now(),
        v_expires_at
    );

    begin
        insert into public.tap_events (
            necklace_id,
            reserve_message_id,
            reveal_session_id,
            status,
            context
        )
        values (
            v_necklace.id,
            v_reserve_message.id,
            v_session_id,
            'tap_ready',
            jsonb_build_object('source', 'recipient_resolve')
        );
    exception when others then null;
    end;

    return jsonb_build_object(
        'status', 'ready',
        'reveal_session_id', v_session_id,
        'necklace_display_name', v_necklace.name,
        'lumi_id', v_reserve_message.id,
        'lumi_text', coalesce(v_reserve_message.text, v_reserve_message.content),
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
    v_personal public.necklace_lumis%rowtype;
    v_reserve_item public.necklace_reserve_items%rowtype;
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

    if v_session.completed_at is not null then
        return jsonb_build_object(
            'status', 'revealed',
            'revealed_at', v_session.revealed_at
        );
    end if;

    if v_session.expires_at <= now() then
        return jsonb_build_object('status', 'expired');
    end if;

    v_revealed_at := now();

    if v_session.source_type = 'personal' then
        select *
        into v_personal
        from public.necklace_lumis l
        where l.id = v_session.necklace_lumi_id
        for update;

        if not found then
            return jsonb_build_object('status', 'unavailable');
        end if;

        v_revealed_at := coalesce(v_personal.revealed_at, v_revealed_at);

        update public.necklace_lumis
        set revealed_at = v_revealed_at
        where id = v_personal.id
          and revealed_at is null;
    else
        select *
        into v_reserve_item
        from public.necklace_reserve_items ri
        where ri.necklace_id = v_session.necklace_id
          and ri.message_id = v_session.reserve_message_id
        for update;

        if not found then
            return jsonb_build_object('status', 'unavailable');
        end if;

        update public.necklace_reserve_items
        set
            last_revealed_at = v_revealed_at,
            reveal_count = reveal_count + 1
        where necklace_id = v_reserve_item.necklace_id
          and message_id = v_reserve_item.message_id;
    end if;

    update public.lumi_reveal_sessions
    set
        completed_at = v_revealed_at,
        revealed_at = v_revealed_at
    where id = v_session.id;

    begin
        insert into public.tap_events (
            necklace_id,
            necklace_lumi_id,
            reserve_message_id,
            reveal_session_id,
            status,
            context
        )
        values (
            v_session.necklace_id,
            v_session.necklace_lumi_id,
            v_session.reserve_message_id,
            v_session.id,
            'lumi_revealed',
            jsonb_build_object('source', 'recipient_reveal')
        );
    exception when unique_violation then null;
    end;

    return jsonb_build_object(
        'status', 'revealed',
        'revealed_at', v_revealed_at
    );
end;
$$;

revoke execute on function public.resolve_next_necklace_lumi(text)
from public, anon, authenticated;
grant execute on function public.resolve_next_necklace_lumi(text)
to service_role;

revoke execute on function public.confirm_necklace_lumi_reveal(uuid)
from public, anon, authenticated;
grant execute on function public.confirm_necklace_lumi_reveal(uuid)
to service_role;
