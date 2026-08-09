-- Persist Shopify's human-facing order number for Factory work-slip lookup.

alter table public.orders
    add column if not exists shopify_order_number text;

create unique index if not exists orders_shopify_order_number_unique
    on public.orders (shop_domain, shopify_order_number)
    where shop_domain is not null
      and shopify_order_number is not null;

comment on column public.orders.shopify_order_number is
    'Human-facing Shopify order number (for example 1048), distinct from the Shopify order ID.';
