-- Admin-managed categories for the shared Explore and Reserve message catalog.
create table if not exists public.message_categories (
    key text primary key,
    name text not null,
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint message_categories_key_check check (
        key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        and length(key) <= 50
    ),
    constraint message_categories_name_check check (
        length(btrim(name)) between 1 and 60
    ),
    constraint message_categories_sort_order_check check (sort_order >= 0)
);

create unique index if not exists message_categories_name_unique
    on public.message_categories (lower(btrim(name)));

create index if not exists message_categories_active_order_idx
    on public.message_categories (sort_order, name)
    where is_active = true;

insert into public.message_categories (key, name, sort_order)
values
    ('affection', 'Affection', 1),
    ('comfort', 'Comfort', 2),
    ('encouragement', 'Encouragement', 3),
    ('presence', 'Presence', 4),
    ('reassurance', 'Reassurance', 5)
on conflict (key) do nothing;

alter table public.message_categories enable row level security;

-- Categories are administered through authenticated server actions and
-- returned to senders by a server-only API using the service role.
revoke all on table public.message_categories from anon, authenticated;

-- Published messages may now use any valid admin-managed category key. The
-- server action verifies that the category record exists and is active.
alter table public.messages
    drop constraint if exists messages_explore_publication_check;

alter table public.messages
    add constraint messages_explore_publication_check check (
        not is_explore_published
        or (
            text is not null
            and length(btrim(text)) between 1 and 500
            and category is not null
            and category ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
            and length(category) <= 50
            and explore_sort_order is not null
            and explore_sort_order >= 0
        )
    );

comment on table public.message_categories is
    'Admin-managed categories shared by the message catalog and sender Explore library.';
