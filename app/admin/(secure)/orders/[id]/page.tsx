import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader, tableClass } from "@/components/admin/ui";
import { formatDate } from "@/lib/admin/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, items, deliveries] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id, shop_domain, shopify_order_id, purchaser_email_normalized, purchaser_auth_user_id, financial_status, ingestion_outcome, shopify_created_at, shopify_updated_at, processed_at, cancelled_at, currency, total_price, total_outstanding, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("order_items")
      .select("id, order_id, shopify_line_item_id, sku, title, quantity, current_quantity, unit_price, is_lumi_eligible")
      .eq("order_id", id)
      .order("created_at"),
    supabaseAdmin
      .from("shopify_webhook_deliveries")
      .select("id, processing_state, outcome, attempt_count, last_error, received_at, processed_at, updated_at")
      .eq("order_id", id)
      .order("received_at", { ascending: false }),
  ]);
  if (order.error || items.error || deliveries.error) throw new Error("Unable to load order detail");
  if (!order.data) notFound();
  const itemIds = (items.data ?? []).map((item) => item.id);
  const units = itemIds.length
    ? await supabaseAdmin.from("order_item_units").select("id, order_item_id, unit_ordinal, allocation_status, created_at, updated_at").in("order_item_id", itemIds)
    : { data: [], error: null };
  if (units.error) throw new Error("Unable to load order allocations");

  return (
    <div className="space-y-6">
      <PageHeader title={`Order #${order.data.shopify_order_id ?? "—"}`} description="Persisted Shopify financial snapshot and provisioning state." actions={<Link href="/admin/orders" className="text-sm font-semibold">← Orders</Link>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Line items and purchased units</h2>
            <div className="mt-4 overflow-x-auto">
              <table className={tableClass}>
                <thead><tr><th>Line item</th><th>SKU</th><th>Quantity</th><th>Eligible</th><th>Units</th></tr></thead>
                <tbody>{(items.data ?? []).map((item) => (
                  <tr key={item.id}>
                    <td><p className="font-medium">{item.title ?? "Untitled"}</p><p className="font-mono text-xs text-[#8d7376]">{item.shopify_line_item_id}</p></td>
                    <td>{item.sku ?? "—"}</td><td>{item.current_quantity ?? item.quantity}</td>
                    <td><Badge tone={item.is_lumi_eligible ? "success" : "neutral"}>{item.is_lumi_eligible ? "Lumi" : "No"}</Badge></td>
                    <td>{(units.data ?? []).filter((unit) => unit.order_item_id === item.id).map((unit) => <div key={unit.id} className="mb-1 font-mono text-xs">{unit.unit_ordinal}: {unit.allocation_status} · {unit.id.slice(0, 8)}</div>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Card>
            <h2 className="mb-4 font-serif text-xl">Webhook processing</h2>
            {(deliveries.data ?? []).length ? <div className="space-y-3">{(deliveries.data ?? []).map((delivery) => (
              <div key={delivery.id} className="rounded-xl bg-[#fbf7f5] p-4">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={delivery.processing_state === "processed" ? "success" : "danger"}>{delivery.processing_state}</Badge><span className="text-xs text-[#8d7376]">Attempt {delivery.attempt_count} · {formatDate(delivery.updated_at)}</span></div>
                {delivery.last_error ? <p className="mt-2 text-sm text-red-800">{delivery.last_error.slice(0, 300)}</p> : null}
              </div>
            ))}</div> : <EmptyState>No delivery record is linked to this order.</EmptyState>}
            <p className="mt-4 text-xs text-[#8d7376]">Provisioning retry is deferred: the existing idempotent service requires a verified Shopify payload, and the dashboard intentionally does not persist or replay raw webhook payloads.</p>
          </Card>
        </div>
        <aside className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Order facts</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-xs uppercase text-[#8d7376]">Buyer</dt><dd>{order.data.purchaser_email_normalized ?? "—"}</dd></div>
              <div><dt className="text-xs uppercase text-[#8d7376]">Payment</dt><dd><Badge tone={order.data.financial_status === "paid" ? "success" : "neutral"}>{order.data.financial_status ?? "—"}</Badge></dd></div>
              <div><dt className="text-xs uppercase text-[#8d7376]">Provisioning</dt><dd>{order.data.purchaser_auth_user_id ? <Link href={`/admin/customers/${order.data.purchaser_auth_user_id}`} className="font-semibold hover:underline">Linked customer</Link> : order.data.ingestion_outcome}</dd></div>
              <div><dt className="text-xs uppercase text-[#8d7376]">Total</dt><dd>{order.data.currency ?? ""} {order.data.total_price ?? "—"}</dd></div>
              <div><dt className="text-xs uppercase text-[#8d7376]">Shopify timestamp</dt><dd>{formatDate(order.data.shopify_created_at)}</dd></div>
              <div><dt className="text-xs uppercase text-[#8d7376]">Created / updated</dt><dd>{formatDate(order.data.created_at)}<br />{formatDate(order.data.updated_at)}</dd></div>
            </dl>
          </Card>
          <Card className="border-amber-200 bg-amber-50/60"><h2 className="font-semibold text-amber-950">Deferred operations</h2><p className="mt-2 text-sm text-amber-900">Refunds, cancellations, and unit voiding are visible only through stored financial fields and are not mutable in phase one.</p></Card>
        </aside>
      </div>
    </div>
  );
}

