import assert from "node:assert/strict";
import test from "node:test";

import { resolveNextRecipientTap } from "../lib/tap/recipient";

function rpcResult(data: unknown) {
  return {
    rpc: async () => ({ data, error: null }),
  };
}

test("recipient ready mapping returns stored presentation and safe preset defaults", async () => {
  const customized = await resolveNextRecipientTap(
    rpcResult({
      status: "ready",
      reveal_session_id: "session-id",
      necklace_display_name: "Lumi",
      lumi_id: "lumi-id",
      lumi_text: "Hello",
      presentation: {
        theme: "midnight",
        animation: "breathe",
        sound: "soft",
        revealPreset: "wordRise",
        background: "midnight",
        font: "rounded",
        textSize: "large",
        textAlignment: "trailing",
        textPosition: "bottom",
      },
    }),
    "token"
  );
  assert.equal(customized.status, "ready");
  if (customized.status === "ready") {
    assert.equal(customized.presentation.background, "midnight");
    assert.equal(customized.presentation.font, "rounded");
    assert.equal(customized.presentation.textSize, "large");
    assert.equal(customized.presentation.textAlignment, "trailing");
    assert.equal(customized.presentation.textPosition, "bottom");
  }

  const incomplete = await resolveNextRecipientTap(
    rpcResult({
      status: "ready",
      reveal_session_id: "session-id",
      lumi_id: "lumi-id",
      lumi_text: "Hello",
      presentation: {
        background: "url(https://example.com)",
        font: "Unsupported Font",
        textSize: "calc(100%)",
        textAlignment: "justify",
        textPosition: "25%",
      },
    }),
    "token"
  );
  assert.equal(incomplete.status, "ready");
  if (incomplete.status === "ready") {
    assert.equal(incomplete.presentation.background, "heart");
    assert.equal(incomplete.presentation.theme, "heart");
    assert.equal(incomplete.presentation.font, "serif");
    assert.equal(incomplete.presentation.revealPreset, "wordRise");
    assert.equal(incomplete.presentation.textSize, "medium");
    assert.equal(incomplete.presentation.textAlignment, "center");
    assert.equal(incomplete.presentation.textPosition, "center");
  }
});

test("recipient ready mapping rejects missing required reveal data", async () => {
  await assert.rejects(
    resolveNextRecipientTap(
      rpcResult({
        status: "ready",
        reveal_session_id: "session-id",
        lumi_id: "lumi-id",
      }),
      "token"
    ),
    /Failed to resolve necklace/
  );
});

test("recipient ready mapping includes a valid Instagram attachment", async () => {
  const response = await resolveNextRecipientTap(
    rpcResult({
      status: "ready",
      reveal_session_id: "session-id",
      necklace_display_name: "Lumi",
      lumi_id: "lumi-id",
      lumi_text: "This made me think of you.",
      presentation: {},
      attachment: {
        type: "link",
        provider: "instagram",
        contentKind: "reel",
        url: "https://instagram.com/reel/ABC/",
        host: "instagram.com",
        ctaLabel: "View on Instagram",
        openMode: "external",
      },
    }),
    "token"
  );

  assert.equal(response.status, "ready");
  if (response.status === "ready") {
    assert.deepEqual(response.attachment, {
      type: "link",
      provider: "instagram",
      contentKind: "reel",
      url: "https://instagram.com/reel/ABC/",
      host: "instagram.com",
      ctaLabel: "View on Instagram",
      openMode: "external",
    });
  }
});

test("recipient ready mapping includes a valid website attachment", async () => {
  const response = await resolveNextRecipientTap(
    rpcResult({
      status: "ready",
      reveal_session_id: "session-id",
      lumi_id: "lumi-id",
      lumi_text: "Look at this.",
      presentation: {},
      attachment: {
        type: "link",
        provider: "website",
        contentKind: "link",
        url: "https://xn--bcher-kva.de/path?q=1#fragment",
        host: "xn--bcher-kva.de",
        ctaLabel: "Open website",
        openMode: "external",
      },
    }),
    "token"
  );

  assert.equal(response.status, "ready");
  if (response.status === "ready") {
    assert.deepEqual(response.attachment, {
      type: "link",
      provider: "website",
      contentKind: "link",
      url: "https://xn--bcher-kva.de/path?q=1#fragment",
      host: "xn--bcher-kva.de",
      ctaLabel: "Open website",
      openMode: "external",
    });
  }
});

test("text-only recipient mapping preserves the exact response shape", async () => {
  const response = await resolveNextRecipientTap(
    rpcResult({
      status: "ready",
      reveal_session_id: "session-id",
      lumi_id: "lumi-id",
      lumi_text: "Hello",
      presentation: {},
    }),
    "token"
  );

  assert.equal(response.status, "ready");
  assert.deepEqual(Object.keys(response).sort(), [
    "lumi",
    "necklace",
    "presentation",
    "revealSessionId",
    "status",
  ]);
});
