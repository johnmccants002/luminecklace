import { NextResponse } from "next/server";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { AdminAuthError, requireAdmin } from "@/lib/admin/auth";
import {
  MAX_IMPORT_BYTES,
  parseMessageTemplateImport,
} from "@/lib/admin/message-import";
import { supabaseAdmin } from "@/lib/supabase/admin";

function errorResponse(error: unknown) {
  if (error instanceof AdminAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Import failed";
  return NextResponse.json({ error: message }, { status: 400 });
}

async function readImport(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("A CSV or JSON file is required");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("File exceeds the 1 MB limit");
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "json") throw new Error("Only .csv and .json files are supported");
  const allowedTypes = ["text/csv", "application/csv", "application/json", "text/json", "text/plain", ""];
  if (!allowedTypes.includes(file.type)) throw new Error("Unsupported file MIME type");
  const sourceType = extension;
  return {
    file,
    sourceType,
    parsed: parseMessageTemplateImport(await file.text(), sourceType),
  };
}

export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const { parsed } = await readImport(req);
    const existing = parsed.validRows.length
      ? await supabaseAdmin
          .from("message_templates")
          .select("import_key")
          .in("import_key", parsed.validRows.map((row) => row.importKey))
      : { data: [], error: null };
    if (existing.error) throw new Error("Unable to compare existing templates");
    const existingKeys = new Set((existing.data ?? []).map((row) => row.import_key));
    return NextResponse.json({
      totalRows: parsed.totalRows,
      validRows: parsed.validRows.map((row) => ({
        ...row,
        content: row.content.length > 120 ? `${row.content.slice(0, 117)}…` : row.content,
        operation: existingKeys.has(row.importKey) ? "update" : "insert",
      })),
      issues: parsed.issues,
      inserted: parsed.validRows.filter((row) => !existingKeys.has(row.importKey)).length,
      updated: parsed.validRows.filter((row) => existingKeys.has(row.importKey)).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin(req);
    const { file, sourceType, parsed } = await readImport(req);
    const existing = parsed.validRows.length
      ? await supabaseAdmin
          .from("message_templates")
          .select("import_key")
          .in("import_key", parsed.validRows.map((row) => row.importKey))
      : { data: [], error: null };
    if (existing.error) throw new Error("Unable to compare existing templates");
    const existingKeys = new Set((existing.data ?? []).map((row) => row.import_key));

    let databaseFailure: string | null = null;
    if (parsed.validRows.length) {
      const upsert = await supabaseAdmin.from("message_templates").upsert(
        parsed.validRows.map((row) => ({
          import_key: row.importKey,
          title: row.title,
          content: row.content,
          category: row.category,
          status: row.status,
          sort_order: row.sortOrder,
          metadata: row.metadata,
          published_at: row.publishedAt,
        })),
        { onConflict: "import_key" }
      );
      databaseFailure = upsert.error?.message ?? null;
    }

    const failedRows = parsed.issues.length + (databaseFailure ? parsed.validRows.length : 0);
    const run = await supabaseAdmin
      .from("message_template_import_runs")
      .insert({
        admin_user_id: user.id,
        file_name: file.name.slice(0, 240),
        source_type: sourceType,
        status: failedRows ? "completed_with_errors" : "completed",
        total_rows: parsed.totalRows,
        inserted_rows: databaseFailure ? 0 : parsed.validRows.filter((row) => !existingKeys.has(row.importKey)).length,
        updated_rows: databaseFailure ? 0 : parsed.validRows.filter((row) => existingKeys.has(row.importKey)).length,
        skipped_rows: parsed.issues.length,
        failed_rows: failedRows,
      })
      .select("id")
      .single();
    if (run.error) throw new Error("Unable to store import history");

    const issues = databaseFailure
      ? [...parsed.issues, { rowNumber: 1, importKey: null, message: "Database rejected the validated import" }]
      : parsed.issues;
    if (issues.length) {
      const stored = await supabaseAdmin.from("message_template_import_errors").insert(
        issues.map((issue) => ({
          import_run_id: run.data.id,
          row_number: issue.rowNumber,
          import_key: issue.importKey,
          error_message: issue.message,
        }))
      );
      if (stored.error) throw new Error("Unable to store import error report");
    }

    await writeAdminAuditLog({
      adminUserId: user.id,
      action: "message_templates.imported",
      resourceType: "message_template_import",
      resourceId: run.data.id,
      details: { totalRows: parsed.totalRows, failedRows },
    });

    return NextResponse.json({
      runId: run.data.id,
      inserted: databaseFailure ? 0 : parsed.validRows.filter((row) => !existingKeys.has(row.importKey)).length,
      updated: databaseFailure ? 0 : parsed.validRows.filter((row) => existingKeys.has(row.importKey)).length,
      skipped: parsed.issues.length,
      failed: failedRows,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
