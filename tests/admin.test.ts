import assert from "node:assert/strict";
import test from "node:test";

import {
  csvCell,
  parseInventoryImport,
  parseMessageTemplateImport,
} from "../lib/admin/message-import";
import { hasAdminPermission } from "../lib/admin/permissions";

test("phase-one admin authorization permits only explicitly allowed roles", () => {
  assert.equal(hasAdminPermission("super_admin", ["super_admin"]), true);
  assert.equal(hasAdminPermission("support", ["super_admin"]), false);
  assert.equal(hasAdminPermission("content_admin", ["super_admin"]), false);
});

test("message-template CSV dry run validates, maps, and identifies duplicates", () => {
  const csv = [
    "import_key,title,content,category,status,sort_order,metadata",
    'welcome-1,Welcome,"You are loved",affirmation,published,1,"{""tone"":""warm""}"',
    "welcome-1,Duplicate,Duplicate content,affirmation,draft,2,",
    "bad,Missing content,,affirmation,draft,3,",
  ].join("\n");
  const parsed = parseMessageTemplateImport(csv, "csv");
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0].importKey, "welcome-1");
  assert.deepEqual(parsed.validRows[0].metadata, { tone: "warm" });
  assert.equal(parsed.issues.length, 2);
  assert.match(parsed.issues[0].message, /duplicate/);
  assert.match(parsed.issues[1].message, /content is required/);
});

test("message-template JSON rejects invalid status and row limits are bounded", () => {
  const parsed = parseMessageTemplateImport(
    JSON.stringify([
      {
        import_key: "one",
        title: "One",
        content: "Hello",
        status: "not-a-state",
      },
    ]),
    "json"
  );
  assert.equal(parsed.validRows.length, 0);
  assert.match(parsed.issues[0].message, /status must be/);
});

test("CSV error reports neutralize spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"bad\")"), "\"'=HYPERLINK(\"\"bad\"\")\"");
  assert.equal(csvCell("safe"), '"safe"');
});

test("inventory import validates required fields and duplicate tag identifiers", () => {
  const valid = parseInventoryImport(
    "tag_ref,sku,tap_token_hash\nTAG-001,LUMI-GOLD,0123456789abcdef",
    "csv"
  );
  assert.deepEqual(valid, [
    {
      tag_ref: "TAG-001",
      sku: "LUMI-GOLD",
      tap_token_hash: "0123456789abcdef",
    },
  ]);
  assert.throws(
    () =>
      parseInventoryImport(
        JSON.stringify([
          { tag_ref: "TAG-001", sku: "A", tap_token_hash: "0123456789abcdef" },
          { tag_ref: "TAG-001", sku: "B", tap_token_hash: "fedcba9876543210" },
        ]),
        "json"
      ),
    /Duplicate tag_ref/
  );
});
