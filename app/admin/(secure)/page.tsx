import Link from "next/link";

import {
  Badge,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  tableClass,
} from "@/components/admin/ui";
import { getOverviewActivity, getOverviewMetrics } from "@/lib/admin/analytics";
import { requireAdmin } from "@/lib/admin/auth";
import { formatDate, formatNumber } from "@/lib/admin/format";

function rate(value: number | null) {
  return value === null ? "Not available" : `${Math.round(value * 100)}%`;
}

export default async function AdminOverviewPage() {
  const { user } = await requireAdmin();
  const [metrics, activity] = await Promise.all([
    getOverviewMetrics(user.id),
    getOverviewActivity(),
  ]);

  const cards = [
    ["Customer accounts", formatNumber(metrics.customers)],
    ["Paid Shopify orders", formatNumber(metrics.paidOrders)],
    ["Eligible purchased units", formatNumber(metrics.eligibleUnits)],
    ["Inventory records", formatNumber(metrics.inventory)],
    ["Activated necklaces", formatNumber(metrics.activated)],
    ["Awaiting activation", formatNumber(metrics.awaitingActivation)],
    ["NFC taps today", formatNumber(metrics.tapsToday)],
    ["NFC taps · 7 days", formatNumber(metrics.tapsSevenDays)],
    ["Messages created", formatNumber(metrics.messages)],
    ["Messages viewed", formatNumber(metrics.viewedMessages), "Revealed queued Lumis only"],
  ] as const;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Operations overview"
        description="Live customer, commerce, inventory, and recipient activity from Supabase."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value, note]) => (
          <MetricCard key={label} label={label} value={value} note={note} />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Account provisioned rate" value={rate(metrics.purchaseProvisionedRate)} note="Paid orders linked to Auth" />
        <MetricCard label="Unit assignment rate" value={rate(metrics.purchaseAssignedRate)} note="Eligible units with inventory assigned" />
        <MetricCard label="Necklace activation rate" value={rate(metrics.activationRate)} note="Active necklaces / inventory" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="First taps" value={formatNumber(metrics.firstTaps)} note="Necklaces with recorded tap activity" />
        <MetricCard label="Repeat taps" value={formatNumber(metrics.repeatTaps)} note="Taps after each necklace's first" />
        <MetricCard label="Messages / active necklace" value={metrics.messagesPerActiveNecklace?.toFixed(2) ?? "Not available"} />
        <MetricCard label="Purchase → activation" value={metrics.averageActivationHours === null ? "Not available" : `${metrics.averageActivationHours}h avg`} note="Only exact recorded activation timestamps" />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-xl">Recent paid orders</h2>
            <Link href="/admin/orders" className="text-xs font-semibold text-[#b63d42]">View all</Link>
          </div>
          {activity.orders.length ? (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead><tr><th>Order</th><th>Buyer</th><th>Status</th><th>Paid</th></tr></thead>
                <tbody>
                  {activity.orders.map((order) => (
                    <tr key={order.id}>
                      <td><Link className="font-semibold hover:underline" href={`/admin/orders/${order.id}`}>#{order.shopify_order_id ?? "—"}</Link></td>
                      <td>{order.purchaser_email_normalized ?? "—"}</td>
                      <td><Badge tone="success">{order.financial_status ?? "paid"}</Badge></td>
                      <td>{formatDate(order.shopify_created_at ?? order.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState>No paid orders yet.</EmptyState>}
        </Card>

        <Card>
          <h2 className="mb-4 font-serif text-xl">Recent recipient taps</h2>
          {activity.taps.length ? (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead><tr><th>Status</th><th>Necklace</th><th>Time</th></tr></thead>
                <tbody>
                  {activity.taps.map((tap) => (
                    <tr key={tap.id}>
                      <td><Badge>{tap.status}</Badge></td>
                      <td className="font-mono text-xs">{tap.necklace_id?.slice(0, 8) ?? "Unavailable"}</td>
                      <td>{formatDate(tap.tapped_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState>No tap activity yet.</EmptyState>}
        </Card>

        <Card>
          <h2 className="mb-4 font-serif text-xl">Recent activations</h2>
          {activity.activations.length ? (
            <div className="space-y-2">
              {activity.activations.map((necklace) => (
                <div key={necklace.id} className="flex items-center justify-between rounded-xl bg-[#fbf7f5] p-3 text-sm">
                  <div><p className="font-medium">{necklace.name}</p><p className="text-xs text-[#8d7376]">{necklace.tag_ref ?? necklace.id.slice(0, 8)}</p></div>
                  <span className="text-xs text-[#765d60]">{formatDate(necklace.activated_at ?? necklace.updated_at)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState>No recorded activations.</EmptyState>}
        </Card>

        <Card>
          <h2 className="mb-4 font-serif text-xl">Provisioning attention</h2>
          {activity.failures.length ? (
            <div className="space-y-2">
              {activity.failures.map((failure) => (
                <div key={failure.id} className="rounded-xl border border-red-100 bg-red-50/60 p-3">
                  <div className="flex justify-between gap-4"><Badge tone="danger">Retryable error</Badge><span className="text-xs">{formatDate(failure.updated_at)}</span></div>
                  <p className="mt-2 line-clamp-2 text-sm text-red-900">{failure.last_error ?? "No safe error detail recorded"}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState>No failed or incomplete provisioning deliveries.</EmptyState>}
        </Card>
      </div>

      <Card className="border-amber-200 bg-amber-50/60">
        <h2 className="font-semibold text-amber-950">Known analytics limits</h2>
        <p className="mt-1 text-sm text-amber-900">
          App Clip-to-full-app conversion is not recorded. “Messages viewed” counts revealed queued Lumis and does not claim Reserve content impressions. Purchase-to-activation duration becomes exact only for activations recorded after this migration.
        </p>
      </Card>
    </div>
  );
}
