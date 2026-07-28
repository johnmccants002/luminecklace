-- Unify admin message editing/imports with the existing Explore + Reserve
-- catalog. The legacy message_templates table remains read-only for migration
-- history but is no longer an application source of truth.

alter table public.messages
    add column if not exists package_id text,
    add column if not exists import_key text,
    add column if not exists title text;

alter table public.messages
    alter column package_id set default 'heart-core';

create unique index if not exists messages_import_key_unique
    on public.messages (import_key);

create index if not exists messages_admin_catalog_idx
    on public.messages (
        category,
        is_active,
        is_explore_published,
        explore_sort_order,
        created_at desc
    )
    where necklace_id is null and author_user_id is null;

-- Preserve any rows imported before the admin importer was connected to the
-- real catalog. Invalid/unknown categories remain unpublished for review.
insert into public.messages (
    package_id,
    import_key,
    title,
    text,
    content,
    category,
    state,
    is_active,
    is_explore_published,
    explore_sort_order,
    is_reserve_eligible,
    reserve_default_approved,
    theme_key,
    animation_key,
    sound_key,
    created_at
)
select
    'heart-core',
    t.import_key,
    t.title,
    t.content,
    t.content,
    case
        when t.category in (
            'affection',
            'comfort',
            'encouragement',
            'presence',
            'reassurance'
        ) then t.category
        else null
    end,
    t.status,
    t.status <> 'archived',
    t.status = 'published'
        and t.category in (
            'affection',
            'comfort',
            'encouragement',
            'presence',
            'reassurance'
        ),
    t.sort_order,
    false,
    false,
    coalesce(nullif(t.metadata->>'theme', ''), 'heart'),
    coalesce(nullif(t.metadata->>'animation', ''), 'breathe'),
    coalesce(nullif(t.metadata->>'sound', ''), 'soft'),
    t.created_at
from public.message_templates t
on conflict (import_key) do update
set
    title = excluded.title,
    text = excluded.text,
    content = excluded.content,
    category = excluded.category,
    state = excluded.state,
    is_active = excluded.is_active,
    is_explore_published = excluded.is_explore_published,
    explore_sort_order = excluded.explore_sort_order,
    theme_key = excluded.theme_key,
    animation_key = excluded.animation_key,
    sound_key = excluded.sound_key;

comment on table public.message_templates is
    'Deprecated staging table retained for migration history. Admin editing and imports now target public.messages.';
comment on column public.messages.import_key is
    'Optional stable external key used for idempotent admin imports.';
comment on column public.messages.title is
    'Optional internal admin label; never returned by the sender Explore API.';
