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
  normalizeLibraryCustomization,
  safeExperiencePresetKey,
} from "../lib/sender/experience-presets";
import {
  normalizeLumiPresentation,
  normalizeLumiPresentationPatch,
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
    background: "heart",
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
    () => normalizeLumiPresentation({ background: "rose", css: "color:red" }),
    (error: unknown) =>
      error instanceof SenderApiError &&
      error.status === 400 &&
      error.message === "presentation.css is not supported"
  );
  assert.deepEqual(
    normalizeLumiPresentationPatch({ textPosition: "top" }),
    { textPosition: "top" }
  );
  assert.deepEqual(normalizeLumiPresentationPatch(undefined), {});
});

test("older Lumi RPC records map missing layout values to safe defaults", () => {
  const lumi = parseRpcLumi({
    id: randomUUID(),
    content: "Older snapshot",
    queue_position: 1,
    theme_key: "legacy-unknown",
    font_key: "serif",
  });
  assert.equal(lumi.presentation.background, "heart");
  assert.equal(lumi.presentation.theme, "heart");
  assert.equal(lumi.presentation.textSize, "medium");
  assert.equal(lumi.presentation.textAlignment, "center");
  assert.equal(lumi.presentation.textPosition, "center");
  assert.equal(lumi.experiencePresetKey, "classic_word_rise_v1");
});

test("Explore customization accepts text slots and rejects renderer data", () => {
  assert.deepEqual(
    normalizeLibraryCustomization({
      primaryText: "  A custom Lumi  ",
      secondaryText: "  Then this  ",
    }),
    { primaryText: "A custom Lumi", secondaryText: "Then this" }
  );
  assert.deepEqual(normalizeLibraryCustomization({ secondaryText: "  " }), {
    secondaryText: null,
  });
  assert.throws(
    () => normalizeLibraryCustomization({ animation: { delay: 0 } }),
    (error: unknown) =>
      error instanceof SenderApiError &&
      error.message === "customization contains unsupported fields"
  );
  assert.throws(
    () => normalizeLibraryCustomization({ secondaryText: "x".repeat(251) }),
    (error: unknown) => error instanceof SenderApiError && error.status === 400
  );
});

test("experience presets are versioned and unknown values fall back safely", () => {
  assert.equal(safeExperiencePresetKey("timed_surprise_v1"), "timed_surprise_v1");
  assert.equal(safeExperiencePresetKey("future_preset_v9"), "classic_word_rise_v1");

  const lumi = parseRpcLumi({
    id: randomUUID(),
    text: "First reveal",
    secondaryText: "Second reveal",
    experiencePresetKey: "timed_surprise_v1",
    queuePosition: 2,
    presentation: {},
  });
  assert.equal(lumi.experiencePresetKey, "timed_surprise_v1");
  assert.equal(lumi.secondaryText, "Second reveal");
});
