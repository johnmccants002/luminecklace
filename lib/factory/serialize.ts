import type {
  FactoryOrderDetail,
  FactoryOrderItem,
  FactoryOrderSummary,
  FactoryOrderUnit,
  FactoryStatus,
} from "@/lib/factory/types";

export type FactoryOrderUnitRow = {
  id: string;
  unit_ordinal: number;
  allocation_status: string;
  [key: string]: unknown;
};

export type FactoryOrderItemRow = {
  id: string;
  shopify_line_item_id: string | null;
  title: string | null;
  sku: string | null;
  quantity: number;
  current_quantity: number | null;
  is_lumi_eligible: boolean;
  order_item_units: FactoryOrderUnitRow[] | null;
  [key: string]: unknown;
};

export type FactoryOrderRow = {
  id: string;
  order_source: string;
  factory_reference: string | null;
  production_state: string;
  purchaser_name: string | null;
  shopify_order_id: string | null;
  shopify_order_number: string | null;
  purchaser_email_normalized: string | null;
  purchaser_auth_user_id: string | null;
  financial_status: string | null;
  ingestion_outcome: string;
  created_at: string;
  shopify_created_at: string | null;
  currency: string | null;
  total_price: string | number | null;
  order_items: FactoryOrderItemRow[] | null;
  [key: string]: unknown;
};

function eligibleItems(row: FactoryOrderRow) {
  return (row.order_items ?? []).filter((item) => item.is_lumi_eligible);
}

function unitsFor(items: FactoryOrderItemRow[]) {
  return items.flatMap((item) => item.order_item_units ?? []);
}

function mapUnit(row: FactoryOrderUnitRow): FactoryOrderUnit {
  return {
    id: row.id,
    unitOrdinal: row.unit_ordinal,
    allocationStatus:
      row.allocation_status === "assigned" ? "assigned" : "unassigned",
  };
}

export function deriveFactoryStatus(
  ingestionOutcome: string,
  units: FactoryOrderUnitRow[]
): FactoryStatus {
  if (ingestionOutcome === "manual_review") return "manual_review";

  const assigned = units.filter(
    (unit) => unit.allocation_status === "assigned"
  ).length;
  if (units.length === 0 || assigned === 0) return "needs_nfc";
  if (assigned < units.length) return "in_progress";
  return "ready";
}

export function serializeFactoryOrderSummary(
  row: FactoryOrderRow
): FactoryOrderSummary | null {
  const items = eligibleItems(row);
  const units = unitsFor(items);
  if (units.length === 0) return null;
  const assigned = units.filter(
    (unit) => unit.allocation_status === "assigned"
  ).length;

  return {
    id: row.id,
    orderNumber:
      row.factory_reference ?? row.shopify_order_number ?? row.shopify_order_id ?? row.id,
    source: row.order_source === "complimentary" ? "complimentary" : "shopify",
    customer: {
      name: row.purchaser_name,
      email: row.purchaser_email_normalized,
    },
    createdAt: row.shopify_created_at ?? row.created_at,
    shopifyCreatedAt: row.shopify_created_at,
    financialStatus:
      row.order_source === "complimentary" ? null : (row.financial_status ?? "paid"),
    currency: row.currency,
    totalPrice: row.total_price === null ? null : String(row.total_price),
    lumiUnits: {
      total: units.length,
      assigned,
      unassigned: units.length - assigned,
    },
    factoryStatus: deriveFactoryStatus(row.ingestion_outcome, units),
  };
}

export function serializeFactoryOrderList(
  rows: FactoryOrderRow[]
): FactoryOrderSummary[] {
  return rows.flatMap((row) => {
    const order = serializeFactoryOrderSummary(row);
    return order ? [order] : [];
  });
}

function serializeItem(row: FactoryOrderItemRow): FactoryOrderItem {
  return {
    id: row.id,
    shopifyLineItemId: row.shopify_line_item_id,
    title: row.title,
    sku: row.sku,
    quantity: row.current_quantity ?? row.quantity,
    isLumiEligible: true,
    units: (row.order_item_units ?? [])
      .map(mapUnit)
      .sort((left, right) => left.unitOrdinal - right.unitOrdinal),
  };
}

export function serializeFactoryOrderDetail(
  row: FactoryOrderRow
): FactoryOrderDetail | null {
  const items = eligibleItems(row);
  const units = unitsFor(items);
  if (units.length === 0) return null;

  return {
    id: row.id,
    orderNumber:
      row.factory_reference ?? row.shopify_order_number ?? row.shopify_order_id ?? row.id,
    source: row.order_source === "complimentary" ? "complimentary" : "shopify",
    customer: {
      name: row.purchaser_name,
      email: row.purchaser_email_normalized,
      authUserId: row.purchaser_auth_user_id,
    },
    financialStatus:
      row.order_source === "complimentary" ? null : (row.financial_status ?? "paid"),
    createdAt: row.shopify_created_at ?? row.created_at,
    shopifyCreatedAt: row.shopify_created_at,
    factoryStatus: deriveFactoryStatus(row.ingestion_outcome, units),
    items: items.map(serializeItem),
  };
}
