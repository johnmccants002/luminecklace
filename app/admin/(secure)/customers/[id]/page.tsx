import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Badge, Card, EmptyState, PageHeader, fieldClass, tableClass } from "@/components/admin/ui";
import {
  recoverCustomerInvitation,
  setCustomerStatus,
  unlinkNecklace,
  updateCustomerEmail,
} from "@/lib/admin/actions";
import { getCustomerDetail } from "@/lib/admin/data";
import { formatDate, safeMessagePreview } from "@/lib/admin/format";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomerDetail(id);
  if (!customer) notFound();
  const { profile, auth } = customer;

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.display_name || profile.email}
        description="Customer account, purchases, physical necklaces, messages, and tap activity."
        actions={<Link href="/admin/customers" className="text-sm font-semibold">← Customers</Link>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Profile and authentication</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-[#8d7376]">Email</dt><dd className="mt-1 font-medium">{profile.email}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-[#8d7376]">Account</dt><dd className="mt-1"><Badge tone={profile.account_status === "paused" ? "warning" : "success"}>{profile.account_status}</Badge></dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-[#8d7376]">Email confirmed</dt><dd className="mt-1">{formatDate(auth.email_confirmed_at)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-[#8d7376]">Invited</dt><dd className="mt-1">{formatDate(auth.invited_at)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-[#8d7376]">Created</dt><dd className="mt-1">{formatDate(profile.created_at)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-[#8d7376]">Updated</dt><dd className="mt-1">{formatDate(profile.updated_at)}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-4 font-serif text-xl">Orders and production units</h2>
            {customer.orders.length ? (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr><th>Order</th><th>Source</th><th>Production</th><th>Eligible units</th><th>Date</th></tr></thead>
                  <tbody>
                    {customer.orders.map((order) => (
                      <tr key={order.id}>
                        <td><Link className="font-semibold hover:underline" href={`/admin/orders/${order.id}`}>{order.factory_reference ?? order.shopify_order_id ?? "—"}</Link></td>
                        <td><Badge tone={order.order_source === "complimentary" ? "warning" : "neutral"}>{order.order_source}</Badge></td>
                        <td>{order.production_state}</td>
                        <td>{customer.orderItems.filter((item) => item.order_id === order.id && item.is_lumi_eligible).reduce((sum, item) => sum + item.quantity, 0)}</td>
                        <td>{formatDate(order.shopify_created_at ?? order.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState>No linked orders.</EmptyState>}
          </Card>

          <Card>
            <h2 className="mb-4 font-serif text-xl">Linked necklaces</h2>
            {customer.necklaces.length ? (
              <div className="space-y-3">
                {customer.necklaces.map((necklace) => (
                  <div key={necklace.id} className="flex flex-col justify-between gap-3 rounded-xl bg-[#fbf7f5] p-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-semibold">{necklace.name} · {necklace.sku}</p>
                      <p className="mt-1 font-mono text-xs text-[#8d7376]">{necklace.tag_ref ?? necklace.id}</p>
                      <div className="mt-2 flex gap-2"><Badge>{necklace.inventory_status}</Badge><Badge tone={necklace.lifecycle_status === "active" ? "success" : "neutral"}>{necklace.lifecycle_status}</Badge></div>
                    </div>
                    <form action={unlinkNecklace}>
                      <input type="hidden" name="necklaceId" value={necklace.id} />
                      <ConfirmSubmit tone="danger" confirmation="Unlink this necklace and return its purchased unit to awaiting assignment?">Unlink</ConfirmSubmit>
                    </form>
                  </div>
                ))}
              </div>
            ) : <EmptyState>No necklaces are linked to this customer.</EmptyState>}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 font-serif text-xl">Recent messages</h2>
              {customer.messages.length ? <div className="space-y-3">{customer.messages.map((message) => (
                <div key={message.id} className="rounded-xl bg-[#fbf7f5] p-3">
                  <div className="flex justify-between"><Badge>{message.state}</Badge><span className="text-xs text-[#8d7376]">{formatDate(message.created_at)}</span></div>
                  <p className="mt-2 text-sm">{safeMessagePreview(message.content)}</p>
                </div>
              ))}</div> : <EmptyState>No customer messages.</EmptyState>}
            </Card>
            <Card>
              <h2 className="mb-4 font-serif text-xl">Recent taps</h2>
              {customer.taps.length ? <div className="space-y-2">{customer.taps.map((tap) => (
                <div key={tap.id} className="flex items-center justify-between rounded-xl bg-[#fbf7f5] p-3 text-sm"><Badge>{tap.status}</Badge><span>{formatDate(tap.tapped_at)}</span></div>
              ))}</div> : <EmptyState>No tap activity on linked necklaces.</EmptyState>}
            </Card>
          </div>
        </div>

        <aside className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Invitation recovery</h2>
            <p className="mb-4 mt-2 text-sm text-[#765d60]">Uses the existing eligible-order check and persisted cooldown. The result is intentionally non-enumerating.</p>
            <form action={recoverCustomerInvitation}>
              <input type="hidden" name="customerId" value={profile.id} />
              <input type="hidden" name="email" value={profile.email} />
              <ConfirmSubmit confirmation={`Send an account setup recovery email to ${profile.email}?`}>Send recovery link</ConfirmSubmit>
            </form>
          </Card>
          <Card>
            <h2 className="font-serif text-xl">Correct email</h2>
            <form action={updateCustomerEmail} className="mt-4 space-y-3">
              <input type="hidden" name="customerId" value={profile.id} />
              <label htmlFor="corrected-email" className="text-sm font-medium">New email</label>
              <input id="corrected-email" name="email" type="email" required defaultValue={profile.email} className={fieldClass} />
              <ConfirmSubmit confirmation="Change this customer's authoritative Auth email? They may need to confirm the new address.">Update email</ConfirmSubmit>
            </form>
          </Card>
          <Card>
            <h2 className="font-serif text-xl">Account status</h2>
            <p className="mb-4 mt-2 text-sm text-[#765d60]">Pausing bans new Supabase Auth sessions and records the operational state. Existing short-lived access tokens expire normally.</p>
            <form action={setCustomerStatus}>
              <input type="hidden" name="customerId" value={profile.id} />
              <input type="hidden" name="status" value={profile.account_status === "paused" ? "active" : "paused"} />
              <ConfirmSubmit
                tone={profile.account_status === "paused" ? "default" : "danger"}
                confirmation={`${profile.account_status === "paused" ? "Restore" : "Pause"} this customer account?`}
              >
                {profile.account_status === "paused" ? "Restore account" : "Pause account"}
              </ConfirmSubmit>
            </form>
          </Card>
        </aside>
      </div>
    </div>
  );
}
