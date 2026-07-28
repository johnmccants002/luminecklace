-- Publication intent and activity are separate admin controls. An inactive
-- template remains hidden because sender queries require both flags, but
-- retaining publication intent makes temporary deactivation reversible and
-- preserves existing Reserve tests/behavior.
alter table public.messages
    drop constraint if exists messages_explore_publication_check;

alter table public.messages
    add constraint messages_explore_publication_check check (
        not is_explore_published
        or (
            text is not null
            and length(btrim(text)) between 1 and 500
            and category in (
                'affection',
                'comfort',
                'encouragement',
                'presence',
                'reassurance'
            )
            and explore_sort_order is not null
            and explore_sort_order >= 0
        )
    );
