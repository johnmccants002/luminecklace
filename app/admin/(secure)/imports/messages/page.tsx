import { Badge, Card, EmptyState, PageHeader, tableClass } from "@/components/admin/ui";
import { formatDate } from "@/lib/admin/format";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";

import { MessageImportClient } from "./import-client";

export default async function MessageImportsPage() {
  const history = await supabaseAdmin
    .from("message_template_import_runs")
    .select("id, file_name, source_type, status, total_rows, inserted_rows, updated_rows, skipped_rows, failed_rows, created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  if (history.error) throw new Error("Unable to load import history");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Message catalog imports"
        description="Bulk-create or update the same catalog used by Explore and Reserve."
        actions={
          <Link href="/admin/messages" className="text-sm font-semibold text-[#b63d42]">
            Edit catalog →
          </Link>
        }
      />
      <MessageImportClient />
      <Card>
        <h2 className="mb-4 font-serif text-xl">Import history</h2>
        {(history.data ?? []).length ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th>File</th><th>Status</th><th>Total</th><th>Inserted</th><th>Updated</th><th>Skipped / failed</th><th>Created</th></tr></thead>
              <tbody>{(history.data ?? []).map((run) => (
                <tr key={run.id}><td>{run.file_name}<p className="text-xs uppercase text-[#8d7376]">{run.source_type}</p></td><td><Badge tone={run.failed_rows ? "warning" : "success"}>{run.status}</Badge></td><td>{run.total_rows}</td><td>{run.inserted_rows}</td><td>{run.updated_rows}</td><td>{run.skipped_rows} / {run.failed_rows}{run.failed_rows ? <a className="ml-2 text-xs font-semibold text-[#b63d42]" href={`/api/admin/imports/messages/${run.id}/errors`}>CSV</a> : null}</td><td>{formatDate(run.created_at)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>No message-template imports have been committed.</EmptyState>}
      </Card>
      <Card className="bg-[#fbf7f5]">
        <h2 className="font-semibold">Supported columns</h2>
        <p className="mt-2 text-sm leading-6 text-[#765d60]">
          <code>import_key,title,content,category,status,sort_order,background_key,font_key,text_size_key,text_alignment_key,text_position_key,metadata</code>.
          JSON uses the same keys. Status is <code>draft</code>, <code>published</code>,
          or <code>archived</code>. Metadata may include <code>theme</code>,
          <code>animation</code>, <code>sound</code>, <code>background</code>,
          <code>font</code>, <code>reserveEligible</code>,
          <code>reserveDefaultApproved</code>, and <code>reserveSortOrder</code>.
        </p>
      </Card>
    </div>
  );
}
