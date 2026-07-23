-- Normalize catalog metadata required by the Reserve category read model.
alter table public.messages
    add column if not exists category text,
    add column if not exists tone text;
