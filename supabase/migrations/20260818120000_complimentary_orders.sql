-- First-class complimentary production orders and reusable account provisioning.

create sequence if not exists public.complimentary_order_reference_seq
    start with 1 increment by 1;

alter table public.orders
    add column if not exists order_source text not null default 'shopify',
    add column if not exists factory_reference text,
    add column if not exists production_state text not null default 'pending_owner',
    add column if not exists purchaser_name text,
    add column if not exists internal_note text,
    add column if not exists idempotency_key uuid;

alter table public.orders
    drop constraint if exists orders_order_source_check,
    add constraint orders_order_source_check
        check (order_source in ('shopify', 'complimentary')),
    drop constraint if exists orders_production_state_check,
    add constraint orders_production_state_check
        check (production_state in (
            'pending_owner',
            'queued',
            'manual_review',
            'excluded',
            'cancelled'
        )),
    drop constraint if exists orders_purchaser_name_length_check,
    add constraint orders_purchaser_name_length_check
        check (purchaser_name is null or length(purchaser_name) <= 120),
    drop constraint if exists orders_internal_note_length_check,
    add constraint orders_internal_note_length_check
        check (internal_note is null or length(internal_note) <= 500);

update public.orders
set factory_reference = coalesce(
        nullif(shopify_order_number, ''),
        nullif(shopify_order_id, ''),
        nullif(external_order_ref, ''),
        id::text
    ),
    production_state = case
        when cancelled_at is not null then 'cancelled'
        when ingestion_outcome = 'ignored' then 'excluded'
        when ingestion_outcome = 'manual_review' then 'manual_review'
        when ingestion_outcome = 'ready' and financial_status = 'paid' then 'queued'
        else 'pending_owner'
    end
where order_source = 'shopify';

create unique index if not exists orders_idempotency_key_unique
    on public.orders (idempotency_key)
    where idempotency_key is not null;
create unique index if not exists orders_complimentary_factory_reference_unique
    on public.orders (factory_reference)
    where order_source = 'complimentary';
create index if not exists orders_factory_queue_idx
    on public.orders (production_state, created_at desc);

create or replace function public.sync_shopify_order_production_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.order_source = 'shopify' then
        new.factory_reference := coalesce(
            nullif(new.shopify_order_number, ''),
            nullif(new.shopify_order_id, ''),
            nullif(new.external_order_ref, ''),
            new.id::text
        );
        new.production_state := case
            when new.cancelled_at is not null then 'cancelled'
            when new.ingestion_outcome = 'ignored' then 'excluded'
            when new.ingestion_outcome = 'manual_review' then 'manual_review'
            when new.ingestion_outcome = 'ready'
                 and new.financial_status = 'paid' then 'queued'
            else 'pending_owner'
        end;
    end if;
    return new;
end;
$$;

drop trigger if exists orders_sync_shopify_production_state on public.orders;
create trigger orders_sync_shopify_production_state
before insert or update of
    order_source,
    shopify_order_number,
    shopify_order_id,
    external_order_ref,
    ingestion_outcome,
    financial_status,
    cancelled_at
on public.orders
for each row execute function public.sync_shopify_order_production_state();

create or replace function public.begin_account_provisioning(
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
    v_result jsonb;
    v_auth_user_id uuid;
begin
    v_result := public.begin_shopify_account_provisioning(
        p_email,
        p_lease_token,
        p_lease_seconds
    );
    v_auth_user_id := nullif(v_result->>'auth_user_id', '')::uuid;

    if v_auth_user_id is not null then
        update public.orders
        set purchaser_auth_user_id = v_auth_user_id
        where purchaser_email_normalized = lower(btrim(p_email))
          and purchaser_auth_user_id is null
          and production_state in ('pending_owner', 'queued');
    end if;

    return v_result;
end;
$$;

create or replace function public.finish_account_invitation(
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
    v_result jsonb;
    v_auth_user_id uuid;
begin
    v_result := public.finish_shopify_account_invitation(
        p_email,
        p_lease_token,
        p_auth_user_id,
        p_error
    );
    v_auth_user_id := coalesce(
        nullif(v_result->>'auth_user_id', '')::uuid,
        p_auth_user_id
    );

    if p_error is null and v_auth_user_id is not null then
        update public.orders
        set purchaser_auth_user_id = v_auth_user_id
        where purchaser_email_normalized = lower(btrim(p_email))
          and purchaser_auth_user_id is null
          and production_state in ('pending_owner', 'queued');
    end if;

    return v_result;
end;
$$;

create or replace function public.find_auth_user_by_email(p_email text)
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
    select * from public.find_shopify_auth_user(p_email);
$$;

create or replace function public.begin_invitation_recovery(
    p_email text,
    p_cooldown_seconds integer default 300
)
returns boolean
language sql
security definer
set search_path = public
as $$
    select public.begin_shopify_invitation_recovery(
        p_email,
        p_cooldown_seconds
    );
$$;

create or replace function public.fail_invitation_recovery(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
    select public.fail_shopify_invitation_recovery(p_email);
$$;

create or replace function public.attach_confirmed_orders(p_auth_user_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
    select public.attach_confirmed_shopify_orders(p_auth_user_id);
$$;

revoke execute on function public.begin_account_provisioning(text, uuid, integer)
from public, anon, authenticated;
revoke execute on function public.finish_account_invitation(text, uuid, uuid, text)
from public, anon, authenticated;
revoke execute on function public.find_auth_user_by_email(text)
from public, anon, authenticated;
revoke execute on function public.begin_invitation_recovery(text, integer)
from public, anon, authenticated;
revoke execute on function public.fail_invitation_recovery(text)
from public, anon, authenticated;
revoke execute on function public.attach_confirmed_orders(uuid)
from public, anon;
grant execute on function public.begin_account_provisioning(text, uuid, integer)
to service_role;
grant execute on function public.finish_account_invitation(text, uuid, uuid, text)
to service_role;
grant execute on function public.find_auth_user_by_email(text)
to service_role;
grant execute on function public.begin_invitation_recovery(text, integer)
to service_role;
grant execute on function public.fail_invitation_recovery(text)
to service_role;
grant execute on function public.attach_confirmed_orders(uuid)
to authenticated, service_role;

create or replace function public.admin_create_complimentary_order(
    p_admin_user_id uuid,
    p_idempotency_key uuid,
    p_purchaser_email text,
    p_purchaser_name text,
    p_sku text,
    p_quantity integer,
    p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order_id uuid;
    v_item_id uuid;
    v_reference text;
    v_existing public.orders%rowtype;
    v_existing_sku text;
    v_existing_quantity integer;
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;
    if p_idempotency_key is null then
        raise exception 'idempotency key required';
    end if;
    if p_purchaser_email is null
       or lower(btrim(p_purchaser_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'valid purchaser email required';
    end if;
    if p_sku is null or length(btrim(p_sku)) not between 1 and 100 then
        raise exception 'valid sku required';
    end if;
    if p_quantity is null or p_quantity not between 1 and 20 then
        raise exception 'quantity must be between 1 and 20';
    end if;
    if p_purchaser_name is not null and length(btrim(p_purchaser_name)) > 120 then
        raise exception 'purchaser name is too long';
    end if;
    if p_internal_note is not null and length(btrim(p_internal_note)) > 500 then
        raise exception 'internal note is too long';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    select * into v_existing
    from public.orders
    where idempotency_key = p_idempotency_key;

    if found then
        if v_existing.order_source <> 'complimentary' then
            raise exception 'idempotency key already used';
        end if;
        select sku, coalesce(current_quantity, quantity)
        into v_existing_sku, v_existing_quantity
        from public.order_items
        where order_id = v_existing.id
          and is_lumi_eligible = true
        order by created_at
        limit 1;
        if v_existing.purchaser_email_normalized
               <> lower(btrim(p_purchaser_email))
           or v_existing.purchaser_name is distinct from
               nullif(btrim(p_purchaser_name), '')
           or v_existing.internal_note is distinct from
               nullif(btrim(p_internal_note), '')
           or v_existing_sku is distinct from btrim(p_sku)
           or v_existing_quantity is distinct from p_quantity then
            raise exception 'idempotency key parameters do not match';
        end if;
        return jsonb_build_object(
            'replayed', true,
            'order_id', v_existing.id,
            'factory_reference', v_existing.factory_reference,
            'production_state', v_existing.production_state
        );
    end if;

    v_reference := 'GIFT-' || lpad(
        nextval('public.complimentary_order_reference_seq')::text,
        6,
        '0'
    );

    insert into public.orders (
        external_order_ref,
        purchaser_email_normalized,
        status,
        ingestion_outcome,
        order_source,
        factory_reference,
        production_state,
        purchaser_name,
        internal_note,
        idempotency_key
    ) values (
        'complimentary:' || v_reference,
        lower(btrim(p_purchaser_email)),
        'pending_claim',
        'processing',
        'complimentary',
        v_reference,
        'pending_owner',
        nullif(btrim(p_purchaser_name), ''),
        nullif(btrim(p_internal_note), ''),
        p_idempotency_key
    )
    returning id into v_order_id;

    insert into public.order_items (
        order_id,
        sku,
        title,
        quantity,
        current_quantity,
        is_lumi_eligible
    ) values (
        v_order_id,
        btrim(p_sku),
        'Lumi Necklace',
        p_quantity,
        p_quantity,
        true
    )
    returning id into v_item_id;

    insert into public.order_item_units (order_item_id, unit_ordinal)
    select v_item_id, ordinal
    from generate_series(1, p_quantity) ordinal;

    insert into public.admin_audit_logs (
        admin_user_id,
        action,
        resource_type,
        resource_id,
        details,
        correlation_id
    ) values (
        p_admin_user_id,
        'complimentary_order.created',
        'order',
        v_order_id::text,
        jsonb_build_object(
            'factoryReference', v_reference,
            'sku', btrim(p_sku),
            'quantity', p_quantity
        ),
        p_idempotency_key
    );

    return jsonb_build_object(
        'replayed', false,
        'order_id', v_order_id,
        'factory_reference', v_reference,
        'production_state', 'pending_owner'
    );
end;
$$;

create or replace function public.admin_finalize_complimentary_order(
    p_admin_user_id uuid,
    p_order_id uuid,
    p_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
    v_owner_email text;
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;

    select * into v_order
    from public.orders
    where id = p_order_id
      and order_source = 'complimentary'
    for update;
    if not found then
        raise exception 'complimentary order not found';
    end if;
    if v_order.production_state = 'cancelled' then
        raise exception 'complimentary order is cancelled';
    end if;

    select lower(btrim(email)) into v_owner_email
    from auth.users
    where id = p_owner_user_id
      and email is not null;
    if v_owner_email is null
       or v_owner_email <> v_order.purchaser_email_normalized then
        raise exception 'owner email does not match complimentary order';
    end if;

    update public.orders
    set purchaser_auth_user_id = p_owner_user_id,
        ingestion_outcome = 'ready',
        production_state = 'queued'
    where id = p_order_id;

    if v_order.production_state <> 'queued'
       or v_order.purchaser_auth_user_id is distinct from p_owner_user_id then
        insert into public.admin_audit_logs (
            admin_user_id,
            action,
            resource_type,
            resource_id,
            details
        ) values (
            p_admin_user_id,
            'complimentary_order.queued',
            'order',
            p_order_id::text,
            jsonb_build_object('ownerUserId', p_owner_user_id)
        );
    end if;

    if v_order.purchaser_name is not null then
        update public.profiles
        set display_name = coalesce(nullif(display_name, ''), v_order.purchaser_name),
            updated_at = now()
        where id = p_owner_user_id;
    end if;
end;
$$;

create or replace function public.admin_cancel_complimentary_order(
    p_admin_user_id uuid,
    p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;

    select * into v_order
    from public.orders
    where id = p_order_id
      and order_source = 'complimentary'
    for update;
    if not found then
        raise exception 'complimentary order not found';
    end if;
    if v_order.production_state = 'cancelled' then
        return;
    end if;
    if exists (
        select 1
        from public.order_items oi
        join public.order_item_units u on u.order_item_id = oi.id
        where oi.order_id = p_order_id
          and u.allocation_status = 'assigned'
    ) then
        raise exception 'assigned necklaces must be unlinked before cancellation';
    end if;

    update public.orders
    set production_state = 'cancelled',
        ingestion_outcome = 'ignored',
        cancelled_at = now()
    where id = p_order_id;

    insert into public.admin_audit_logs (
        admin_user_id,
        action,
        resource_type,
        resource_id
    ) values (
        p_admin_user_id,
        'complimentary_order.cancelled',
        'order',
        p_order_id::text
    );
end;
$$;

revoke execute on function public.admin_create_complimentary_order(
    uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated;
revoke execute on function public.admin_finalize_complimentary_order(uuid, uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.admin_cancel_complimentary_order(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_create_complimentary_order(
    uuid, uuid, text, text, text, integer, text
) to service_role;
grant execute on function public.admin_finalize_complimentary_order(uuid, uuid, uuid)
to service_role;
grant execute on function public.admin_cancel_complimentary_order(uuid, uuid)
to service_role;

comment on column public.orders.order_source is
    'Origin of the order. Complimentary orders never represent Shopify payments.';
comment on column public.orders.production_state is
    'Controls production queue visibility independently from Shopify ingestion.';
comment on column public.orders.internal_note is
    'Admin-only context; never expose through customer or factory APIs.';
