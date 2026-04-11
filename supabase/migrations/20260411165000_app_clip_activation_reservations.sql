-- App Clip pre-auth activation reservations and authenticated claim flow.
-- This migration adds reservation metadata and two transactional RPC helpers.

alter table public.tags
  add column if not exists reserved_until timestamptz,
  add column if not exists reserved_by_session text,
  add column if not exists claim_token_hash text,
  add column if not exists claimed_token_hash text;

create index if not exists tags_claim_token_hash_idx
  on public.tags (claim_token_hash)
  where claim_token_hash is not null;

create index if not exists tags_claimed_token_hash_idx
  on public.tags (claimed_token_hash)
  where claimed_token_hash is not null;

create index if not exists tags_activation_code_hash_idx
  on public.tags (activation_code_hash);

create or replace function public.reserve_activation_code(
  p_activation_code_hash text,
  p_claim_token_hash text,
  p_reserved_until timestamptz,
  p_reserved_by_session text
)
returns table (
  result text,
  tag_id text,
  sku text,
  necklace_name text,
  base_package_ids text[],
  reserved_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag public.tags%rowtype;
  v_necklace_name text;
  v_base_package_ids text[];
begin
  select *
  into v_tag
  from public.tags
  where activation_code_hash = p_activation_code_hash
  for update;

  if not found then
    return query
      select
        'not_found'::text,
        null::text,
        null::text,
        null::text,
        array[]::text[],
        null::timestamptz;
    return;
  end if;

  if coalesce(v_tag.status, 'unclaimed') = 'claimed' then
    return query
      select
        'already_claimed'::text,
        v_tag.tag_id,
        v_tag.sku,
        null::text,
        array[]::text[],
        null::timestamptz;
    return;
  end if;

  if coalesce(v_tag.status, 'unclaimed') = 'reserved'
    and (v_tag.reserved_until is null or v_tag.reserved_until <= now()) then
    update public.tags
    set
      status = 'unclaimed',
      reserved_until = null,
      reserved_by_session = null,
      claim_token_hash = null
    where tag_id = v_tag.tag_id;

    select *
    into v_tag
    from public.tags
    where tag_id = v_tag.tag_id
    for update;
  end if;

  if coalesce(v_tag.status, 'unclaimed') = 'reserved' then
    if v_tag.reserved_until is not null
      and v_tag.reserved_until > now()
      and v_tag.reserved_by_session is not null
      and v_tag.reserved_by_session = p_reserved_by_session then
      update public.tags
      set
        claim_token_hash = p_claim_token_hash,
        reserved_until = p_reserved_until,
        reserved_by_session = p_reserved_by_session
      where tag_id = v_tag.tag_id
      returning * into v_tag;
    else
      return query
        select
          'already_claimed'::text,
          v_tag.tag_id,
          v_tag.sku,
          null::text,
          array[]::text[],
          v_tag.reserved_until;
      return;
    end if;
  elsif coalesce(v_tag.status, 'unclaimed') = 'unclaimed' then
    update public.tags
    set
      status = 'reserved',
      claim_token_hash = p_claim_token_hash,
      reserved_until = p_reserved_until,
      reserved_by_session = p_reserved_by_session
    where tag_id = v_tag.tag_id
    returning * into v_tag;
  else
    return query
      select
        'already_claimed'::text,
        v_tag.tag_id,
        v_tag.sku,
        null::text,
        array[]::text[],
        v_tag.reserved_until;
    return;
  end if;

  if v_tag.sku is null then
    return query
      select
        'sku_not_found'::text,
        v_tag.tag_id,
        null::text,
        null::text,
        array[]::text[],
        v_tag.reserved_until;
    return;
  end if;

  select
    ns.name,
    case
      when ns.base_package_ids is null then array[]::text[]
      else array(select jsonb_array_elements_text(to_jsonb(ns.base_package_ids)))
    end
  into v_necklace_name, v_base_package_ids
  from public.necklace_skus ns
  where ns.sku = v_tag.sku
  limit 1;

  if not found then
    return query
      select
        'sku_not_found'::text,
        v_tag.tag_id,
        v_tag.sku,
        null::text,
        array[]::text[],
        v_tag.reserved_until;
    return;
  end if;

  return query
    select
      'reserved'::text,
      v_tag.tag_id,
      v_tag.sku,
      coalesce(v_necklace_name, v_tag.sku),
      coalesce(v_base_package_ids, array[]::text[]),
      v_tag.reserved_until;
end;
$$;

create or replace function public.claim_reserved_activation(
  p_claim_token_hash text,
  p_user_id uuid
)
returns table (
  result text,
  tag_id text,
  sku text,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag public.tags%rowtype;
begin
  select *
  into v_tag
  from public.tags
  where claim_token_hash = p_claim_token_hash
  for update;

  if not found then
    select *
    into v_tag
    from public.tags
    where claimed_token_hash = p_claim_token_hash
    limit 1;

    if found then
      if v_tag.owner_user_id = p_user_id then
        return query
          select
            'already_claimed_by_user'::text,
            v_tag.tag_id,
            v_tag.sku,
            v_tag.owner_user_id;
        return;
      end if;

      return query
        select
          'already_claimed'::text,
          v_tag.tag_id,
          v_tag.sku,
          v_tag.owner_user_id;
      return;
    end if;

    return query
      select
        'invalid_token'::text,
        null::text,
        null::text,
        null::uuid;
    return;
  end if;

  if coalesce(v_tag.status, 'unclaimed') = 'claimed' then
    if v_tag.owner_user_id = p_user_id then
      return query
        select
          'already_claimed_by_user'::text,
          v_tag.tag_id,
          v_tag.sku,
          v_tag.owner_user_id;
      return;
    end if;

    return query
      select
        'already_claimed'::text,
        v_tag.tag_id,
        v_tag.sku,
        v_tag.owner_user_id;
    return;
  end if;

  if coalesce(v_tag.status, 'unclaimed') <> 'reserved' then
    return query
      select
        'invalid_token'::text,
        null::text,
        null::text,
        null::uuid;
    return;
  end if;

  if v_tag.reserved_until is null or v_tag.reserved_until <= now() then
    update public.tags
    set
      status = 'unclaimed',
      reserved_until = null,
      reserved_by_session = null,
      claim_token_hash = null
    where tag_id = v_tag.tag_id;

    return query
      select
        'token_expired'::text,
        v_tag.tag_id,
        v_tag.sku,
        null::uuid;
    return;
  end if;

  update public.tags
  set
    status = 'claimed',
    owner_user_id = p_user_id,
    claimed_at = now(),
    claimed_token_hash = p_claim_token_hash,
    claim_token_hash = null,
    reserved_until = null,
    reserved_by_session = null
  where tag_id = v_tag.tag_id
  returning * into v_tag;

  return query
    select
      'claimed'::text,
      v_tag.tag_id,
      v_tag.sku,
      v_tag.owner_user_id;
end;
$$;
