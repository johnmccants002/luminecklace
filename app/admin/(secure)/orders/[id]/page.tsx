import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  tableClass,
} from "@/components/admin/ui";
import {
  cancelComplimentaryOrder,
  retryComplimentaryOrderProvisioning,
} from "@/lib/admin/actions";
import { formatDate } from "@/lib/admin/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [order, items, deliveries] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select(
        "id, order_source, factory_reference, production_state, purchaser_name, internal_note, shop_domain, shopify_order_id, purchaser_email_normalized, purchaser_auth_user_id, financial_status, ingestion_outcome, shopify_created_at, shopify_updated_at, processed_at, cancelled_at, currency, total_price, total_outstanding, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("order_items")
      .select(
        "id, order_id, shopify_line_item_id, sku, title, quantity, current_quantity, unit_price, is_lumi_eligible"
      )
      .eq("order_id", id)
      .order("created_at"),
    supabaseAdmin
      .from("shopify_webhook_deliveries")
      .select(
        "id, processing_state, outcome, attempt_count, last_error, received_at, processed_at, updated_at"
      )
      .eq("order_id", id)
      .order("received_at", { ascending: false }),
  ]);
  if (order.error || items.error || deliveries.error) {
    throw new Error("Unable to load order detail");
  }
  if (!order.data) notFound();
  const itemIds = (items.data ?? []).map((item) => item.id);
  const units = itemIds.length
    ? await supabaseAdmin
        .from("order_item_units")
        .select(
          "id, order_item_id, unit_ordinal, allocation_status, created_at, updated_at"
        )
        .in("order_item_id", itemIds)
    : { data: [], error: null };
  if (units.error) throw new Error("Unable to load order allocations");

  const isComplimentary = order.data.order_source === "complimentary";
  const isCancelled = order.data.production_state === "cancelled";
  const assignedUnits = (units.data ?? []).filter(
    (unit) => unit.allocation_status === "assigned"
  ).length;
  const reference =
    order.data.factory_reference ?? order.data.shopify_order_id ?? "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Order ${reference}`}
        description={
          isComplimentary
            ? "Complimentary gift, friend account provisioning, and physical allocation."
            : "Persisted Shopify financial snapshot and provisioning state."
        }
        actions={
          <Link href="/admin/orders" className="text-sm font-semibold">
            ← Orders
          </Link>
        }
      />

      {query.created === "1" ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <p className="text-sm font-semibold text-emerald-900">
            Complimentary order created and released to the factory queue.
          </p>
        </Card>
      ) : null}
      {query.provisioning === "failed" ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <p className="font-semibold text-amber-950">Owner setup needs attention</p>
          <p className="mt-1 text-sm text-amber-900">
            The order was saved but remains outside the factory queue. Retry the
            invitation below after checking the email and Auth configuration.
          </p>
        </Card>
      ) : null}
      {query.provisioning === "ready" ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <p className="text-sm font-semibold text-emerald-900">
            Owner setup succeeded and the order is queued for production.
          </p>
        </Card>
      ) : null}
      {query.cancelled === "1" ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <p className="text-sm font-semibold text-amber-950">
            Complimentary order cancelled. It is no longer visible to the
            factory queue.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Line items and production units</h2>
            <div className="mt-4 overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>Line item</th>
                    <th>SKU</th>
                    <th>Quantity</th>
                    <th>Eligible</th>
                    <th>Units</th>
                  </tr>
                </thead>
                <tbody>
                  {(items.data ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <p className="font-medium">{item.title ?? "Untitled"}</p>
                        {item.shopify_line_item_id ? (
                          <p className="font-mono text-xs text-[#8d7376]">
                            {item.shopify_line_item_id}
                          </p>
                        ) : null}
                      </td>
                      <td>{item.sku ?? "—"}</td>
                      <td>{item.current_quantity ?? item.quantity}</td>
                      <td>
                        <Badge tone={item.is_lumi_eligible ? "success" : "neutral"}>
                          {item.is_lumi_eligible ? "Lumi" : "No"}
                        </Badge>
                      </td>
                      <td>
                        {(units.data ?? [])
                          .filter((unit) => unit.order_item_id === item.id)
                          .map((unit) => (
                            <div key={unit.id} className="mb-1 font-mono text-xs">
                              {unit.unit_ordinal}: {unit.allocation_status} ·{" "}
                              {unit.id.slice(0, 8)}
                            </div>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {isComplimentary ? (
            <Card>
              <h2 className="font-serif text-xl">Complimentary gift</h2>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase text-[#8d7376]">Friend</dt>
                  <dd>{order.data.purchaser_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-[#8d7376]">Email</dt>
                  <dd>{order.data.purchaser_email_normalized}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase text-[#8d7376]">
                    Internal note
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap">
                    {order.data.internal_note ?? "—"}
                  </dd>
                </div>
              </dl>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-4 font-serif text-xl">Webhook processing</h2>
              {(deliveries.data ?? []).length ? (
                <div className="space-y-3">
                  {(deliveries.data ?? []).map((delivery) => (
                    <div
                      key={delivery.id}
                      className="rounded-xl bg-[#fbf7f5] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            delivery.processing_state === "processed"
                              ? "success"
                              : "danger"
                          }
                        >
                          {delivery.processing_state}
                        </Badge>
                        <span className="text-xs text-[#8d7376]">
                          Attempt {delivery.attempt_count} ·{" "}
                          {formatDate(delivery.updated_at)}
                        </span>
                      </div>
                      {delivery.last_error ? (
                        <p className="mt-2 text-sm text-red-800">
                          {delivery.last_error.slice(0, 300)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>No delivery record is linked to this order.</EmptyState>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Order facts</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase text-[#8d7376]">Source</dt>
                <dd>
                  <Badge tone={isComplimentary ? "warning" : "neutral"}>
                    {order.data.order_source}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[#8d7376]">Owner</dt>
                <dd>{order.data.purchaser_email_normalized ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[#8d7376]">Production</dt>
                <dd>
                  <Badge
                    tone={
                      order.data.production_state === "queued"
                        ? "success"
                        : order.data.production_state === "pending_owner" ||
                            order.data.production_state === "manual_review"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {order.data.production_state}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[#8d7376]">
                  Account provisioning
                </dt>
                <dd>
                  {order.data.purchaser_auth_user_id ? (
                    <Link
                      href={`/admin/customers/${order.data.purchaser_auth_user_id}`}
                      className="font-semibold hover:underline"
                    >
                      Linked friend account
                    </Link>
                  ) : (
                    "Pending"
                  )}
                </dd>
              </div>
              {!isComplimentary ? (
                <>
                  <div>
                    <dt className="text-xs uppercase text-[#8d7376]">Payment</dt>
                    <dd>
                      <Badge
                        tone={
                          order.data.financial_status === "paid"
                            ? "success"
                            : "neutral"
                        }
                      >
                        {order.data.financial_status ?? "—"}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-[#8d7376]">Total</dt>
                    <dd>
                      {order.data.currency ?? ""} {order.data.total_price ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-[#8d7376]">
                      Shopify timestamp
                    </dt>
                    <dd>{formatDate(order.data.shopify_created_at)}</dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt className="text-xs uppercase text-[#8d7376]">
                  Created / updated
                </dt>
                <dd>
                  {formatDate(order.data.created_at)}
                  <br />
                  {formatDate(order.data.updated_at)}
                </dd>
              </div>
            </dl>
          </Card>

          {isComplimentary && !isCancelled ? (
            <Card>
              <h2 className="font-serif text-xl">Gift operations</h2>
              {order.data.production_state === "pending_owner" ? (
                <form
                  action={retryComplimentaryOrderProvisioning}
                  className="mt-4"
                >
                  <input type="hidden" name="orderId" value={order.data.id} />
                  <ConfirmSubmit confirmation={`Retry account setup for ${order.data.purchaser_email_normalized}?`}>
                    Retry owner setup
                  </ConfirmSubmit>
                </form>
              ) : null}
              <form action={cancelComplimentaryOrder} className="mt-4">
                <input type="hidden" name="orderId" value={order.data.id} />
                <ConfirmSubmit
                  tone="danger"
                  confirmation="Cancel this complimentary order? It will be removed from the factory queue."
                >
                  Cancel gift order
                </ConfirmSubmit>
              </form>
              {assignedUnits > 0 ? (
                <p className="mt-3 text-xs text-amber-800">
                  Unlink all assigned necklaces before cancellation.
                </p>
              ) : null}
            </Card>
          ) : null}

          {!isComplimentary ? (
            <Card className="border-amber-200 bg-amber-50/60">
              <h2 className="font-semibold text-amber-950">
                Deferred operations
              </h2>
              <p className="mt-2 text-sm text-amber-900">
                Refunds, cancellations, and unit voiding remain read-only for
                Shopify orders.
              </p>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
