-- Sender-first Lumi schema for Supabase (v1)
create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text not null unique,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    external_order_ref text unique,
    purchaser_email_normalized text not null,
    status text not null default 'pending_claim' check (status in ('pending_claim', 'claimed', 'fulfilled')),
    created_at timestamptz not null default now(),
    claimed_at timestamptz
);

create table if not exists public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    sku text not null,
    quantity int not null default 1 check (quantity > 0),
    created_at timestamptz not null default now()
);

create table if not exists public.necklaces (
    id uuid primary key default gen_random_uuid(),
    tag_ref text unique,
    tap_token_hash text unique not null,
    sku text not null,
    name text not null default 'Lumi Necklace',
    theme_key text not null default 'heart',
    lifecycle_status text not null default 'pending_sender_setup' check (
        lifecycle_status in ('pending_sender_setup', 'active', 'inactive')
    ),
    created_at timestamptz not null default now()
);

create table if not exists public.necklace_ownerships (
    id uuid primary key default gen_random_uuid(),
    necklace_id uuid not null references public.necklaces (id) on delete cascade,
    sender_user_id uuid not null references auth.users (id) on delete cascade,
    source_order_id uuid references public.orders (id),
    claimed_at timestamptz not null default now(),
    is_primary boolean not null default false
);

create unique index if not exists necklace_ownerships_one_sender_per_necklace
    on public.necklace_ownerships (necklace_id);

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    necklace_id uuid not null references public.necklaces (id) on delete cascade,
    author_user_id uuid not null references auth.users (id) on delete cascade,
    content text not null,
    state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
    theme_key text not null default 'heart',
    animation_key text not null default 'breathe',
    sound_key text not null default 'soft',
    eligible_from timestamptz,
    eligible_until timestamptz,
    published_at timestamptz,
    created_at timestamptz not null default now()
);

-- Normalize legacy messages schemas so this migration can run on existing projects.
alter table public.messages
    add column if not exists necklace_id uuid references public.necklaces (id) on delete cascade,
    add column if not exists author_user_id uuid references auth.users (id) on delete cascade,
    add column if not exists content text,
    add column if not exists state text,
    add column if not exists theme_key text,
    add column if not exists animation_key text,
    add column if not exists sound_key text,
    add column if not exists eligible_from timestamptz,
    add column if not exists eligible_until timestamptz,
    add column if not exists published_at timestamptz,
    add column if not exists created_at timestamptz default now();

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'messages'
          and column_name = 'text'
    ) then
        execute 'update public.messages set content = coalesce(content, text, '''') where content is null';
    else
        execute 'update public.messages set content = coalesce(content, '''') where content is null';
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'messages'
          and column_name = 'is_active'
    ) then
        execute 'update public.messages set state = coalesce(state, case when is_active then ''published'' else ''draft'' end) where state is null';
    else
        execute 'update public.messages set state = coalesce(state, ''draft'') where state is null';
    end if;
end;
$$;

update public.messages
set theme_key = coalesce(theme_key, 'heart'),
    animation_key = coalesce(animation_key, 'breathe'),
    sound_key = coalesce(sound_key, 'soft'),
    created_at = coalesce(created_at, now())
where theme_key is null
   or animation_key is null
   or sound_key is null
   or created_at is null;

alter table public.messages
    alter column content set default '',
    alter column content set not null,
    alter column state set default 'draft',
    alter column state set not null,
    alter column theme_key set default 'heart',
    alter column theme_key set not null,
    alter column animation_key set default 'breathe',
    alter column animation_key set not null,
    alter column sound_key set default 'soft',
    alter column sound_key set not null,
    alter column created_at set default now(),
    alter column created_at set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'messages_state_check'
          and conrelid = 'public.messages'::regclass
    ) then
        alter table public.messages
            add constraint messages_state_check
            check (state in ('draft', 'published', 'archived'));
    end if;
exception
    when duplicate_object then
        null;
end;
$$;

create index if not exists messages_necklace_published_idx
    on public.messages (necklace_id, published_at desc)
    where state = 'published';

create table if not exists public.tap_events (
    id uuid primary key default gen_random_uuid(),
    necklace_id uuid references public.necklaces (id) on delete set null,
    resolved_message_id uuid references public.messages (id) on delete set null,
    status text not null,
    tapped_at timestamptz not null default now(),
    context jsonb not null default '{}'::jsonb
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.necklaces enable row level security;
alter table public.necklace_ownerships enable row level security;
alter table public.messages enable row level security;
alter table public.tap_events enable row level security;

drop policy if exists profiles_owner_read on public.profiles;
create policy profiles_owner_read on public.profiles
    for select using (id = auth.uid());

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles
    for update using (id = auth.uid());

drop policy if exists ownership_sender_read on public.necklace_ownerships;
create policy ownership_sender_read on public.necklace_ownerships
    for select using (sender_user_id = auth.uid());

drop policy if exists necklace_sender_read on public.necklaces;
create policy necklace_sender_read on public.necklaces
    for select using (
        exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = necklaces.id
              and own.sender_user_id = auth.uid()
        )
    );

drop policy if exists messages_sender_read on public.messages;
create policy messages_sender_read on public.messages
    for select using (
        exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = messages.necklace_id
              and own.sender_user_id = auth.uid()
        )
    );

drop policy if exists messages_sender_write on public.messages;
create policy messages_sender_write on public.messages
    for insert with check (
        author_user_id = auth.uid()
        and exists (
            select 1
            from public.necklace_ownerships own
            where own.necklace_id = messages.necklace_id
              and own.sender_user_id = auth.uid()
        )
    );

create or replace function public.claim_pending_orders_for_user(
    p_user_id uuid default auth.uid(),
    p_email text default null
)
returns table(claimed_order_id uuid, claimed_necklace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
    normalized_email text;
begin
    if p_user_id is null then
        raise exception 'unauthorized';
    end if;

    normalized_email := lower(coalesce(p_email, (select email from auth.users where id = p_user_id)));
    if normalized_email is null then
        return;
    end if;

    return query
    with candidate_orders as (
        select o.id
        from public.orders o
        where o.purchaser_email_normalized = normalized_email
          and o.status in ('pending_claim', 'claimed')
    ),
    linked_necklaces as (
        select n.id as necklace_id, o.id as order_id
        from candidate_orders o
        join public.order_items oi on oi.order_id = o.id
        join public.necklaces n on n.sku = oi.sku
    ),
    inserted as (
        insert into public.necklace_ownerships (necklace_id, sender_user_id, source_order_id, is_primary)
        select ln.necklace_id, p_user_id, ln.order_id, false
        from linked_necklaces ln
        on conflict (necklace_id) do nothing
        returning source_order_id, necklace_id
    ),
    updated_orders as (
        update public.orders o
        set status = 'claimed',
            claimed_at = now()
        where o.id in (select source_order_id from inserted)
        returning o.id
    )
    select uo.id as claimed_order_id, i.necklace_id as claimed_necklace_id
    from updated_orders uo
    join inserted i on i.source_order_id = uo.id;
end;
$$;

create or replace function public.resolve_tap_message(
    p_tap_token text,
    p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    token_hash text;
    v_necklace record;
    v_message record;
    response jsonb;
begin
    if p_tap_token is null or length(trim(p_tap_token)) = 0 then
        return jsonb_build_object(
            'status', 'fallback_ready',
            'message', jsonb_build_object(
                'text', 'Your Lumi is warming up. Tap again soon.',
                'packageId', 'love'
            ),
            'experience', jsonb_build_object(
                'themeKey', 'heart',
                'animationKey', 'breathe',
                'soundKey', 'soft'
            )
        );
    end if;

    token_hash := encode(digest(p_tap_token, 'sha256'), 'hex');

    select *
    into v_necklace
    from public.necklaces n
    where n.tap_token_hash = token_hash
    limit 1;

    if v_necklace is null then
        insert into public.tap_events (status, context)
        values ('unknown_token', p_context);

        return jsonb_build_object(
            'status', 'fallback_ready',
            'message', jsonb_build_object(
                'text', 'Welcome to Lumi. Your personalized message will appear soon.',
                'packageId', 'love'
            ),
            'experience', jsonb_build_object(
                'themeKey', 'heart',
                'animationKey', 'breathe',
                'soundKey', 'soft'
            )
        );
    end if;

    select *
    into v_message
    from public.messages m
    where m.necklace_id = v_necklace.id
      and m.state = 'published'
      and (m.eligible_from is null or m.eligible_from <= now())
      and (m.eligible_until is null or m.eligible_until > now())
    order by m.published_at desc nulls last, m.created_at desc
    limit 1;

    if v_message is null then
        insert into public.tap_events (necklace_id, status, context)
        values (v_necklace.id, 'fallback_ready', p_context);

        return jsonb_build_object(
            'status', 'fallback_ready',
            'message', jsonb_build_object(
                'text', 'Your Lumi is ready for a custom message soon.',
                'packageId', 'love'
            ),
            'experience', jsonb_build_object(
                'themeKey', v_necklace.theme_key,
                'animationKey', 'breathe',
                'soundKey', 'soft'
            )
        );
    end if;

    insert into public.tap_events (necklace_id, resolved_message_id, status, context)
    values (v_necklace.id, v_message.id, 'message_ready', p_context);

    response := jsonb_build_object(
        'status', 'message_ready',
        'message', jsonb_build_object(
            'id', v_message.id,
            'text', v_message.content,
            'packageId', 'love'
        ),
        'experience', jsonb_build_object(
            'themeKey', coalesce(v_message.theme_key, v_necklace.theme_key),
            'animationKey', coalesce(v_message.animation_key, 'breathe'),
            'soundKey', coalesce(v_message.sound_key, 'soft')
        )
    );

    return response;
end;
$$;
