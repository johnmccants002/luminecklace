import "server-only";

import { after } from "next/server";

import { dispatchPushDeliveries } from "@/lib/push/dispatcher";

export function schedulePushDispatch() {
  try {
    after(async () => {
      try {
        await dispatchPushDeliveries({ batchSize: 10 });
      } catch {
        console.error("Best-effort push dispatch failed");
      }
    });
  } catch {
    // Direct route-handler tests do not provide Next's request lifecycle. The
    // durable outbox remains available for the protected retry endpoint.
  }
}
