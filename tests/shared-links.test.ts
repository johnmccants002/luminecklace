import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInstagramUrl } from "../lib/shared-links/instagram";
import { normalizeSharedUrl } from "../lib/shared-links/public-url";
import {
  DEFAULT_SHARED_LUMI_TEXT,
  normalizeSharedLumiText,
} from "../lib/sender/necklaces";

test("normalizes and classifies supported Instagram URLs", () => {
  const cases = [
    ["https://instagram.com/p/ABC123", "post"],
    ["https://instagram.com/reel/ABC123/", "reel"],
    ["https://instagram.com/reels/ABC123/", "reel"],
    ["https://instagram.com/tv/ABC123/", "post"],
    ["https://instagram.com/stories/lumi/123/", "story"],
    ["https://instagram.com/luminecklace/", "profile"],
    ["https://instagram.com/explore/tags/lumi/", "link"],
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
    `https://instagram.com/p/${"x".repeat(4100)}`,
  ]) {
    assert.throws(() => normalizeInstagramUrl(value));
  }
});

test("normalizes public websites without dropping URL components", () => {
  assert.deepEqual(
    normalizeSharedUrl("HTTPS://WWW.Example.ORG:8443/a/b?keep=1#section"),
    {
      provider: "website",
      contentKind: "link",
      url: "https://www.example.org:8443/a/b?keep=1#section",
      host: "www.example.org",
    }
  );
  assert.equal(
    normalizeSharedUrl("https://www.example.org:443/path").url,
    "https://www.example.org:443/path"
  );
  assert.deepEqual(normalizeSharedUrl("https://BÜCHER.de/über-uns?q=✓#größe"), {
    provider: "website",
    contentKind: "link",
    url: "https://xn--bcher-kva.de/%C3%BCber-uns?q=%E2%9C%93#gr%C3%B6%C3%9Fe",
    host: "xn--bcher-kva.de",
  });
});

test("classifies only exact Instagram hosts as Instagram", () => {
  assert.equal(normalizeSharedUrl("https://instagram.com/p/ABC").provider, "instagram");
  assert.equal(
    normalizeSharedUrl("https://www.instagram.com/stories/lumi/1").provider,
    "instagram"
  );
  assert.deepEqual(
    normalizeSharedUrl("https://instagram.com.attacker.net/reel/ABC"),
    {
      provider: "website",
      contentKind: "link",
      url: "https://instagram.com.attacker.net/reel/ABC",
      host: "instagram.com.attacker.net",
    }
  );
});

test("rejects malformed, non-HTTPS, credentialed, and oversized URLs", () => {
  for (const value of [
    "http://example.org/path",
    "https://user:password@example.org/path",
    "https://",
    "https://example.org:0/path",
    "https://example.org:/path",
    "not a URL",
    " https://example.org/path",
    `https://example.org/${"é".repeat(2040)}`,
  ]) {
    assert.throws(() => normalizeSharedUrl(value));
  }
});

test("rejects localhost, internal names, and reserved hostname suffixes", () => {
  for (const hostname of [
    "localhost",
    "printer",
    "service.local",
    "service.localdomain",
    "service.internal",
    "router.lan",
    "device.home",
    "site.test",
    "site.invalid",
    "site.example",
    "reverse.arpa",
  ]) {
    assert.throws(() => normalizeSharedUrl(`https://${hostname}/`), hostname);
  }
});

test("rejects non-public and alternative IPv4 literals", () => {
  for (const hostname of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "127.1",
    "2130706433",
    "0x7f000001",
    "001.001.001.001",
  ]) {
    assert.throws(() => normalizeSharedUrl(`https://${hostname}/`), hostname);
  }
  assert.deepEqual(normalizeSharedUrl("https://8.8.8.8:444/path#fragment"), {
    provider: "website",
    contentKind: "link",
    url: "https://8.8.8.8:444/path#fragment",
    host: "8.8.8.8",
  });
});

test("rejects non-public IPv6 and accepts canonical public IPv6 literals", () => {
  for (const hostname of [
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "2001:2::1",
    "3fff::1",
    "2002::1",
  ]) {
    assert.throws(() => normalizeSharedUrl(`https://[${hostname}]/`), hostname);
  }
  assert.deepEqual(
    normalizeSharedUrl("https://[2606:4700:4700::1111]:8443/path?q=1#fragment"),
    {
      provider: "website",
      contentKind: "link",
      url: "https://[2606:4700:4700::1111]:8443/path?q=1#fragment",
      host: "2606:4700:4700::1111",
    }
  );
});

test("shared Lumi text uses one default and validates custom text", () => {
  assert.equal(normalizeSharedLumiText(undefined), DEFAULT_SHARED_LUMI_TEXT);
  assert.equal(normalizeSharedLumiText("   "), DEFAULT_SHARED_LUMI_TEXT);
  assert.equal(normalizeSharedLumiText(" Custom message "), "Custom message");
  assert.throws(() => normalizeSharedLumiText(42));
  assert.throws(() => normalizeSharedLumiText("x".repeat(501)));
});
