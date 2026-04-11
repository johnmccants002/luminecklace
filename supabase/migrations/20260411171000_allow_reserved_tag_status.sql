do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'tags_status_check'
      and conrelid = 'public.tags'::regclass
  ) then
    alter table public.tags
      drop constraint tags_status_check;
  end if;

  alter table public.tags
    add constraint tags_status_check
    check (status in ('unclaimed', 'reserved', 'claimed'));
exception
  when duplicate_object then
    null;
end;
$$;
