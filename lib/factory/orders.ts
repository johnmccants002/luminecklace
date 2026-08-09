import "server-only";

import {
  serializeFactoryOrderDetail,
  serializeFactoryOrderList,
  type FactoryOrderRow,
} from "@/lib/factory/serialize";
import type {
  FactoryOrderDetail,
  FactoryOrderListResponse,
} from "@/lib/factory/types";
import {
  FactoryApiError,
  type FactoryOrderListInput,
} from "@/lib/factory/validation";
import { supabaseAdmin } from "@/lib/supabase/admin";

const FACTORY_ORDER_SELECT = `
  id,
  shopify_order_id,
  shopify_order_number,
  purchaser_email_normalized,
  purchaser_auth_user_id,
  financial_status,
  ingestion_outcome,
  shopify_created_at,
  currency,
  total_price,
  order_items!inner (
    id,
    shopify_line_item_id,
    title,
    sku,
    quantity,
    current_quantity,
    is_lumi_eligible,
    order_item_units (
      id,
      unit_ordinal,
      allocation_status
    )
  )
`;

export async function listFactoryOrders(
  input: FactoryOrderListInput
): Promise<FactoryOrderListResponse> {
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from("orders")
    .select(FACTORY_ORDER_SELECT, { count: "exact" })
    .eq("financial_status", "paid")
    .is("cancelled_at", null)
    .in("ingestion_outcome", ["ready", "manual_review"])
    .eq("order_items.is_lumi_eligible", true)
    .order("shopify_created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (input.search) {
    const value = input.search;
    query = query.or(
      `shopify_order_number.ilike.%${value}%,shopify_order_id.ilike.%${value}%,purchaser_email_normalized.ilike.%${value}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error("Unable to load factory orders");

  const rows = (data ?? []) as unknown as FactoryOrderRow[];
  const orders = serializeFactoryOrderList(rows).filter(
    (order) => !input.status || order.factoryStatus === input.status
  );

  return {
    orders,
    nextPage: count !== null && to + 1 < count ? input.page + 1 : null,
  };
}

export async function getFactoryOrderById(
  id: string
): Promise<FactoryOrderDetail | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(FACTORY_ORDER_SELECT)
    .eq("id", id)
    .eq("financial_status", "paid")
    .is("cancelled_at", null)
    .in("ingestion_outcome", ["ready", "manual_review"])
    .eq("order_items.is_lumi_eligible", true)
    .maybeSingle();

  if (error) throw new Error("Unable to load factory order detail");
  return data
    ? serializeFactoryOrderDetail(data as unknown as FactoryOrderRow)
    : null;
}

export async function getFactoryOrderByNumber(
  orderNumber: string
): Promise<FactoryOrderDetail | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(FACTORY_ORDER_SELECT)
    .eq("financial_status", "paid")
    .is("cancelled_at", null)
    .in("ingestion_outcome", ["ready", "manual_review"])
    .eq("order_items.is_lumi_eligible", true)
    .or(
      `shopify_order_number.eq.${orderNumber},shopify_order_id.eq.${orderNumber}`
    )
    .limit(2);

  if (error) throw new Error("Unable to look up factory order");
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    throw new FactoryApiError("Order lookup is ambiguous", 409);
  }
  return serializeFactoryOrderDetail(data[0] as unknown as FactoryOrderRow);
}
