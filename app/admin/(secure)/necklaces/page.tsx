import {
  assignNecklace,
  createInventoryRecord,
  importInventoryRecords,
  setNecklaceDisabled,
  transferNecklace,
  unlinkNecklace,
} from "@/lib/admin/actions";
import { formatDate, getPage } from "@/lib/admin/format";
import { PAGE_SIZE } from "@/lib/admin/data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, fieldClass, tableClass } from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";

const statuses = ["unassigned", "assigned", "shipped", "activated", "disabled"];

export default async function NecklacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = getPage(params.page);
  const q = typeof params.q === "string" ? params.q.replace(/[%,_()]/g, "").slice(0, 100) : "";
  const status = typeof params.status === "string" && statuses.includes(params.status) ? params.status : "";
  const assignment = params.assignment === "assigned" || params.assignment === "unassigned" ? params.assignment : "";
  const from = (page - 1) * PAGE_SIZE;

  let query = supabaseAdmin
    .from("necklaces")
    .select("id, tag_ref, sku, name, lifecycle_status, inventory_status, order_item_unit_id, activated_at, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (q) query = query.or(`tag_ref.ilike.%${q}%,sku.ilike.%${q}%`);
  if (status) query = query.eq("inventory_status", status);
  if (assignment === "assigned") query = query.not("order_item_unit_id", "is", null);
  if (assignment === "unassigned") query = query.is("order_item_unit_id", null);
  const result = await query;
  if (result.error) throw new Error("Unable to load necklace inventory");

  const necklaceIds = (result.data ?? []).map((row) => row.id);
  const ownerships = necklaceIds.length
    ? await supabaseAdmin
        .from("necklace_ownerships")
        .select("necklace_id, sender_user_id, source_order_id, claimed_at")
        .in("necklace_id", necklaceIds)
    : { data: [], error: null };
  if (ownerships.error) throw new Error("Unable to load inventory ownership");
  const ownerIds = Array.from(new Set((ownerships.data ?? []).map((row) => row.sender_user_id)));
  const owners = ownerIds.length
    ? await supabaseAdmin.from("profiles").select("id, email, display_name").in("id", ownerIds)
    : { data: [], error: null };
  if (owners.error) throw new Error("Unable to load inventory customers");

  const total = result.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader title="Necklaces & NFC inventory" description="Physical inventory, ownership, purchased-unit allocation, and tap availability." />

      <Card>
        <form className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
          <input name="q" defaultValue={q} className={fieldClass} placeholder="Tag identifier or SKU" aria-label="Search inventory" />
          <select name="status" defaultValue={status} className={fieldClass} aria-label="Inventory status">
            <option value="">All statuses</option>
            {statuses.map((value) => <option key={value}>{value}</option>)}
          </select>
          <select name="assignment" defaultValue={assignment} className={fieldClass} aria-label="Assignment status">
            <option value="">Any assignment</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <button className="h-10 rounded-full bg-[#2a1214] px-5 text-sm font-semibold text-white">Filter</button>
        </form>
      </Card>

      <Card>
        <div className="mb-4 flex justify-between text-sm text-[#765d60]"><span>{total} inventory records</span><span>Page {page} of {pages}</span></div>
        {(result.data ?? []).length ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th>Necklace / tag</th><th>Owner</th><th>Unit / order</th><th>Status</th><th>Created / activated</th><th>Actions</th></tr></thead>
              <tbody>
                {(result.data ?? []).map((necklace) => {
                  const ownership = (ownerships.data ?? []).find((row) => row.necklace_id === necklace.id);
                  const owner = (owners.data ?? []).find((row) => row.id === ownership?.sender_user_id);
                  const nfcUrl = `${SITE_URL}/nfc/${encodeURIComponent(necklace.tag_ref ?? necklace.id)}`;
                  return (
                    <tr key={necklace.id}>
                      <td>
                        <p className="font-semibold">{necklace.name} · {necklace.sku}</p>
                        <p className="font-mono text-xs text-[#8d7376]">{necklace.tag_ref ?? necklace.id}</p>
                        <a href={nfcUrl} className="mt-1 block text-xs text-[#b63d42] hover:underline" target="_blank" rel="noreferrer">NFC URL</a>
                      </td>
                      <td>{owner ? <><p>{owner.display_name || owner.email}</p><p className="text-xs text-[#8d7376]">{owner.email}</p></> : "Unassigned"}</td>
                      <td><p className="font-mono text-xs">{necklace.order_item_unit_id?.slice(0, 8) ?? "—"}</p><p className="font-mono text-xs text-[#8d7376]">{ownership?.source_order_id?.slice(0, 8) ?? ""}</p></td>
                      <td><div className="flex flex-col items-start gap-1"><Badge tone={necklace.inventory_status === "disabled" ? "danger" : necklace.lifecycle_status === "active" ? "success" : "neutral"}>{necklace.inventory_status}</Badge><span className="text-xs text-[#8d7376]">{necklace.lifecycle_status}</span></div></td>
                      <td><p>{formatDate(necklace.created_at)}</p><p className="mt-1 text-xs text-[#8d7376]">{formatDate(necklace.activated_at)}</p></td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {ownership ? <form action={unlinkNecklace}><input type="hidden" name="necklaceId" value={necklace.id} /><ConfirmSubmit tone="danger" confirmation="Unlink ownership and purchased-unit allocation?">Unlink</ConfirmSubmit></form> : null}
                          <form action={setNecklaceDisabled}>
                            <input type="hidden" name="necklaceId" value={necklace.id} />
                            <input type="hidden" name="disabled" value={String(necklace.inventory_status !== "disabled")} />
                            <ConfirmSubmit confirmation={`${necklace.inventory_status === "disabled" ? "Restore" : "Disable"} this tag?`}>{necklace.inventory_status === "disabled" ? "Restore" : "Disable"}</ConfirmSubmit>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No inventory matches these filters.</EmptyState>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-4">
        <Card>
          <h2 className="font-serif text-xl">Create inventory record</h2>
          <form action={createInventoryRecord} className="mt-4 space-y-3">
            <input name="tagRef" required placeholder="NFC tag identifier" className={fieldClass} aria-label="NFC tag identifier" />
            <input name="sku" required placeholder="SKU" className={fieldClass} aria-label="SKU" />
            <input name="tapTokenHash" required minLength={16} placeholder="Pre-generated tap token hash" className={fieldClass} aria-label="Tap token hash" />
            <ConfirmSubmit>Create record</ConfirmSubmit>
          </form>
        </Card>
        <Card>
          <h2 className="font-serif text-xl">Import inventory</h2>
          <p className="mt-2 text-xs text-[#765d60]">CSV/JSON up to 1 MB and 1,000 rows. Required: <code>tag_ref</code>, <code>sku</code>, <code>tap_token_hash</code>. Existing tag identifiers are skipped and never overwritten.</p>
          <form action={importInventoryRecords} className="mt-4 space-y-3">
            <input name="file" type="file" required accept=".csv,.json,text/csv,application/json" className="block w-full text-xs file:mb-2 file:rounded-full file:border-0 file:bg-[#f4eae7] file:px-3 file:py-2" />
            <ConfirmSubmit confirmation="Import these physical inventory records? Existing tag identifiers will be skipped.">Import inventory</ConfirmSubmit>
          </form>
        </Card>
        <Card>
          <h2 className="font-serif text-xl">Assign to eligible unit</h2>
          <p className="mt-2 text-xs text-[#765d60]">IDs are validated server-side; the transaction rejects used units, ineligible purchases, and unavailable tags.</p>
          <form action={assignNecklace} className="mt-4 space-y-3">
            <input name="necklaceId" required placeholder="Necklace UUID" className={fieldClass} />
            <input name="unitId" required placeholder="Order item unit UUID" className={fieldClass} />
            <input name="customerId" required placeholder="Customer UUID" className={fieldClass} />
            <ConfirmSubmit confirmation="Assign this physical necklace to the selected customer and purchased unit?">Assign necklace</ConfirmSubmit>
          </form>
        </Card>
        <Card>
          <h2 className="font-serif text-xl">Transfer ownership</h2>
          <p className="mt-2 text-xs text-[#765d60]">Transfers ownership but preserves the original purchased-unit allocation and order provenance.</p>
          <form action={transferNecklace} className="mt-4 space-y-3">
            <input name="necklaceId" required placeholder="Necklace UUID" className={fieldClass} />
            <input name="customerId" required placeholder="New customer UUID" className={fieldClass} />
            <ConfirmSubmit confirmation="Transfer this necklace to another customer?">Transfer necklace</ConfirmSubmit>
          </form>
        </Card>
      </div>
    </div>
  );
}
