import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInstagramUrl } from "../lib/shared-links/instagram";
import {
  DEFAULT_SHARED_LUMI_TEXT,
  normalizeSharedLumiText,
} from "../lib/sender/necklaces";

test("normalizes and classifies supported Instagram URLs", () => {
  const cases = [
    ["https://instagram.com/p/ABC123", "post"],
    ["https://instagram.com/reel/ABC123/", "reel"],
    ["https://instagram.com/tv/ABC123/", "reel"],
    ["https://instagram.com/stories/lumi/123/", "story"],
    ["https://instagram.com/luminecklace/", "profile"],
    ["https://instagram.com/explore/tags/lumi/", "instagram_link"],
  ] as const;

  for (const [url, contentKind] of cases) {
    assert.equal(normalizeInstagramUrl(url).contentKind, contentKind);
  }
});

test("canonicalizes host, path, tracking parameters, and fragments", () => {
  assert.deepEqual(
    normalizeInstagramUrl(
      "https://www.instagram.com//reel//ABC123/?igsh=secret&utm_source=share&keep=1#private"
    ),
    {
      provider: "instagram",
      contentKind: "reel",
      url: "https://instagram.com/reel/ABC123/?keep=1",
      host: "instagram.com",
    }
  );

  const result = normalizeInstagramUrl(
    "https://instagram.com/p/ABC/?utm_medium=x&utm_campaign=y&utm_content=z&utm_term=q&fbclid=f"
  );
  assert.equal(result.url, "https://instagram.com/p/ABC/");
});

test("rejects unsafe or unsupported URLs", () => {
  for (const value of [
    "http://instagram.com/p/ABC/",
    "https://example.com/p/ABC/",
    "https://instagram.com.attacker.example/p/ABC/",
    "https://user:password@instagram.com/p/ABC/",
    "not a URL",
    `https://instagram.com/p/${"x".repeat(2050)}`,
  ]) {
    assert.throws(() => normalizeInstagramUrl(value));
  }
});

test("shared Lumi text uses one default and validates custom text", () => {
  assert.equal(normalizeSharedLumiText(undefined), DEFAULT_SHARED_LUMI_TEXT);
  assert.equal(normalizeSharedLumiText("   "), DEFAULT_SHARED_LUMI_TEXT);
  assert.equal(normalizeSharedLumiText(" Custom message "), "Custom message");
  assert.throws(() => normalizeSharedLumiText(42));
  assert.throws(() => normalizeSharedLumiText("x".repeat(501)));
});
