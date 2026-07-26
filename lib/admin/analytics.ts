import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

type CountFilter =
  | { operation: "eq"; column: string; value: string }
  | { operation: "gte"; column: string; value: string }
  | { operation: "notNull"; column: string };

async function count(table: string, filter?: CountFilter): Promise<number> {
  let query = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (filter?.operation === "eq") query = query.eq(filter.column, filter.value);
  if (filter?.operation === "gte") query = query.gte(filter.column, filter.value);
  if (filter?.operation === "notNull") query = query.not(filter.column, "is", null);
  const { count: result, error } = await query;
  if (error) throw new Error(`Unable to calculate ${table} metric`);
  return result ?? 0;
}

export async function getOverviewMetrics(adminUserId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    customers,
    paidOrders,
    eligibleUnits,
    inventory,
    activated,
    tapsToday,
    tapsSevenDays,
    catalogMessages,
    queuedLumis,
    viewedMessages,
    assignedUnits,
    provisionedOrders,
    operational,
  ] = await Promise.all([
    count("profiles"),
    count("orders", { operation: "eq", column: "financial_status", value: "paid" }),
    count("order_item_units"),
    count("necklaces"),
    count("necklaces", { operation: "eq", column: "lifecycle_status", value: "active" }),
    count("tap_events", { operation: "gte", column: "tapped_at", value: today.toISOString() }),
    count("tap_events", { operation: "gte", column: "tapped_at", value: sevenDaysAgo.toISOString() }),
    count("messages"),
    count("necklace_lumis"),
    count("necklace_lumis", { operation: "notNull", column: "revealed_at" }),
    count("order_item_units", { operation: "eq", column: "allocation_status", value: "assigned" }),
    count("orders", { operation: "notNull", column: "purchaser_auth_user_id" }),
    supabaseAdmin.rpc("get_admin_operational_metrics", {
      p_admin_user_id: adminUserId,
    }),
  ]);
  if (operational.error) throw new Error("Unable to calculate operational metrics");
  const aggregate =
    operational.data && typeof operational.data === "object" && !Array.isArray(operational.data)
      ? (operational.data as Record<string, unknown>)
      : {};

  return {
    customers,
    paidOrders,
    eligibleUnits,
    inventory,
    activated,
    awaitingActivation: Math.max(inventory - activated, 0),
    tapsToday,
    tapsSevenDays,
    messages: catalogMessages + queuedLumis,
    viewedMessages,
    purchaseProvisionedRate: paidOrders ? provisionedOrders / paidOrders : null,
    purchaseAssignedRate: eligibleUnits ? assignedUnits / eligibleUnits : null,
    activationRate: inventory ? activated / inventory : null,
    firstTaps: typeof aggregate.first_taps === "number" ? aggregate.first_taps : 0,
    repeatTaps: typeof aggregate.repeat_taps === "number" ? aggregate.repeat_taps : 0,
    messagesPerActiveNecklace:
      typeof aggregate.messages_per_active_necklace === "number"
        ? aggregate.messages_per_active_necklace
        : null,
    averageActivationHours:
      typeof aggregate.average_purchase_to_activation_hours === "number"
        ? aggregate.average_purchase_to_activation_hours
        : null,
  };
}

export async function getOverviewActivity() {
  const [orders, activations, taps, failures] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id, shopify_order_id, purchaser_email_normalized, financial_status, shopify_created_at, created_at")
      .eq("financial_status", "paid")
      .order("shopify_created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("necklaces")
      .select("id, tag_ref, name, activated_at, updated_at")
      .eq("lifecycle_status", "active")
      .order("activated_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("tap_events")
      .select("id, necklace_id, status, tapped_at")
      .order("tapped_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("shopify_webhook_deliveries")
      .select("id, order_id, processing_state, last_error, updated_at")
      .eq("processing_state", "retryable_error")
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  for (const result of [orders, activations, taps, failures]) {
    if (result.error) throw new Error("Unable to load recent admin activity");
  }

  return {
    orders: orders.data ?? [],
    activations: activations.data ?? [],
    taps: taps.data ?? [],
    failures: failures.data ?? [],
  };
}
