-- Lumi internal admin foundation, inventory allocation, and content imports.
create type public.admin_role as enum ('support', 'content_admin', 'super_admin');

create table public.admin_user_roles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    role public.admin_role not null,
    granted_by uuid references auth.users (id) on delete set null,
    granted_at timestamptz not null default now()
);

create table public.admin_audit_logs (
    id uuid primary key default gen_random_uuid(),
    admin_user_id uuid not null references auth.users (id) on delete restrict,
    action text not null check (length(action) between 1 and 120),
    resource_type text not null check (length(resource_type) between 1 and 80),
    resource_id text,
    details jsonb not null default '{}'::jsonb,
    correlation_id uuid,
    created_at timestamptz not null default now()
);

create index admin_audit_logs_created_idx
    on public.admin_audit_logs (created_at desc);
create index admin_audit_logs_admin_created_idx
    on public.admin_audit_logs (admin_user_id, created_at desc);
create index admin_audit_logs_resource_created_idx
    on public.admin_audit_logs (resource_type, created_at desc);
create index admin_audit_logs_action_created_idx
    on public.admin_audit_logs (action, created_at desc);

create or replace function public.prevent_admin_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    raise exception 'admin audit logs are append-only';
end;
$$;

create trigger admin_audit_logs_prevent_update
before update on public.admin_audit_logs
for each row execute function public.prevent_admin_audit_log_mutation();
create trigger admin_audit_logs_prevent_delete
before delete on public.admin_audit_logs
for each row execute function public.prevent_admin_audit_log_mutation();

alter table public.admin_user_roles enable row level security;
alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_user_roles from anon, authenticated;
revoke all on public.admin_audit_logs from anon, authenticated;

create or replace function public.is_lumi_admin(
    p_user_id uuid,
    p_roles public.admin_role[] default array['super_admin']::public.admin_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_user_roles r
        where r.user_id = p_user_id
          and r.role = any (p_roles)
    );
$$;

revoke execute on function public.is_lumi_admin(uuid, public.admin_role[])
from public, anon, authenticated;
grant execute on function public.is_lumi_admin(uuid, public.admin_role[])
to service_role;

-- Account state is controlled by server-side admin code. Customers cannot update it.
alter table public.profiles
    add column if not exists account_status text not null default 'active'
        check (account_status in ('active', 'paused'));

create index profiles_admin_search_idx
    on public.profiles (created_at desc, id);
alter table public.orders
    add column if not exists updated_at timestamptz not null default now();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();
create index orders_admin_created_idx
    on public.orders (shopify_created_at desc nulls last, created_at desc);
create index necklaces_admin_created_idx
    on public.necklaces (created_at desc, id);
create index tap_events_admin_tapped_idx
    on public.tap_events (tapped_at desc);

-- Keep the recipient tap lifecycle contract intact while adding operational state.
alter table public.necklaces
    add column if not exists inventory_status text not null default 'unassigned'
        check (inventory_status in ('unassigned', 'assigned', 'shipped', 'activated', 'disabled')),
    add column if not exists order_item_unit_id uuid
        references public.order_item_units (id) on delete set null,
    add column if not exists activated_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

create unique index necklaces_order_item_unit_unique
    on public.necklaces (order_item_unit_id)
    where order_item_unit_id is not null;
create index necklaces_inventory_status_idx
    on public.necklaces (inventory_status, created_at desc);
create index necklaces_tag_ref_search_idx
    on public.necklaces (lower(tag_ref))
    where tag_ref is not null;

drop trigger if exists necklaces_set_updated_at on public.necklaces;
create trigger necklaces_set_updated_at
before update on public.necklaces
for each row execute function public.set_updated_at();

create or replace function public.sync_necklace_activation_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.lifecycle_status = 'active'
       and old.lifecycle_status is distinct from 'active' then
        new.activated_at := coalesce(new.activated_at, now());
        new.inventory_status := 'activated';
    end if;
    return new;
end;
$$;

create trigger necklaces_sync_activation_metadata
before update of lifecycle_status on public.necklaces
for each row execute function public.sync_necklace_activation_metadata();

alter table public.order_item_units
    drop constraint if exists order_item_units_allocation_status_check;
alter table public.order_item_units
    add constraint order_item_units_allocation_status_check
    check (allocation_status in ('awaiting_necklace', 'assigned'));

create table public.message_templates (
    id uuid primary key default gen_random_uuid(),
    import_key text not null unique check (length(import_key) between 1 and 160),
    title text not null check (length(title) between 1 and 200),
    content text not null check (length(content) between 1 and 500),
    category text,
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    sort_order integer not null default 0 check (sort_order >= 0),
    metadata jsonb not null default '{}'::jsonb,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.message_template_import_runs (
    id uuid primary key default gen_random_uuid(),
    admin_user_id uuid not null references auth.users (id) on delete restrict,
    file_name text not null,
    source_type text not null check (source_type in ('csv', 'json')),
    status text not null check (status in ('completed', 'completed_with_errors', 'failed')),
    total_rows integer not null default 0,
    inserted_rows integer not null default 0,
    updated_rows integer not null default 0,
    skipped_rows integer not null default 0,
    failed_rows integer not null default 0,
    created_at timestamptz not null default now()
);

create table public.message_template_import_errors (
    id uuid primary key default gen_random_uuid(),
    import_run_id uuid not null references public.message_template_import_runs (id) on delete cascade,
    row_number integer not null check (row_number > 0),
    import_key text,
    error_message text not null,
    created_at timestamptz not null default now()
);

create index message_templates_status_sort_idx
    on public.message_templates (status, sort_order, created_at);
create index message_template_import_runs_created_idx
    on public.message_template_import_runs (created_at desc);
create index message_template_import_errors_run_idx
    on public.message_template_import_errors (import_run_id, row_number);

alter table public.message_templates enable row level security;
alter table public.message_template_import_runs enable row level security;
alter table public.message_template_import_errors enable row level security;
revoke all on public.message_templates from anon, authenticated;
revoke all on public.message_template_import_runs from anon, authenticated;
revoke all on public.message_template_import_errors from anon, authenticated;

drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at
before update on public.message_templates
for each row execute function public.set_updated_at();

create or replace function public.admin_assign_necklace(
    p_admin_user_id uuid,
    p_necklace_id uuid,
    p_order_item_unit_id uuid,
    p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order_id uuid;
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_necklace_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(p_order_item_unit_id::text, 0));

    select oi.order_id into v_order_id
    from public.order_item_units u
    join public.order_items oi on oi.id = u.order_item_id
    join public.orders o on o.id = oi.order_id
    where u.id = p_order_item_unit_id
      and u.allocation_status = 'awaiting_necklace'
      and oi.is_lumi_eligible = true
      and o.purchaser_auth_user_id = p_customer_id
    for update of u;

    if v_order_id is null then
        raise exception 'eligible unit not found or already assigned';
    end if;

    update public.necklaces
    set order_item_unit_id = p_order_item_unit_id,
        inventory_status = 'assigned'
    where id = p_necklace_id
      and order_item_unit_id is null
      and inventory_status <> 'disabled';

    if not found then
        raise exception 'necklace not found or unavailable';
    end if;

    insert into public.necklace_ownerships (
        necklace_id, sender_user_id, source_order_id, is_primary
    )
    values (p_necklace_id, p_customer_id, v_order_id, false);

    update public.order_item_units
    set allocation_status = 'assigned'
    where id = p_order_item_unit_id;
end;
$$;

create or replace function public.admin_transfer_necklace(
    p_admin_user_id uuid,
    p_necklace_id uuid,
    p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;

    update public.necklace_ownerships
    set sender_user_id = p_customer_id,
        claimed_at = now(),
        is_primary = false
    where necklace_id = p_necklace_id;

    if not found then
        raise exception 'necklace ownership not found';
    end if;
end;
$$;

create or replace function public.admin_unlink_necklace(
    p_admin_user_id uuid,
    p_necklace_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_unit_id uuid;
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;

    select order_item_unit_id into v_unit_id
    from public.necklaces
    where id = p_necklace_id
    for update;

    delete from public.necklace_ownerships where necklace_id = p_necklace_id;
    update public.necklaces
    set order_item_unit_id = null,
        inventory_status = 'unassigned'
    where id = p_necklace_id;

    if not found then
        raise exception 'necklace not found';
    end if;

    if v_unit_id is not null then
        update public.order_item_units
        set allocation_status = 'awaiting_necklace'
        where id = v_unit_id;
    end if;
end;
$$;

revoke execute on function public.admin_assign_necklace(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.admin_transfer_necklace(uuid, uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.admin_unlink_necklace(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_assign_necklace(uuid, uuid, uuid, uuid)
to service_role;
grant execute on function public.admin_transfer_necklace(uuid, uuid, uuid)
to service_role;
grant execute on function public.admin_unlink_necklace(uuid, uuid)
to service_role;

create or replace function public.get_admin_operational_metrics(
    p_admin_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_first_taps bigint;
    v_repeat_taps bigint;
    v_active_necklaces bigint;
    v_lumis bigint;
    v_average_activation_hours numeric;
begin
    if not public.is_lumi_admin(p_admin_user_id) then
        raise exception 'forbidden';
    end if;

    select
        count(*),
        coalesce(sum(greatest(tap_count - 1, 0)), 0)
    into v_first_taps, v_repeat_taps
    from (
        select necklace_id, count(*) as tap_count
        from public.tap_events
        where necklace_id is not null
        group by necklace_id
    ) taps_by_necklace;

    select count(*) into v_active_necklaces
    from public.necklaces
    where lifecycle_status = 'active';

    select count(*) into v_lumis
    from public.necklace_lumis l
    join public.necklaces n on n.id = l.necklace_id
    where n.lifecycle_status = 'active';

    select avg(extract(epoch from (n.activated_at - coalesce(o.shopify_created_at, o.created_at))) / 3600)
    into v_average_activation_hours
    from public.necklaces n
    join public.necklace_ownerships own on own.necklace_id = n.id
    join public.orders o on o.id = own.source_order_id
    where n.activated_at is not null
      and n.activated_at >= coalesce(o.shopify_created_at, o.created_at);

    return jsonb_build_object(
        'first_taps', v_first_taps,
        'repeat_taps', v_repeat_taps,
        'messages_per_active_necklace',
            case when v_active_necklaces = 0 then null
                 else round(v_lumis::numeric / v_active_necklaces, 2)
            end,
        'average_purchase_to_activation_hours',
            case when v_average_activation_hours is null then null
                 else round(v_average_activation_hours, 1)
            end
    );
end;
$$;

revoke execute on function public.get_admin_operational_metrics(uuid)
from public, anon, authenticated;
grant execute on function public.get_admin_operational_metrics(uuid)
to service_role;

comment on table public.admin_user_roles is
    'Server-controlled Lumi admin authorization. Never writable by customer clients.';
comment on table public.admin_audit_logs is
    'Append-only safe metadata for privileged admin mutations.';
comment on table public.message_templates is
    'Lumi-owned reusable content; intentionally separate from customer messages.';
