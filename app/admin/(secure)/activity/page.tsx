import { Badge, Card, EmptyState, PageHeader, fieldClass, tableClass } from "@/components/admin/ui";
import { PAGE_SIZE } from "@/lib/admin/data";
import { formatDate, getPage } from "@/lib/admin/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = getPage(params.page);
  const adminId = typeof params.admin === "string" ? params.admin : "";
  const action = typeof params.action === "string" ? params.action.replace(/[%,_()]/g, "").slice(0, 100) : "";
  const resource = typeof params.resource === "string" ? params.resource.replace(/[%,_()]/g, "").slice(0, 80) : "";
  const fromDate = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : "";
  const toDate = typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : "";
  const from = (page - 1) * PAGE_SIZE;

  let query = supabaseAdmin
    .from("admin_audit_logs")
    .select("id, admin_user_id, action, resource_type, resource_id, details, correlation_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (adminId) query = query.eq("admin_user_id", adminId);
  if (action) query = query.ilike("action", `%${action}%`);
  if (resource) query = query.ilike("resource_type", `%${resource}%`);
  if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00.000Z`);
  if (toDate) query = query.lte("created_at", `${toDate}T23:59:59.999Z`);
  const logs = await query;
  if (logs.error) throw new Error("Unable to load admin audit activity");

  const roles = await supabaseAdmin.from("admin_user_roles").select("user_id, role").order("granted_at");
  if (roles.error) throw new Error("Unable to load administrator filter");
  const profiles = (roles.data ?? []).length
    ? await supabaseAdmin.from("profiles").select("id, email, display_name").in("id", (roles.data ?? []).map((row) => row.user_id))
    : { data: [], error: null };
  if (profiles.error) throw new Error("Unable to load administrator identities");
  const total = logs.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader title="Admin activity" description="Append-only audit records for privileged business operations." />
      <Card>
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <select name="admin" defaultValue={adminId} className={fieldClass} aria-label="Administrator">
            <option value="">All administrators</option>
            {(roles.data ?? []).map((role) => {
              const profile = (profiles.data ?? []).find((row) => row.id === role.user_id);
              return <option key={role.user_id} value={role.user_id}>{profile?.display_name || profile?.email || role.user_id.slice(0, 8)}</option>;
            })}
          </select>
          <input name="action" defaultValue={action} className={fieldClass} placeholder="Action" aria-label="Action" />
          <input name="resource" defaultValue={resource} className={fieldClass} placeholder="Resource type" aria-label="Resource type" />
          <input name="from" type="date" defaultValue={fromDate} className={fieldClass} aria-label="From date" />
          <input name="to" type="date" defaultValue={toDate} className={fieldClass} aria-label="To date" />
          <button className="h-10 rounded-full bg-[#2a1214] px-5 text-sm font-semibold text-white">Filter</button>
        </form>
      </Card>
      <Card>
        <div className="mb-4 flex justify-between text-sm text-[#765d60]"><span>{total} audit events</span><span>Page {page} of {pages}</span></div>
        {(logs.data ?? []).length ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th>Timestamp</th><th>Administrator</th><th>Action</th><th>Resource</th><th>Safe details</th><th>Correlation</th></tr></thead>
              <tbody>{(logs.data ?? []).map((log) => {
                const profile = (profiles.data ?? []).find((row) => row.id === log.admin_user_id);
                return (
                  <tr key={log.id}>
                    <td>{formatDate(log.created_at)}</td>
                    <td>{profile?.display_name || profile?.email || log.admin_user_id.slice(0, 8)}</td>
                    <td><Badge>{log.action}</Badge></td>
                    <td><p>{log.resource_type}</p><p className="font-mono text-xs text-[#8d7376]">{log.resource_id?.slice(0, 16) ?? "—"}</p></td>
                    <td><code className="line-clamp-2 max-w-sm text-xs">{JSON.stringify(log.details)}</code></td>
                    <td className="font-mono text-xs">{log.correlation_id?.slice(0, 8) ?? "—"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState>No audit events match these filters.</EmptyState>}
      </Card>
    </div>
  );
}

