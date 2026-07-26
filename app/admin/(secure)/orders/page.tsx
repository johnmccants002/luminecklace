import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader, fieldClass, tableClass } from "@/components/admin/ui";
import { PAGE_SIZE } from "@/lib/admin/data";
import { formatDate, getPage } from "@/lib/admin/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = getPage(params.page);
  const q = typeof params.q === "string" ? params.q.replace(/[%,_()]/g, "").slice(0, 100) : "";
  const state = typeof params.state === "string" ? params.state : "";
  const from = (page - 1) * PAGE_SIZE;
  let query = supabaseAdmin
    .from("orders")
    .select("id, shopify_order_id, purchaser_email_normalized, purchaser_auth_user_id, financial_status, ingestion_outcome, shopify_created_at, created_at, updated_at, total_price, currency", { count: "exact" })
    .order("shopify_created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (q) query = query.or(`shopify_order_id.ilike.%${q}%,purchaser_email_normalized.ilike.%${q}%`);
  if (["ready", "ignored", "manual_review", "processing"].includes(state)) query = query.eq("ingestion_outcome", state);
  const orders = await query;
  if (orders.error) throw new Error("Unable to load Shopify orders");

  const orderIds = (orders.data ?? []).map((order) => order.id);
  const items = orderIds.length
    ? await supabaseAdmin.from("order_items").select("id, order_id, quantity, is_lumi_eligible").in("order_id", orderIds)
    : { data: [], error: null };
  if (items.error) throw new Error("Unable to load order line items");
  const itemIds = (items.data ?? []).map((item) => item.id);
  const units = itemIds.length
    ? await supabaseAdmin.from("order_item_units").select("id, order_item_id, allocation_status").in("order_item_id", itemIds)
    : { data: [], error: null };
  if (units.error) throw new Error("Unable to load purchased units");

  const total = orders.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader title="Shopify orders" description="Paid-order ingestion, eligible units, account provisioning, and physical allocation." />
      <Card>
        <form className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
          <input name="q" defaultValue={q} placeholder="Order number or buyer email" className={fieldClass} aria-label="Search orders" />
          <select name="state" defaultValue={state} className={fieldClass} aria-label="Ingestion outcome">
            <option value="">All ingestion outcomes</option>
            <option value="ready">ready</option><option value="processing">processing</option><option value="manual_review">manual review</option><option value="ignored">ignored</option>
          </select>
          <button className="h-10 rounded-full bg-[#2a1214] px-5 text-sm font-semibold text-white">Filter</button>
        </form>
      </Card>
      <Card>
        <div className="mb-4 flex justify-between text-sm text-[#765d60]"><span>{total} orders</span><span>Page {page} of {pages}</span></div>
        {(orders.data ?? []).length ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th>Order</th><th>Buyer</th><th>Payment</th><th>Eligible / assigned</th><th>Provisioning</th><th>Timestamp</th></tr></thead>
              <tbody>
                {(orders.data ?? []).map((order) => {
                  const orderItems = (items.data ?? []).filter((item) => item.order_id === order.id);
                  const eligibleItemIds = orderItems.filter((item) => item.is_lumi_eligible).map((item) => item.id);
                  const orderUnits = (units.data ?? []).filter((unit) => eligibleItemIds.includes(unit.order_item_id));
                  return (
                    <tr key={order.id}>
                      <td><Link href={`/admin/orders/${order.id}`} className="font-semibold hover:underline">#{order.shopify_order_id ?? "—"}</Link><p className="text-xs text-[#8d7376]">{order.currency ?? ""} {order.total_price ?? "—"}</p></td>
                      <td>{order.purchaser_email_normalized ?? "—"}</td>
                      <td><Badge tone={order.financial_status === "paid" ? "success" : "neutral"}>{order.financial_status ?? "—"}</Badge></td>
                      <td>{orderUnits.length} / {orderUnits.filter((unit) => unit.allocation_status === "assigned").length}</td>
                      <td><Badge tone={order.purchaser_auth_user_id ? "success" : order.ingestion_outcome === "manual_review" ? "warning" : "neutral"}>{order.purchaser_auth_user_id ? "linked" : order.ingestion_outcome}</Badge></td>
                      <td>{formatDate(order.shopify_created_at ?? order.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No Shopify orders match these filters.</EmptyState>}
      </Card>
    </div>
  );
}

