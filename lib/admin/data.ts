import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const PAGE_SIZE = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeLike(value: string) {
  return value.replace(/[%,_()]/g, "").slice(0, 100);
}

export async function listCustomers(search: string, page: number) {
  const term = escapeLike(search.trim());
  let matchedIds: string[] | null = null;

  if (term) {
    const [profiles, orders, necklaces] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id")
        .or(`email.ilike.%${term}%,display_name.ilike.%${term}%`)
        .limit(500),
      supabaseAdmin
        .from("orders")
        .select("purchaser_auth_user_id")
        .or(
          `factory_reference.ilike.%${term}%,shopify_order_id.ilike.%${term}%,purchaser_name.ilike.%${term}%,purchaser_email_normalized.ilike.%${term}%`
        )
        .not("purchaser_auth_user_id", "is", null)
        .limit(500),
      UUID_PATTERN.test(term)
        ? supabaseAdmin
            .from("necklaces")
            .select("id")
            .or(`tag_ref.ilike.%${term}%,id.eq.${term}`)
            .limit(500)
        : supabaseAdmin
            .from("necklaces")
            .select("id")
            .ilike("tag_ref", `%${term}%`)
            .limit(500),
    ]);
    for (const result of [profiles, orders, necklaces]) {
      if (result.error) throw new Error("Unable to search customers");
    }

    const necklaceIds = (necklaces.data ?? []).map((row) => row.id);
    const ownerships = necklaceIds.length
      ? await supabaseAdmin
          .from("necklace_ownerships")
          .select("sender_user_id")
          .in("necklace_id", necklaceIds)
      : { data: [], error: null };
    if (ownerships.error) throw new Error("Unable to search customer ownerships");

    matchedIds = Array.from(
      new Set([
        ...(profiles.data ?? []).map((row) => row.id),
        ...(orders.data ?? []).flatMap((row) =>
          row.purchaser_auth_user_id ? [row.purchaser_auth_user_id] : []
        ),
        ...(ownerships.data ?? []).map((row) => row.sender_user_id),
      ])
    );
    if (!matchedIds.length) return { rows: [], total: 0 };
  }

  const from = (page - 1) * PAGE_SIZE;
  let query = supabaseAdmin
    .from("profiles")
    .select("id, email, display_name, account_status, created_at, updated_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (matchedIds) query = query.in("id", matchedIds);

  const result = await query;
  if (result.error) throw new Error("Unable to load customers");

  const ids = (result.data ?? []).map((row) => row.id);
  const [orders, ownerships] = await Promise.all([
    ids.length
      ? supabaseAdmin
          .from("orders")
          .select("purchaser_auth_user_id")
          .in("purchaser_auth_user_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabaseAdmin
          .from("necklace_ownerships")
          .select("sender_user_id")
          .in("sender_user_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (orders.error || ownerships.error) throw new Error("Unable to load customer summary");

  return {
    rows: (result.data ?? []).map((profile) => ({
      ...profile,
      orderCount: (orders.data ?? []).filter(
        (order) => order.purchaser_auth_user_id === profile.id
      ).length,
      necklaceCount: (ownerships.data ?? []).filter(
        (ownership) => ownership.sender_user_id === profile.id
      ).length,
    })),
    total: result.count ?? 0,
  };
}

export async function getCustomerDetail(customerId: string) {
  const [profile, auth, orders, ownerships, messages, taps] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, email, display_name, account_status, created_at, updated_at")
      .eq("id", customerId)
      .maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(customerId),
    supabaseAdmin
      .from("orders")
      .select(
        "id, order_source, factory_reference, production_state, shopify_order_id, financial_status, ingestion_outcome, shopify_created_at, created_at"
      )
      .eq("purchaser_auth_user_id", customerId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("necklace_ownerships")
      .select("necklace_id, source_order_id, claimed_at, is_primary")
      .eq("sender_user_id", customerId),
    supabaseAdmin
      .from("messages")
      .select("id, necklace_id, content, state, created_at, published_at")
      .eq("author_user_id", customerId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("tap_events")
      .select("id, necklace_id, status, tapped_at")
      .order("tapped_at", { ascending: false })
      .limit(200),
  ]);

  if (profile.error) throw new Error("Unable to load customer profile");
  if (!profile.data) return null;
  if (auth.error) throw new Error("Unable to load customer authentication state");
  for (const result of [orders, ownerships, messages, taps]) {
    if (result.error) throw new Error("Unable to load customer detail");
  }

  const necklaceIds = (ownerships.data ?? []).map((row) => row.necklace_id);
  const [necklaces, orderItems] = await Promise.all([
    necklaceIds.length
      ? supabaseAdmin
          .from("necklaces")
          .select("id, tag_ref, name, sku, lifecycle_status, inventory_status, activated_at, created_at")
          .in("id", necklaceIds)
      : Promise.resolve({ data: [], error: null }),
    (orders.data ?? []).length
      ? supabaseAdmin
          .from("order_items")
          .select("id, order_id, sku, title, quantity, is_lumi_eligible")
          .in("order_id", (orders.data ?? []).map((row) => row.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (necklaces.error || orderItems.error) throw new Error("Unable to load related customer data");

  const customerTaps = (taps.data ?? [])
    .filter((tap) => tap.necklace_id && necklaceIds.includes(tap.necklace_id))
    .slice(0, 10);

  return {
    profile: profile.data,
    auth: auth.data.user,
    orders: orders.data ?? [],
    orderItems: orderItems.data ?? [],
    ownerships: ownerships.data ?? [],
    necklaces: necklaces.data ?? [],
    messages: messages.data ?? [],
    taps: customerTaps,
  };
}
