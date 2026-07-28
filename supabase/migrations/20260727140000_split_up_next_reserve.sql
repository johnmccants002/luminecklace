-- Ordered necklace queue foundation.
-- The legacy necklace_reserve_* tables remain a separate catalog/approval pool
-- and are intentionally not copied into this editable queue.
alter table public.necklaces
    add column if not exists queue_revision bigint not null default 0;

alter table public.necklace_lumis
    add column if not exists queue_section text;

alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_queue_section_check,
    add constraint necklace_lumis_queue_section_check check (
        queue_section is null
        or queue_section in ('current', 'up_next', 'reserve')
    );

-- The legacy queue used one position namespace per necklace. The split queue
-- gives each section its own position namespace, so Current and the first
-- Up Next item may both have position 1. Remove the old uniqueness rule before
-- assigning those section-local positions.
drop index if exists public.necklace_lumis_necklace_queue_position_idx;

-- Preserve the existing published queue order. The first row becomes Current,
-- and every remaining row becomes Up Next. Editable Reserve starts empty.
with ordered as (
    select
        l.id,
        row_number() over (
            partition by l.necklace_id
            order by l.queue_position, l.created_at, l.id
        )::integer as ordinal
    from public.necklace_lumis l
    where l.is_enabled = true
      and l.revealed_at is null
)
update public.necklace_lumis l
set queue_section = case
        when ordered.ordinal = 1 then 'current'
        else 'up_next'
    end,
    queue_position = case
        when ordered.ordinal = 1 then 1
        else ordered.ordinal - 1
    end
from ordered
where l.id = ordered.id
  and l.queue_section is null;

update public.necklace_lumis
set queue_section = null
where revealed_at is not null or is_enabled = false;

alter table public.necklace_lumis
    drop constraint if exists necklace_lumis_active_queue_membership_check,
    add constraint necklace_lumis_active_queue_membership_check check (
        is_enabled = false
        or revealed_at is not null
        or queue_section is not null
    ),
    drop constraint if exists necklace_lumis_current_position_check,
    add constraint necklace_lumis_current_position_check check (
        queue_section <> 'current' or queue_position = 1
    );

create unique index if not exists necklace_lumis_one_current_idx
    on public.necklace_lumis (necklace_id)
    where is_enabled = true
      and revealed_at is null
      and queue_section = 'current';

create unique index if not exists necklace_lumis_section_position_idx
    on public.necklace_lumis (necklace_id, queue_section, queue_position)
    where is_enabled = true
      and revealed_at is null
      and queue_section is not null;

create index if not exists necklace_lumis_ordered_queue_idx
    on public.necklace_lumis (
        necklace_id,
        queue_section,
        queue_position,
        created_at,
        id
    )
    where is_enabled = true and revealed_at is null;

create table if not exists public.necklace_queue_mutations (
    necklace_id uuid not null references public.necklaces (id) on delete cascade,
    idempotency_key uuid not null,
    sender_user_id uuid not null references auth.users (id) on delete cascade,
    response jsonb not null,
    created_at timestamptz not null default now(),
    primary key (necklace_id, idempotency_key)
);

alter table public.necklace_queue_mutations enable row level security;

revoke all on table public.necklace_queue_mutations
from public, anon, authenticated;
grant all on table public.necklace_queue_mutations to service_role;
