import { randomUUID } from "node:crypto";

import Link from "next/link";

import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  fieldClass,
  tableClass,
} from "@/components/admin/ui";
import { createComplimentaryOrder } from "@/lib/admin/actions";
import { PAGE_SIZE } from "@/lib/admin/data";
import { formatDate, getPage } from "@/lib/admin/format";
import { parseShopifyLumiSkus } from "@/lib/shopify/webhook";
import { supabaseAdmin } from "@/lib/supabase/admin";

const productionStates = [
  "pending_owner",
  "queued",
  "manual_review",
  "excluded",
  "cancelled",
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = getPage(params.page);
  const q =
    typeof params.q === "string"
      ? params.q.replace(/[%,_()]/g, "").slice(0, 100)
      : "";
  const state =
    typeof params.state === "string" && productionStates.includes(params.state)
      ? params.state
      : "";
  const source =
    params.source === "shopify" || params.source === "complimentary"
      ? params.source
      : "";
  const from = (page - 1) * PAGE_SIZE;
  let query = supabaseAdmin
    .from("orders")
    .select(
      "id, order_source, factory_reference, purchaser_name, purchaser_email_normalized, purchaser_auth_user_id, financial_status, ingestion_outcome, production_state, shopify_order_id, shopify_created_at, created_at, updated_at, total_price, currency",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (q) {
    query = query.or(
      `factory_reference.ilike.%${q}%,shopify_order_id.ilike.%${q}%,purchaser_name.ilike.%${q}%,purchaser_email_normalized.ilike.%${q}%`
    );
  }
  if (state) query = query.eq("production_state", state);
  if (source) query = query.eq("order_source", source);
  const orders = await query;
  if (orders.error) throw new Error("Unable to load orders");

  const orderIds = (orders.data ?? []).map((order) => order.id);
  const items = orderIds.length
    ? await supabaseAdmin
        .from("order_items")
        .select("id, order_id, quantity, is_lumi_eligible")
        .in("order_id", orderIds)
    : { data: [], error: null };
  if (items.error) throw new Error("Unable to load order line items");
  const itemIds = (items.data ?? []).map((item) => item.id);
  const units = itemIds.length
    ? await supabaseAdmin
        .from("order_item_units")
        .select("id, order_item_id, allocation_status")
        .in("order_item_id", itemIds)
    : { data: [], error: null };
  if (units.error) throw new Error("Unable to load order units");

  const eligibleSkus = Array.from(
    parseShopifyLumiSkus(process.env.SHOPIFY_LUMI_SKUS)
  ).sort();
  const total = orders.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Shopify purchases and complimentary gifts moving through account setup and physical production."
      />

      <Card>
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div>
            <h2 className="font-serif text-xl">Create complimentary order</h2>
            <p className="mt-2 text-sm text-[#765d60]">
              The friend becomes the necklace owner. Creating the order sends
              them an account setup invitation immediately if needed.
            </p>
          </div>
          <form
            action={createComplimentaryOrder}
            className="grid gap-3 sm:grid-cols-2"
          >
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <input
              name="purchaserName"
              maxLength={120}
              placeholder="Friend name (optional)"
              className={fieldClass}
              aria-label="Friend name"
            />
            <input
              name="purchaserEmail"
              type="email"
              required
              placeholder="Friend email"
              className={fieldClass}
              aria-label="Friend email"
            />
            <select name="sku" required className={fieldClass} aria-label="SKU">
              {eligibleSkus.map((sku) => (
                <option key={sku} value={sku}>
                  {sku}
                </option>
              ))}
            </select>
            <input
              name="quantity"
              type="number"
              min={1}
              max={20}
              defaultValue={1}
              required
              className={fieldClass}
              aria-label="Quantity"
            />
            <textarea
              name="internalNote"
              maxLength={500}
              placeholder="Internal note (optional; never shown in the factory API)"
              className={`${fieldClass} min-h-24 sm:col-span-2`}
              aria-label="Internal note"
            />
            <div className="sm:col-span-2">
              <ConfirmSubmit confirmation="Create this complimentary order and email the friend an account setup invitation if they do not already have one?">
                Create gift order
              </ConfirmSubmit>
            </div>
          </form>
        </div>
      </Card>

      <Card>
        <form className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <input
            name="q"
            defaultValue={q}
            placeholder="Reference, name, or email"
            className={fieldClass}
            aria-label="Search orders"
          />
          <select
            name="source"
            defaultValue={source}
            className={fieldClass}
            aria-label="Order source"
          >
            <option value="">All sources</option>
            <option value="shopify">Shopify</option>
            <option value="complimentary">Complimentary</option>
          </select>
          <select
            name="state"
            defaultValue={state}
            className={fieldClass}
            aria-label="Production state"
          >
            <option value="">All production states</option>
            {productionStates.map((value) => (
              <option key={value} value={value}>
                {value.replace("_", " ")}
              </option>
            ))}
          </select>
          <button className="h-10 rounded-full bg-[#2a1214] px-5 text-sm font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>

      <Card>
        <div className="mb-4 flex justify-between text-sm text-[#765d60]">
          <span>{total} orders</span>
          <span>
            Page {page} of {pages}
          </span>
        </div>
        {(orders.data ?? []).length ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Owner</th>
                  <th>Source</th>
                  <th>Eligible / assigned</th>
                  <th>Production</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(orders.data ?? []).map((order) => {
                  const orderItems = (items.data ?? []).filter(
                    (item) => item.order_id === order.id
                  );
                  const eligibleItemIds = orderItems
                    .filter((item) => item.is_lumi_eligible)
                    .map((item) => item.id);
                  const orderUnits = (units.data ?? []).filter((unit) =>
                    eligibleItemIds.includes(unit.order_item_id)
                  );
                  const assigned = orderUnits.filter(
                    (unit) => unit.allocation_status === "assigned"
                  ).length;
                  return (
                    <tr key={order.id}>
                      <td>
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-semibold hover:underline"
                        >
                          {order.factory_reference ?? order.shopify_order_id ?? "—"}
                        </Link>
                        {order.order_source === "shopify" ? (
                          <p className="text-xs text-[#8d7376]">
                            {order.currency ?? ""} {order.total_price ?? "—"}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <p>{order.purchaser_name ?? "—"}</p>
                        <p className="text-xs text-[#8d7376]">
                          {order.purchaser_email_normalized ?? "—"}
                        </p>
                      </td>
                      <td>
                        <Badge
                          tone={
                            order.order_source === "complimentary"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {order.order_source}
                        </Badge>
                      </td>
                      <td>
                        {orderUnits.length} / {assigned}
                      </td>
                      <td>
                        <Badge
                          tone={
                            order.production_state === "queued"
                              ? "success"
                              : order.production_state === "pending_owner" ||
                                  order.production_state === "manual_review"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {order.purchaser_auth_user_id
                            ? order.production_state
                            : order.production_state === "pending_owner"
                              ? "owner setup pending"
                              : order.production_state}
                        </Badge>
                      </td>
                      <td>
                        {formatDate(order.shopify_created_at ?? order.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No orders match these filters.</EmptyState>
        )}

        <div className="mt-5 flex justify-between">
          {page > 1 ? (
            <Link
              className="text-sm font-semibold"
              href={`?q=${encodeURIComponent(q)}&source=${source}&state=${state}&page=${page - 1}`}
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link
              className="text-sm font-semibold"
              href={`?q=${encodeURIComponent(q)}&source=${source}&state=${state}&page=${page + 1}`}
            >
              Next →
            </Link>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
