"use client";

import { useState } from "react";

import { Badge, Card, EmptyState, tableClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

type Preview = {
  totalRows: number;
  inserted: number;
  updated: number;
  validRows: Array<{
    importKey: string;
    title: string;
    content: string;
    category: string | null;
    status: string;
    operation: "insert" | "update";
  }>;
  issues: Array<{ rowNumber: number; importKey: string | null; message: string }>;
};

type Result = {
  runId: string;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

export function MessageImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function request(method: "PUT" | "POST") {
    if (!file) return;
    setPending(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/admin/imports/messages", { method, body: form });
    const body = (await response.json()) as Preview & Result & { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Import request failed");
      return;
    }
    if (method === "PUT") {
      setPreview(body);
      setResult(null);
    } else {
      setResult(body);
      setPreview(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-serif text-xl">1. Select and validate</h2>
        <p className="mt-2 text-sm text-[#765d60]">CSV or JSON, up to 1 MB and 1,000 rows. Valid rows write directly to the Explore and Reserve catalog.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
            }}
            className="block w-full text-sm file:mr-4 file:rounded-full file:border-0 file:bg-[#f4eae7] file:px-4 file:py-2 file:font-semibold"
          />
          <Button type="button" onClick={() => request("PUT")} disabled={!file || pending}>
            {pending ? "Validating…" : "Dry-run preview"}
          </Button>
        </div>
        {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
      </Card>

      {preview ? (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-serif text-xl">2. Review dry run</h2>
              <p className="mt-1 text-sm text-[#765d60]">{preview.totalRows} rows · {preview.inserted} inserts · {preview.updated} updates · {preview.issues.length} invalid/skipped</p>
            </div>
            <Button type="button" onClick={() => request("POST")} disabled={pending || preview.validRows.length === 0}>
              {pending ? "Importing…" : "Confirm import"}
            </Button>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th>Operation</th><th>Import key</th><th>Title</th><th>Category</th><th>Status</th><th>Safe preview</th></tr></thead>
              <tbody>{preview.validRows.slice(0, 100).map((row) => (
                <tr key={row.importKey}><td><Badge tone={row.operation === "insert" ? "success" : "warning"}>{row.operation}</Badge></td><td className="font-mono text-xs">{row.importKey}</td><td>{row.title}</td><td>{row.category ?? "—"}</td><td>{row.status}</td><td>{row.content}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {preview.issues.length ? (
            <div className="mt-5 rounded-xl bg-red-50 p-4">
              <h3 className="font-semibold text-red-900">Invalid or duplicate records</h3>
              <ul className="mt-2 space-y-1 text-sm text-red-800">{preview.issues.slice(0, 25).map((issue) => <li key={`${issue.rowNumber}-${issue.importKey}`}>Row {issue.rowNumber}: {issue.message}</li>)}</ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {result ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <h2 className="font-serif text-xl">Import complete</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-2xl font-semibold">{result.inserted}</p><p className="text-xs text-[#765d60]">Inserted</p></div>
            <div><p className="text-2xl font-semibold">{result.updated}</p><p className="text-xs text-[#765d60]">Updated</p></div>
            <div><p className="text-2xl font-semibold">{result.skipped}</p><p className="text-xs text-[#765d60]">Skipped</p></div>
            <div><p className="text-2xl font-semibold">{result.failed}</p><p className="text-xs text-[#765d60]">Failed</p></div>
          </div>
          {result.failed || result.skipped ? <a href={`/api/admin/imports/messages/${result.runId}/errors`} className="mt-5 inline-block text-sm font-semibold text-[#b63d42] hover:underline">Download CSV error report</a> : null}
        </Card>
      ) : null}
      {!preview && !result ? <EmptyState>Choose a source file to begin the dry run.</EmptyState> : null}
    </div>
  );
}
