import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  normalizeLibrarySearch,
  parseLibraryCategory,
  parseLibraryLimit,
} from "../lib/sender/message-library-contract";
import {
  normalizeLumiPresentation,
  parseRpcLumi,
  SenderApiError,
} from "../lib/sender/necklaces";

test("message-library query parameters are trimmed and bounded", () => {
  assert.equal(normalizeLibrarySearch("  doing   better  "), "doing better");
  assert.equal(normalizeLibrarySearch(" %_ "), undefined);
  assert.equal(parseLibraryCategory("encouragement"), "encouragement");
  assert.equal(parseLibraryCategory("celebration"), "celebration");
  assert.equal(parseLibraryLimit(null), 20);
  assert.equal(parseLibraryLimit("50"), 50);
  assert.throws(
    () => parseLibraryLimit("51"),
    (error: unknown) => error instanceof SenderApiError && error.status === 400
  );
  assert.throws(
    () => parseLibraryCategory("Not A Slug"),
    (error: unknown) => error instanceof SenderApiError && error.status === 400
  );
});

test("message-library cursor is opaque, stable, and validated", () => {
  const value = {
    category: "comfort" as const,
    sortOrder: 12,
    id: randomUUID(),
  };
  assert.deepEqual(decodeLibraryCursor(encodeLibraryCursor(value)), value);
  assert.throws(
    () => decodeLibraryCursor("not-a-cursor"),
    (error: unknown) => error instanceof SenderApiError && error.status === 400
  );
});

test("Lumi presentation defaults and preset allowlists are strict", () => {
  assert.deepEqual(normalizeLumiPresentation(undefined), {
    background: "rose_glow",
    font: "serif",
    textSize: "medium",
    textAlignment: "center",
    textPosition: "center",
  });
  assert.deepEqual(
    normalizeLumiPresentation({
      background: "midnight",
      font: "rounded",
      textSize: "large",
      textAlignment: "trailing",
      textPosition: "bottom",
    }),
    {
      background: "midnight",
      font: "rounded",
      textSize: "large",
      textAlignment: "trailing",
      textPosition: "bottom",
    }
  );
  assert.throws(
    () => normalizeLumiPresentation({ background: "url(https://example.com)" }),
    (error: unknown) =>
      error instanceof SenderApiError &&
      error.status === 400 &&
      /background/.test(error.message)
  );
  for (const invalid of [
    { textSize: "72px" },
    { textAlignment: "justify" },
    { textPosition: "25%" },
    { textSize: null },
  ]) {
    assert.throws(
      () => normalizeLumiPresentation(invalid),
      (error: unknown) =>
        error instanceof SenderApiError && error.status === 400
    );
  }
  assert.throws(
    () => normalizeLumiPresentation({ font: "Comic Sans" }),
    (error: unknown) =>
      error instanceof SenderApiError &&
      error.status === 400 &&
      /font/.test(error.message)
  );
  assert.throws(
    () => normalizeLumiPresentation({ background: "ocean", css: "color:red" }),
    (error: unknown) => error instanceof SenderApiError && error.status === 400
  );
});

test("older Lumi RPC records map missing layout values to safe defaults", () => {
  const lumi = parseRpcLumi({
    id: randomUUID(),
    content: "Older snapshot",
    queue_position: 1,
    background_key: "rose_glow",
    font_key: "serif",
  });
  assert.equal(lumi.presentation.textSize, "medium");
  assert.equal(lumi.presentation.textAlignment, "center");
  assert.equal(lumi.presentation.textPosition, "center");
});
