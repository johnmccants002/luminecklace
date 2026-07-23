-- Shopify paid-order ingestion, per-unit allocation, and resumable account provisioning.

-- The profiles table can predate the sender-first schema. Normalize the
-- columns this migration uses before syncing authoritative Auth emails.
alter table public.profiles
    add column if not exists email text,
    add column if not exists display_name text,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
    add column if not exists email_normalized text
        generated always as (lower(btrim(email))) stored;

create unique index if not exists profiles_email_normalized_unique
    on public.profiles (email_normalized);

insert into public.profiles (id, email)
select u.id, lower(btrim(u.email))
from auth.users u
where u.email is not null
on conflict (id) do update
set email = excluded.email,
    updated_at = now();

create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.email is null then
        return new;
    end if;

    insert into public.profiles (id, email)
    values (new.id, lower(btrim(new.email)))
    on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

    return new;
end;
$$;

drop trigger if exists auth_users_sync_profile_email on auth.users;
create trigger auth_users_sync_profile_email
after insert or update of email on auth.users
for each row execute function public.sync_profile_email_from_auth();

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles
    for update
    using (id = auth.uid())
    with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Normalize legacy order tables for projects where the original
-- CREATE TABLE IF NOT EXISTS encountered an older relation.
alter table public.orders
    add column if not exists external_order_ref text,
    add column if not exists purchaser_email_normalized text,
    add column if not exists status text not null default 'pending_claim',
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists claimed_at timestamptz;

alter table public.orders
    alter column purchaser_email_normalized drop not null,
    add column if not exists shop_domain text,
    add column if not exists shopify_order_id text,
    add column if not exists purchaser_auth_user_id uuid references auth.users (id),
    add column if not exists ingestion_outcome text not null default 'processing',
    add column if not exists shopify_created_at timestamptz,
    add column if not exists shopify_updated_at timestamptz,
    add column if not exists processed_at timestamptz,
    add column if not exists cancelled_at timestamptz,
    add column if not exists currency text,
    add column if not exists presentment_currency text,
    add column if not exists financial_status text,
    add column if not exists subtotal_price numeric(14, 2),
    add column if not exists current_subtotal_price numeric(14, 2),
    add column if not exists total_discounts numeric(14, 2),
    add column if not exists current_total_discounts numeric(14, 2),
    add column if not exists total_shipping numeric(14, 2),
    add column if not exists current_total_shipping numeric(14, 2),
    add column if not exists total_tax numeric(14, 2),
    add column if not exists current_total_tax numeric(14, 2),
    add column if not exists total_price numeric(14, 2),
    add column if not exists current_total_price numeric(14, 2),
    add column if not exists total_outstanding numeric(14, 2);

alter table public.orders
    drop constraint if exists orders_ingestion_outcome_check;
alter table public.orders
    add constraint orders_ingestion_outcome_check
    check (ingestion_outcome in ('processing', 'ready', 'ignored', 'manual_review'));

create unique index if not exists orders_shopify_identity_unique
    on public.orders (shop_domain, shopify_order_id)
    where shop_domain is not null and shopify_order_id is not null;

create index if not exists orders_pending_purchaser_email_idx
    on public.orders (purchaser_email_normalized)
    where purchaser_auth_user_id is null
      and ingestion_outcome = 'ready';

alter table public.order_items
    add column if not exists order_id uuid references public.orders (id) on delete cascade,
    add column if not exists sku text,
    add column if not exists quantity integer not null default 1,
    add column if not exists created_at timestamptz not null default now();

alter table public.order_items
    alter column sku drop not null,
    add column if not exists shopify_line_item_id text,
    add column if not exists shopify_product_id text,
    add column if not exists shopify_variant_id text,
    add column if not exists title text,
    add column if not exists current_quantity integer,
    add column if not exists unit_price numeric(14, 2),
    add column if not exists total_discount numeric(14, 2),
    add column if not exists is_lumi_eligible boolean not null default false;

create unique index if not exists order_items_shopify_line_unique
    on public.order_items (order_id, shopify_line_item_id)
    where shopify_line_item_id is not null;

create table if not exists public.order_item_units (
    id uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references public.order_items (id) on delete cascade,
    unit_ordinal integer not null check (unit_ordinal > 0),
    allocation_status text not null default 'awaiting_necklace'
        check (allocation_status = 'awaiting_necklace'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (order_item_id, unit_ordinal)
);

drop trigger if exists order_item_units_set_updated_at on public.order_item_units;
create trigger order_item_units_set_updated_at
before update on public.order_item_units
for each row execute function public.set_updated_at();

create table if not exists public.shopify_webhook_deliveries (
    id uuid primary key default gen_random_uuid(),
    shop_domain text not null,
    shopify_webhook_id text not null,
    topic text not null,
    order_id uuid references public.orders (id) on delete set null,
    processing_state text not null default 'processing'
        check (processing_state in ('processing', 'processed', 'retryable_error')),
    outcome text
        check (outcome is null or outcome in ('ready', 'ignored', 'manual_review')),
    attempt_count integer not null default 1 check (attempt_count > 0),
    last_error text,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (shop_domain, shopify_webhook_id)
);

create table if not exists public.account_provisioning (
    email_normalized text primary key
        check (email_normalized = lower(btrim(email_normalized))),
    auth_user_id uuid references auth.users (id) on delete set null,
    status text not null default 'pending'
        check (status in (
            'pending',
            'invite_in_progress',
            'invite_sent',
            'existing_unconfirmed',
            'confirmed',
            'retryable_error'
        )),
    invite_attempt_count integer not null default 0 check (invite_attempt_count >= 0),
    invite_sent_at timestamptz,
    recovery_sent_at timestamptz,
    lease_token uuid,
    lease_expires_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.order_item_units enable row level security;
alter table public.shopify_webhook_deliveries enable row level security;
alter table public.account_provisioning enable row level security;

revoke all on public.order_item_units from anon, authenticated;
revoke all on public.shopify_webhook_deliveries from anon, authenticated;
revoke all on public.account_provisioning from anon, authenticated;

create or replace function public.find_shopify_auth_user(p_email text)
returns table (
    auth_user_id uuid,
    email_normalized text,
    is_confirmed boolean,
    is_invited boolean
)
language sql
security definer
set search_path = public
as $$
    select
        u.id,
        lower(btrim(u.email)),
        u.email_confirmed_at is not null,
        u.invited_at is not null
    from auth.users u
    where u.email is not null
      and lower(btrim(u.email)) = lower(btrim(p_email))
    order by u.created_at asc
    limit 1;
$$;

revoke execute on function public.find_shopify_auth_user(text)
from public, anon, authenticated;
grant execute on function public.find_shopify_auth_user(text)
to service_role;

create or replace function public.ingest_shopify_paid_order(
    p_shop_domain text,
    p_webhook_id text,
    p_order jsonb,
    p_line_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_delivery public.shopify_webhook_deliveries%rowtype;
    v_order_id uuid;
    v_item_id uuid;
    v_line jsonb;
    v_order_ref text;
    v_shopify_order_id text;
    v_outcome text;
    v_email text;
    v_quantity integer;
    v_is_lumi_eligible boolean;
begin
    v_shopify_order_id := p_order->>'shopify_order_id';
    v_order_ref := p_shop_domain || ':' || v_shopify_order_id;
    v_outcome := p_order->>'ingestion_outcome';
    v_email := nullif(lower(btrim(p_order->>'purchaser_email_normalized')), '');

    perform pg_advisory_xact_lock(
        hashtextextended(p_shop_domain || ':' || v_shopify_order_id, 0)
    );

    select *
    into v_delivery
    from public.shopify_webhook_deliveries
    where shop_domain = p_shop_domain
      and shopify_webhook_id = p_webhook_id
    for update;

    if found and v_delivery.processing_state = 'processed' then
        return jsonb_build_object(
            'replayed', true,
            'order_id', v_delivery.order_id,
            'outcome', v_delivery.outcome
        );
    end if;

    insert into public.orders (
        external_order_ref,
        shop_domain,
        shopify_order_id,
        purchaser_email_normalized,
        ingestion_outcome,
        shopify_created_at,
        shopify_updated_at,
        processed_at,
        cancelled_at,
        currency,
        presentment_currency,
        financial_status,
        subtotal_price,
        current_subtotal_price,
        total_discounts,
        current_total_discounts,
        total_shipping,
        current_total_shipping,
        total_tax,
        current_total_tax,
        total_price,
        current_total_price,
        total_outstanding
    )
    values (
        v_order_ref,
        p_shop_domain,
        v_shopify_order_id,
        v_email,
        v_outcome,
        (p_order->>'shopify_created_at')::timestamptz,
        (p_order->>'shopify_updated_at')::timestamptz,
        (p_order->>'processed_at')::timestamptz,
        nullif(p_order->>'cancelled_at', '')::timestamptz,
        nullif(p_order->>'currency', ''),
        nullif(p_order->>'presentment_currency', ''),
        nullif(p_order->>'financial_status', ''),
        nullif(p_order->>'subtotal_price', '')::numeric,
        nullif(p_order->>'current_subtotal_price', '')::numeric,
        nullif(p_order->>'total_discounts', '')::numeric,
        nullif(p_order->>'current_total_discounts', '')::numeric,
        nullif(p_order->>'total_shipping', '')::numeric,
        nullif(p_order->>'current_total_shipping', '')::numeric,
        nullif(p_order->>'total_tax', '')::numeric,
        nullif(p_order->>'current_total_tax', '')::numeric,
        nullif(p_order->>'total_price', '')::numeric,
        nullif(p_order->>'current_total_price', '')::numeric,
        nullif(p_order->>'total_outstanding', '')::numeric
    )
    on conflict (shop_domain, shopify_order_id)
    where shop_domain is not null and shopify_order_id is not null
    do nothing
    returning id into v_order_id;

    if v_order_id is null then
        select id
        into strict v_order_id
        from public.orders
        where shop_domain = p_shop_domain
          and shopify_order_id = v_shopify_order_id;
    end if;

    for v_line in
        select value from jsonb_array_elements(p_line_items)
    loop
        insert into public.order_items (
            order_id,
            shopify_line_item_id,
            shopify_product_id,
            shopify_variant_id,
            sku,
            title,
            quantity,
            current_quantity,
            unit_price,
            total_discount,
            is_lumi_eligible
        )
        values (
            v_order_id,
            v_line->>'shopify_line_item_id',
            nullif(v_line->>'shopify_product_id', ''),
            nullif(v_line->>'shopify_variant_id', ''),
            nullif(v_line->>'sku', ''),
            nullif(v_line->>'title', ''),
            (v_line->>'quantity')::integer,
            (v_line->>'current_quantity')::integer,
            nullif(v_line->>'unit_price', '')::numeric,
            nullif(v_line->>'total_discount', '')::numeric,
            (v_line->>'is_lumi_eligible')::boolean
        )
        on conflict (order_id, shopify_line_item_id)
        where shopify_line_item_id is not null
        do nothing
        returning id into v_item_id;

        if v_item_id is null then
            select id
            into strict v_item_id
            from public.order_items
            where order_id = v_order_id
              and shopify_line_item_id = v_line->>'shopify_line_item_id';
        end if;

        select quantity, is_lumi_eligible
        into strict v_quantity, v_is_lumi_eligible
        from public.order_items
        where id = v_item_id;

        if v_is_lumi_eligible then
            insert into public.order_item_units (order_item_id, unit_ordinal)
            select v_item_id, ordinal
            from generate_series(1, v_quantity) ordinal
            on conflict (order_item_id, unit_ordinal) do nothing;
        end if;

        v_item_id := null;
    end loop;

    insert into public.shopify_webhook_deliveries (
        shop_domain,
        shopify_webhook_id,
        topic,
        order_id,
        processing_state,
        outcome,
        attempt_count,
        processed_at,
        updated_at
    )
    values (
        p_shop_domain,
        p_webhook_id,
        'orders/paid',
        v_order_id,
        case when v_outcome in ('ignored', 'manual_review')
            then 'processed'
            else 'processing'
        end,
        v_outcome,
        1,
        case when v_outcome in ('ignored', 'manual_review') then now() else null end,
        now()
    )
    on conflict (shop_domain, shopify_webhook_id)
    do update set
        order_id = excluded.order_id,
        processing_state = case
            when public.shopify_webhook_deliveries.processing_state = 'processed'
                then 'processed'
            else excluded.processing_state
        end,
        outcome = excluded.outcome,
        attempt_count = public.shopify_webhook_deliveries.attempt_count + 1,
        last_error = null,
        processed_at = case
            when excluded.processing_state = 'processed' then now()
            else public.shopify_webhook_deliveries.processed_at
        end,
        updated_at = now();

    return jsonb_build_object(
        'replayed', false,
        'order_id', v_order_id,
        'outcome', v_outcome,
        'purchaser_email_normalized', v_email
    );
end;
$$;

revoke execute on function public.ingest_shopify_paid_order(text, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.ingest_shopify_paid_order(text, text, jsonb, jsonb)
to service_role;

create or replace function public.begin_shopify_account_provisioning(
    p_email text,
    p_lease_token uuid,
    p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email text := lower(btrim(p_email));
    v_user auth.users%rowtype;
    v_provision public.account_provisioning%rowtype;
    v_status text;
begin
    perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

    select *
    into v_user
    from auth.users
    where email is not null
      and lower(btrim(email)) = v_email
    order by created_at asc
    limit 1;

    if found then
        v_status := case
            when v_user.email_confirmed_at is not null then 'confirmed'
            when v_user.invited_at is not null then 'invite_sent'
            else 'existing_unconfirmed'
        end;

        insert into public.account_provisioning (
            email_normalized,
            auth_user_id,
            status,
            invite_sent_at,
            lease_token,
            lease_expires_at,
            last_error,
            updated_at
        )
        values (
            v_email,
            v_user.id,
            v_status,
            case when v_user.invited_at is not null then v_user.invited_at else null end,
            null,
            null,
            null,
            now()
        )
        on conflict (email_normalized)
        do update set
            auth_user_id = excluded.auth_user_id,
            status = excluded.status,
            invite_sent_at = coalesce(
                public.account_provisioning.invite_sent_at,
                excluded.invite_sent_at
            ),
            lease_token = null,
            lease_expires_at = null,
            last_error = null,
            updated_at = now();

        if v_status = 'confirmed' then
            update public.orders
            set purchaser_auth_user_id = v_user.id
            where purchaser_email_normalized = v_email
              and ingestion_outcome = 'ready'
              and purchaser_auth_user_id is null;
        end if;

        return jsonb_build_object(
            'action', v_status,
            'auth_user_id', v_user.id
        );
    end if;

    insert into public.account_provisioning (email_normalized)
    values (v_email)
    on conflict (email_normalized) do nothing;

    select *
    into strict v_provision
    from public.account_provisioning
    where email_normalized = v_email
    for update;

    if v_provision.lease_expires_at is not null
       and v_provision.lease_expires_at > now()
       and v_provision.lease_token is distinct from p_lease_token then
        return jsonb_build_object('action', 'busy');
    end if;

    update public.account_provisioning
    set status = 'invite_in_progress',
        invite_attempt_count = invite_attempt_count + 1,
        lease_token = p_lease_token,
        lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
        last_error = null,
        updated_at = now()
    where email_normalized = v_email;

    return jsonb_build_object('action', 'invite');
end;
$$;

revoke execute on function public.begin_shopify_account_provisioning(text, uuid, integer)
from public, anon, authenticated;
grant execute on function public.begin_shopify_account_provisioning(text, uuid, integer)
to service_role;

create or replace function public.finish_shopify_account_invitation(
    p_email text,
    p_lease_token uuid,
    p_auth_user_id uuid default null,
    p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email text := lower(btrim(p_email));
    v_user auth.users%rowtype;
    v_status text;
begin
    perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

    select *
    into v_user
    from auth.users
    where email is not null
      and lower(btrim(email)) = v_email
      and (p_auth_user_id is null or id = p_auth_user_id)
    order by created_at asc
    limit 1;

    if found then
        v_status := case
            when v_user.email_confirmed_at is not null then 'confirmed'
            when v_user.invited_at is not null then 'invite_sent'
            else 'existing_unconfirmed'
        end;

        update public.account_provisioning
        set auth_user_id = v_user.id,
            status = v_status,
            invite_sent_at = case
                when v_user.invited_at is not null
                    then coalesce(invite_sent_at, v_user.invited_at)
                else invite_sent_at
            end,
            lease_token = null,
            lease_expires_at = null,
            last_error = null,
            updated_at = now()
        where email_normalized = v_email;

        if v_status = 'confirmed' then
            update public.orders
            set purchaser_auth_user_id = v_user.id
            where purchaser_email_normalized = v_email
              and ingestion_outcome = 'ready'
              and purchaser_auth_user_id is null;
        end if;

        return jsonb_build_object(
            'status', v_status,
            'auth_user_id', v_user.id
        );
    end if;

    update public.account_provisioning
    set status = 'retryable_error',
        lease_token = null,
        lease_expires_at = null,
        last_error = left(coalesce(p_error, 'Invitation failed'), 500),
        updated_at = now()
    where email_normalized = v_email
      and lease_token = p_lease_token;

    return jsonb_build_object('status', 'retryable_error');
end;
$$;

revoke execute on function public.finish_shopify_account_invitation(text, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.finish_shopify_account_invitation(text, uuid, uuid, text)
to service_role;

create or replace function public.attach_confirmed_shopify_orders(p_auth_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email text;
    v_count integer;
begin
    if auth.uid() is not null and auth.uid() <> p_auth_user_id then
        raise exception 'unauthorized';
    end if;

    select lower(btrim(email))
    into v_email
    from auth.users
    where id = p_auth_user_id
      and email is not null
      and email_confirmed_at is not null;

    if v_email is null then
        raise exception 'verified email required';
    end if;

    update public.orders
    set purchaser_auth_user_id = p_auth_user_id
    where purchaser_email_normalized = v_email
      and ingestion_outcome = 'ready'
      and (purchaser_auth_user_id is null or purchaser_auth_user_id = p_auth_user_id);

    get diagnostics v_count = row_count;

    insert into public.account_provisioning (
        email_normalized,
        auth_user_id,
        status,
        updated_at
    )
    values (v_email, p_auth_user_id, 'confirmed', now())
    on conflict (email_normalized)
    do update set
        auth_user_id = excluded.auth_user_id,
        status = 'confirmed',
        lease_token = null,
        lease_expires_at = null,
        last_error = null,
        updated_at = now();

    return v_count;
end;
$$;

revoke execute on function public.attach_confirmed_shopify_orders(uuid)
from public, anon;
grant execute on function public.attach_confirmed_shopify_orders(uuid)
to authenticated, service_role;

create or replace function public.complete_shopify_webhook_delivery(
    p_shop_domain text,
    p_webhook_id text
)
returns void
language sql
security definer
set search_path = public
as $$
    update public.shopify_webhook_deliveries
    set processing_state = 'processed',
        processed_at = coalesce(processed_at, now()),
        last_error = null,
        updated_at = now()
    where shop_domain = p_shop_domain
      and shopify_webhook_id = p_webhook_id;
$$;

revoke execute on function public.complete_shopify_webhook_delivery(text, text)
from public, anon, authenticated;
grant execute on function public.complete_shopify_webhook_delivery(text, text)
to service_role;

create or replace function public.fail_shopify_webhook_delivery(
    p_shop_domain text,
    p_webhook_id text,
    p_error text
)
returns void
language sql
security definer
set search_path = public
as $$
    update public.shopify_webhook_deliveries
    set processing_state = 'retryable_error',
        last_error = left(p_error, 500),
        updated_at = now()
    where shop_domain = p_shop_domain
      and shopify_webhook_id = p_webhook_id
      and processing_state <> 'processed';
$$;

revoke execute on function public.fail_shopify_webhook_delivery(text, text, text)
from public, anon, authenticated;
grant execute on function public.fail_shopify_webhook_delivery(text, text, text)
to service_role;

create or replace function public.begin_shopify_invitation_recovery(
    p_email text,
    p_cooldown_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email text := lower(btrim(p_email));
    v_user auth.users%rowtype;
    v_provision public.account_provisioning%rowtype;
begin
    perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

    select *
    into v_user
    from auth.users
    where email is not null
      and lower(btrim(email)) = v_email
      and email_confirmed_at is null
    order by created_at asc
    limit 1;

    if not found or not exists (
        select 1
        from public.orders o
        join public.order_items oi on oi.order_id = o.id
        join public.order_item_units oiu on oiu.order_item_id = oi.id
        where o.purchaser_email_normalized = v_email
          and o.ingestion_outcome = 'ready'
    ) then
        return false;
    end if;

    insert into public.account_provisioning (
        email_normalized,
        auth_user_id,
        status
    )
    values (
        v_email,
        v_user.id,
        case when v_user.invited_at is not null
            then 'invite_sent'
            else 'existing_unconfirmed'
        end
    )
    on conflict (email_normalized) do nothing;

    select *
    into strict v_provision
    from public.account_provisioning
    where email_normalized = v_email
    for update;

    if v_provision.recovery_sent_at is not null
       and v_provision.recovery_sent_at >
           now() - make_interval(secs => greatest(p_cooldown_seconds, 60)) then
        return false;
    end if;

    update public.account_provisioning
    set recovery_sent_at = now(),
        updated_at = now()
    where email_normalized = v_email;

    return true;
end;
$$;

revoke execute on function public.begin_shopify_invitation_recovery(text, integer)
from public, anon, authenticated;
grant execute on function public.begin_shopify_invitation_recovery(text, integer)
to service_role;

create or replace function public.fail_shopify_invitation_recovery(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.account_provisioning
    set recovery_sent_at = null,
        last_error = 'Recovery email delivery failed',
        updated_at = now()
    where email_normalized = lower(btrim(p_email));
$$;

revoke execute on function public.fail_shopify_invitation_recovery(text)
from public, anon, authenticated;
grant execute on function public.fail_shopify_invitation_recovery(text)
to service_role;

comment on table public.order_item_units is
    'One row per eligible purchased unit. Physical necklace allocation is intentionally deferred.';
comment on table public.shopify_webhook_deliveries is
    'Shopify delivery deduplication metadata only; raw webhook payloads and addresses are not stored.';

revoke execute on function public.sync_profile_email_from_auth()
from public, anon, authenticated;
