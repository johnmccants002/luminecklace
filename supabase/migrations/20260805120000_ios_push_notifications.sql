-- Durable, private iOS push-notification outbox.
create table public.push_devices (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    device_token text not null,
    platform text not null default 'ios',
    bundle_id text not null,
    apns_environment text not null,
    app_version text,
    device_model text,
    is_active boolean not null default true,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint push_devices_platform_check check (platform = 'ios'),
    constraint push_devices_bundle_id_check check (
        bundle_id = 'luminecklace.luminecklace'
    ),
    constraint push_devices_environment_check check (
        apns_environment in ('sandbox', 'production')
    ),
    constraint push_devices_token_check check (
        device_token = lower(device_token)
        and device_token ~ '^[0-9a-f]{64,200}$'
        and char_length(device_token) % 2 = 0
    ),
    constraint push_devices_installation_key unique (
        bundle_id, apns_environment, device_token
    )
);

create index push_devices_user_active_idx
    on public.push_devices (user_id, is_active);

create trigger push_devices_set_updated_at
before update on public.push_devices
for each row execute function public.set_updated_at();

create table public.push_preferences (
    user_id uuid primary key references auth.users (id) on delete cascade,
    reveals_enabled boolean not null default true,
    reactions_enabled boolean not null default true,
    responses_enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger push_preferences_set_updated_at
before update on public.push_preferences
for each row execute function public.set_updated_at();

create table public.push_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    event_type text not null check (
        event_type in ('lumi.revealed', 'lumi.reacted', 'lumi.responded')
    ),
    necklace_id uuid not null references public.necklaces (id) on delete cascade,
    necklace_lumi_id uuid not null
        references public.necklace_lumis (id) on delete cascade,
    reveal_session_id uuid not null
        references public.lumi_reveal_sessions (id) on delete cascade,
    dedupe_key text not null unique,
    payload jsonb not null,
    created_at timestamptz not null default now(),
    constraint push_events_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create index push_events_user_created_idx
    on public.push_events (user_id, created_at desc);

create table public.push_deliveries (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.push_events (id) on delete cascade,
    device_id uuid not null references public.push_devices (id) on delete cascade,
    status text not null default 'pending' check (
        status in ('pending', 'processing', 'retry', 'sent', 'invalid_token', 'failed')
    ),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    available_at timestamptz not null default now(),
    claim_token uuid,
    apns_id text,
    last_error_code text,
    last_error_message text,
    last_attempted_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint push_deliveries_event_device_key unique (event_id, device_id)
);

create index push_deliveries_dispatch_idx
    on public.push_deliveries (available_at, created_at)
    where status in ('pending', 'retry', 'processing');

create trigger push_deliveries_set_updated_at
before update on public.push_deliveries
for each row execute function public.set_updated_at();

alter table public.push_devices enable row level security;
alter table public.push_preferences enable row level security;
alter table public.push_events enable row level security;
alter table public.push_deliveries enable row level security;

revoke all on table public.push_devices from public, anon, authenticated;
revoke all on table public.push_preferences from public, anon, authenticated;
revoke all on table public.push_events from public, anon, authenticated;
revoke all on table public.push_deliveries from public, anon, authenticated;

grant all on table public.push_devices to service_role;
grant all on table public.push_preferences to service_role;
grant all on table public.push_events to service_role;
grant all on table public.push_deliveries to service_role;

-- Called only by trusted trigger functions. It resolves the owner, inserts one
-- logical event, then fans out to eligible active devices in the same transaction.
create function public.enqueue_lumi_push_event(
    p_event_type text,
    p_necklace_id uuid,
    p_necklace_lumi_id uuid,
    p_reveal_session_id uuid,
    p_reaction_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_event_id uuid;
    v_allowed boolean;
    v_payload jsonb;
begin
    if p_event_type not in ('lumi.revealed', 'lumi.reacted', 'lumi.responded') then
        raise exception 'unsupported push event type';
    end if;

    select own.sender_user_id
    into v_user_id
    from public.necklace_ownerships own
    where own.necklace_id = p_necklace_id
    limit 1;

    if v_user_id is null then
        return false;
    end if;

    v_payload := jsonb_build_object(
        'type', p_event_type,
        'necklaceId', p_necklace_id,
        'lumiId', p_necklace_lumi_id,
        'revealSessionId', p_reveal_session_id
    );
    if p_event_type = 'lumi.reacted' then
        v_payload := v_payload || jsonb_build_object('reaction', p_reaction_key);
    end if;

    insert into public.push_events (
        user_id,
        event_type,
        necklace_id,
        necklace_lumi_id,
        reveal_session_id,
        dedupe_key,
        payload
    )
    values (
        v_user_id,
        p_event_type,
        p_necklace_id,
        p_necklace_lumi_id,
        p_reveal_session_id,
        case p_event_type
            when 'lumi.revealed' then 'reveal:' || p_reveal_session_id::text
            when 'lumi.reacted' then 'reaction:' || p_reveal_session_id::text
            else 'response:' || p_reveal_session_id::text
        end,
        v_payload
    )
    on conflict (dedupe_key) do nothing
    returning id into v_event_id;

    if v_event_id is null then
        return false;
    end if;

    select case p_event_type
        when 'lumi.revealed' then coalesce(pref.reveals_enabled, true)
        when 'lumi.reacted' then coalesce(pref.reactions_enabled, true)
        else coalesce(pref.responses_enabled, true)
    end
    into v_allowed
    from (select v_user_id as user_id) owner
    left join public.push_preferences pref on pref.user_id = owner.user_id;

    if coalesce(v_allowed, true) then
        insert into public.push_deliveries (event_id, device_id)
        select v_event_id, device.id
        from public.push_devices device
        where device.user_id = v_user_id
          and device.is_active = true
        on conflict (event_id, device_id) do nothing;
    end if;

    return true;
end;
$$;

create function public.enqueue_reveal_push_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.revealed_at is null and new.revealed_at is not null then
        perform public.enqueue_lumi_push_event(
            'lumi.revealed',
            new.necklace_id,
            new.necklace_lumi_id,
            new.id,
            null
        );
    end if;
    return new;
end;
$$;

create trigger lumi_reveal_sessions_enqueue_push
after update of revealed_at on public.lumi_reveal_sessions
for each row execute function public.enqueue_reveal_push_event();

create function public.enqueue_feedback_push_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_necklace_id uuid;
begin
    select session.necklace_id
    into v_necklace_id
    from public.lumi_reveal_sessions session
    where session.id = new.reveal_session_id;

    if v_necklace_id is null then
        return new;
    end if;

    if new.reaction_key is not null
       and (tg_op = 'INSERT' or old.reaction_key is null) then
        perform public.enqueue_lumi_push_event(
            'lumi.reacted',
            v_necklace_id,
            new.necklace_lumi_id,
            new.reveal_session_id,
            new.reaction_key
        );
    end if;

    if new.response_text is not null
       and (tg_op = 'INSERT' or old.response_text is null) then
        perform public.enqueue_lumi_push_event(
            'lumi.responded',
            v_necklace_id,
            new.necklace_lumi_id,
            new.reveal_session_id,
            null
        );
    end if;

    return new;
end;
$$;

create trigger lumi_reveal_feedback_enqueue_push
after insert or update of reaction_key, response_text
on public.lumi_reveal_feedback
for each row execute function public.enqueue_feedback_push_events();

create function public.register_push_device(
    p_user_id uuid,
    p_device_token text,
    p_environment text,
    p_bundle_id text,
    p_app_version text default null,
    p_device_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_device public.push_devices%rowtype;
begin
    perform pg_advisory_xact_lock(
        hashtextextended(p_bundle_id || ':' || p_environment || ':' || p_device_token, 0)
    );

    select *
    into v_device
    from public.push_devices device
    where device.bundle_id = p_bundle_id
      and device.apns_environment = p_environment
      and device.device_token = p_device_token
    for update;

    if not found then
        insert into public.push_devices (
            user_id,
            device_token,
            bundle_id,
            apns_environment,
            app_version,
            device_model
        )
        values (
            p_user_id,
            p_device_token,
            p_bundle_id,
            p_environment,
            p_app_version,
            p_device_model
        )
        returning * into v_device;
        return v_device.id;
    end if;

    if v_device.user_id <> p_user_id then
        update public.push_deliveries
        set status = 'failed',
            claim_token = null,
            last_error_code = 'DEVICE_REASSIGNED',
            last_error_message = 'Device registration moved to another account'
        where device_id = v_device.id
          and status in ('pending', 'retry', 'processing');
    end if;

    update public.push_devices
    set user_id = p_user_id,
        app_version = p_app_version,
        device_model = p_device_model,
        is_active = true,
        last_seen_at = now()
    where id = v_device.id;

    return v_device.id;
end;
$$;

create function public.deactivate_push_device(
    p_user_id uuid,
    p_device_token text,
    p_environment text,
    p_bundle_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_device_id uuid;
begin
    perform pg_advisory_xact_lock(
        hashtextextended(p_bundle_id || ':' || p_environment || ':' || p_device_token, 0)
    );

    update public.push_devices device
    set is_active = false
    where device.user_id = p_user_id
      and device.device_token = p_device_token
      and device.apns_environment = p_environment
      and device.bundle_id = p_bundle_id
      and device.is_active = true
    returning device.id into v_device_id;

    if v_device_id is null then
        return false;
    end if;

    update public.push_deliveries
    set status = 'failed',
        claim_token = null,
        last_error_code = 'DEVICE_DEACTIVATED',
        last_error_message = 'Device was deactivated before delivery'
    where device_id = v_device_id
      and status in ('pending', 'retry', 'processing');

    return true;
end;
$$;

-- Atomically claims a bounded batch. A claim token prevents a stale worker from
-- overwriting the result of a delivery that another worker reclaimed.
create function public.claim_push_deliveries(p_limit integer default 25)
returns table (
    delivery_id uuid,
    claim_token uuid,
    attempt_count integer,
    device_token text,
    apns_environment text,
    bundle_id text,
    event_type text,
    event_payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.push_deliveries delivery
    set status = 'failed',
        claim_token = null,
        last_error_code = 'RETRY_LIMIT',
        last_error_message = 'Delivery retry limit reached'
    where delivery.attempt_count >= 8
      and (
          (delivery.status in ('pending', 'retry') and delivery.available_at <= now())
          or (
              delivery.status = 'processing'
              and delivery.last_attempted_at < now() - interval '5 minutes'
          )
      );

    return query
    with candidates as (
        select delivery.id
        from public.push_deliveries delivery
        join public.push_devices device on device.id = delivery.device_id
        join public.push_events event on event.id = delivery.event_id
        where device.is_active = true
          and event.user_id = device.user_id
          and delivery.attempt_count < 8
          and (
              (delivery.status in ('pending', 'retry') and delivery.available_at <= now())
              or (
                  delivery.status = 'processing'
                  and delivery.last_attempted_at < now() - interval '5 minutes'
              )
          )
        order by delivery.available_at, delivery.created_at
        limit least(greatest(coalesce(p_limit, 25), 1), 100)
        for update of delivery skip locked
    ), claimed as (
        update public.push_deliveries delivery
        set status = 'processing',
            attempt_count = delivery.attempt_count + 1,
            last_attempted_at = now(),
            claim_token = gen_random_uuid(),
            last_error_code = null,
            last_error_message = null
        from candidates
        where delivery.id = candidates.id
        returning delivery.*
    )
    select
        claimed.id,
        claimed.claim_token,
        claimed.attempt_count,
        device.device_token,
        device.apns_environment,
        device.bundle_id,
        event.event_type,
        event.payload
    from claimed
    join public.push_devices device on device.id = claimed.device_id
    join public.push_events event on event.id = claimed.event_id;
end;
$$;

create function public.finalize_push_delivery(
    p_delivery_id uuid,
    p_claim_token uuid,
    p_status text,
    p_apns_id text default null,
    p_error_code text default null,
    p_error_message text default null,
    p_available_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_device_id uuid;
begin
    if p_status not in ('retry', 'sent', 'invalid_token', 'failed') then
        raise exception 'unsupported delivery status';
    end if;

    update public.push_deliveries delivery
    set status = p_status,
        claim_token = null,
        apns_id = left(p_apns_id, 128),
        last_error_code = left(p_error_code, 128),
        last_error_message = left(p_error_message, 500),
        available_at = case
            when p_status = 'retry' then coalesce(p_available_at, now() + interval '1 minute')
            else delivery.available_at
        end,
        sent_at = case when p_status = 'sent' then now() else null end
    where delivery.id = p_delivery_id
      and delivery.claim_token = p_claim_token
      and delivery.status = 'processing'
    returning delivery.device_id into v_device_id;

    if v_device_id is null then
        return false;
    end if;

    if p_status = 'invalid_token' then
        update public.push_devices
        set is_active = false
        where id = v_device_id;

        update public.push_deliveries
        set status = 'invalid_token',
            claim_token = null,
            last_error_code = coalesce(left(p_error_code, 128), 'InvalidToken'),
            last_error_message = 'APNs rejected this device registration'
        where device_id = v_device_id
          and status in ('pending', 'retry');
    end if;

    return true;
end;
$$;

create function public.set_push_preferences(
    p_user_id uuid,
    p_reveals_enabled boolean default null,
    p_reactions_enabled boolean default null,
    p_responses_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_preferences public.push_preferences%rowtype;
begin
    insert into public.push_preferences (
        user_id, reveals_enabled, reactions_enabled, responses_enabled
    )
    values (
        p_user_id,
        coalesce(p_reveals_enabled, true),
        coalesce(p_reactions_enabled, true),
        coalesce(p_responses_enabled, true)
    )
    on conflict (user_id) do update
    set reveals_enabled = coalesce(p_reveals_enabled, push_preferences.reveals_enabled),
        reactions_enabled = coalesce(p_reactions_enabled, push_preferences.reactions_enabled),
        responses_enabled = coalesce(p_responses_enabled, push_preferences.responses_enabled)
    returning * into v_preferences;

    return jsonb_build_object(
        'reveals_enabled', v_preferences.reveals_enabled,
        'reactions_enabled', v_preferences.reactions_enabled,
        'responses_enabled', v_preferences.responses_enabled
    );
end;
$$;

revoke execute on function public.enqueue_lumi_push_event(text, uuid, uuid, uuid, text)
from public, anon, authenticated;
revoke execute on function public.enqueue_reveal_push_event()
from public, anon, authenticated;
revoke execute on function public.enqueue_feedback_push_events()
from public, anon, authenticated;
revoke execute on function public.register_push_device(uuid, text, text, text, text, text)
from public, anon, authenticated;
revoke execute on function public.deactivate_push_device(uuid, text, text, text)
from public, anon, authenticated;
revoke execute on function public.claim_push_deliveries(integer)
from public, anon, authenticated;
revoke execute on function public.finalize_push_delivery(uuid, uuid, text, text, text, text, timestamptz)
from public, anon, authenticated;
revoke execute on function public.set_push_preferences(uuid, boolean, boolean, boolean)
from public, anon, authenticated;

grant execute on function public.claim_push_deliveries(integer) to service_role;
grant execute on function public.register_push_device(uuid, text, text, text, text, text)
to service_role;
grant execute on function public.deactivate_push_device(uuid, text, text, text)
to service_role;
grant execute on function public.finalize_push_delivery(uuid, uuid, text, text, text, text, timestamptz)
to service_role;
grant execute on function public.set_push_preferences(uuid, boolean, boolean, boolean)
to service_role;

comment on table public.push_devices is
    'Private APNs installations owned by authenticated full-app users.';
comment on table public.push_events is
    'Private deduplicated product-event outbox; payloads contain no message or response text.';
comment on table public.push_deliveries is
    'Private per-device APNs delivery state with retry and invalid-token handling.';
