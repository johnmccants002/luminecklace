import assert from "node:assert/strict";
import test from "node:test";

import {
  csvCell,
  parseInventoryImport,
  parseMessageTemplateImport,
} from "../lib/admin/message-import";
import {
  categoryKeyFromName,
  parseCatalogMessageForm,
} from "../lib/admin/message-catalog";
import { hasAdminPermission } from "../lib/admin/permissions";

test("phase-one admin authorization permits only explicitly allowed roles", () => {
  assert.equal(hasAdminPermission("super_admin", ["super_admin"]), true);
  assert.equal(hasAdminPermission("support", ["super_admin"]), false);
  assert.equal(hasAdminPermission("content_admin", ["super_admin"]), false);
});

test("message-catalog CSV dry run validates, maps, and identifies duplicates", () => {
  const csv = [
    "import_key,title,content,category,status,sort_order,metadata",
    'welcome-1,Welcome,"You are loved",affection,published,1,"{""theme"":""rose""}"',
    "welcome-1,Duplicate,Duplicate content,affection,draft,2,",
    "bad,Missing content,,affection,draft,3,",
  ].join("\n");
  const parsed = parseMessageTemplateImport(csv, "csv");
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0].importKey, "welcome-1");
  assert.deepEqual(parsed.validRows[0].metadata, { theme: "rose" });
  assert.equal(parsed.validRows[0].themeKey, "rose");
  assert.equal(parsed.validRows[0].backgroundKey, "rose_glow");
  assert.equal(parsed.validRows[0].fontKey, "serif");
  assert.equal(parsed.validRows[0].textSizeKey, "medium");
  assert.equal(parsed.validRows[0].textAlignmentKey, "center");
  assert.equal(parsed.validRows[0].textPositionKey, "center");
  assert.equal(parsed.issues.length, 2);
  assert.match(parsed.issues[0].message, /duplicate/);
  assert.match(parsed.issues[1].message, /content is required/);
});

test("message imports validate background and font as row-level preset errors", () => {
  const parsed = parseMessageTemplateImport(
    [
      "import_key,title,content,category,status,sort_order,background_key,font_key",
      "valid,Valid,Hello,affection,published,1,midnight,rounded",
      "bad-background,Bad,Hello,comfort,draft,2,https://example.com/bg,serif",
      "bad-font,Bad,Hello,presence,draft,3,ocean,Comic Sans",
    ].join("\n"),
    "csv"
  );

  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0].backgroundKey, "midnight");
  assert.equal(parsed.validRows[0].fontKey, "rounded");
  assert.equal(parsed.issues.length, 2);
  assert.match(parsed.issues[0].message, /background_key is not supported/);
  assert.match(parsed.issues[1].message, /font_key is not supported/);
});

test("message imports default and validate text layout as row-level errors", () => {
  const parsed = parseMessageTemplateImport(
    [
      "import_key,title,content,category,status,sort_order,text_size_key,text_alignment_key,text_position_key",
      "default,Default,Hello,affection,published,1,,,",
      "valid,Valid,Hello,comfort,draft,2,large,trailing,bottom",
      "bad-size,Bad,Hello,presence,draft,3,72px,center,center",
      "bad-alignment,Bad,Hello,presence,draft,4,medium,justify,center",
      "bad-position,Bad,Hello,presence,draft,5,medium,center,25%",
    ].join("\n"),
    "csv"
  );

  assert.equal(parsed.validRows.length, 2);
  assert.deepEqual(
    [
      parsed.validRows[0].textSizeKey,
      parsed.validRows[0].textAlignmentKey,
      parsed.validRows[0].textPositionKey,
    ],
    ["medium", "center", "center"]
  );
  assert.deepEqual(
    [
      parsed.validRows[1].textSizeKey,
      parsed.validRows[1].textAlignmentKey,
      parsed.validRows[1].textPositionKey,
    ],
    ["large", "trailing", "bottom"]
  );
  assert.equal(parsed.issues.length, 3);
  assert.match(parsed.issues[0].message, /text_size_key is not supported/);
  assert.match(
    parsed.issues[1].message,
    /text_alignment_key is not supported/
  );
  assert.match(parsed.issues[2].message, /text_position_key is not supported/);
});

test("message-catalog JSON rejects invalid status", () => {
  const parsed = parseMessageTemplateImport(
    JSON.stringify([
      {
        import_key: "one",
        title: "One",
        content: "Hello",
        category: "comfort",
        status: "not-a-state",
      },
    ]),
    "json"
  );
  assert.equal(parsed.validRows.length, 0);
  assert.match(parsed.issues[0].message, /status must be/);
});

test("catalog editor keeps Explore and Reserve controls independent", () => {
  const form = new FormData();
  form.set("text", "I am right here with you.");
  form.set("category", "presence");
  form.set("isActive", "on");
  form.set("isExplorePublished", "on");
  form.set("exploreSortOrder", "4");
  form.set("themeKey", "heart");
  form.set("animationKey", "breathe");
  form.set("soundKey", "soft");
  const parsed = parseCatalogMessageForm(form);
  assert.equal(parsed.isExplorePublished, true);
  assert.equal(parsed.isReserveEligible, false);
  assert.equal(parsed.textSizeKey, "medium");
  assert.equal(parsed.textAlignmentKey, "center");
  assert.equal(parsed.textPositionKey, "center");

  form.set("reserveDefaultApproved", "on");
  assert.throws(
    () => parseCatalogMessageForm(form),
    /requires Reserve eligibility/
  );
});

test("catalog editor accepts a new reusable category with a message", () => {
  const form = new FormData();
  form.set("text", "You deserve to celebrate this moment.");
  form.set("category", "__new__");
  form.set("newCategoryName", "Milestones & Celebrations");
  form.set("isActive", "on");
  form.set("exploreSortOrder", "1");
  form.set("themeKey", "heart");
  form.set("animationKey", "breathe");
  form.set("soundKey", "soft");

  const parsed = parseCatalogMessageForm(form);
  assert.equal(parsed.newCategoryName, "Milestones & Celebrations");
  assert.equal(
    categoryKeyFromName(parsed.newCategoryName),
    "milestones-celebrations"
  );
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
