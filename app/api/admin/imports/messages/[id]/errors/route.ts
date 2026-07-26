import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin/auth";
import { csvCell } from "@/lib/admin/message-import";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const result = await supabaseAdmin
      .from("message_template_import_errors")
      .select("row_number, import_key, error_message")
      .eq("import_run_id", id)
      .order("row_number");
    if (result.error) throw new Error("Unable to build error report");
    const csv = [
      "row_number,import_key,error",
      ...(result.data ?? []).map((row) =>
        [row.row_number, row.import_key, row.error_message].map(csvCell).join(",")
      ),
    ].join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lumi-import-errors-${id}.csv"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Unable to download error report" },
      { status: 500 }
    );
  }
}
