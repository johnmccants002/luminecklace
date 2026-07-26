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
import { SenderApiError } from "../lib/sender/necklaces";

test("message-library query parameters are trimmed and bounded", () => {
  assert.equal(normalizeLibrarySearch("  doing   better  "), "doing better");
  assert.equal(normalizeLibrarySearch(" %_ "), undefined);
  assert.equal(parseLibraryCategory("encouragement"), "encouragement");
  assert.equal(parseLibraryLimit(null), 20);
  assert.equal(parseLibraryLimit("50"), 50);
  assert.throws(
    () => parseLibraryLimit("51"),
    (error: unknown) => error instanceof SenderApiError && error.status === 400
  );
  assert.throws(
    () => parseLibraryCategory("internal"),
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

