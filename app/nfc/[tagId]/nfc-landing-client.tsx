"use client";

import { useEffect, useMemo, useState } from "react";

type NfcLandingClientProps = {
  tagId: string;
};

type ResolveResponse =
  | {
      success: true;
      tag: {
        tagId?: string | null;
        sku?: string | null;
        status?: string | null;
        isClaimed?: boolean;
      };
    }
  | {
      success?: false;
      error?: string;
    };

const IOS_APP_URL =
  process.env.NEXT_PUBLIC_IOS_APP_URL ?? "https://apps.apple.com/us/genre/ios/id36";
const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL ??
  "https://play.google.com/store/apps";

function detectPlatform(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    return "ios";
  }
  if (/android/.test(ua)) {
    return "android";
  }
  return "other";
}

export function NfcLandingClient({ tagId }: NfcLandingClientProps) {
  const [statusMessage, setStatusMessage] = useState(
    tagId ? "Checking necklace..." : "Invalid necklace link."
  );
  const [statusTone, setStatusTone] = useState<"neutral" | "good" | "warn">(
    tagId ? "neutral" : "warn"
  );

  const platform = useMemo<"ios" | "android" | "other">(() => {
    if (typeof navigator === "undefined") {
      return "other";
    }
    return detectPlatform(navigator.userAgent);
  }, []);

  useEffect(() => {
    if (!tagId) {
      return;
    }

    localStorage.setItem("lumi.pendingTagId", tagId);
    localStorage.setItem("lumi.pendingNfcSeenAt", new Date().toISOString());

    let isMounted = true;

    void (async () => {
      try {
        const response = await fetch("/api/nfc/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tagId }),
        });

        const payload = (await response.json()) as ResolveResponse;
        if (!isMounted) {
          return;
        }

        if (!response.ok) {
          const errorMessage =
            "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "Unable to resolve this necklace.";
          setStatusMessage(errorMessage);
          setStatusTone("warn");
          return;
        }

        const isClaimed =
          "tag" in payload &&
          typeof payload.tag === "object" &&
          payload.tag !== null &&
          payload.tag.isClaimed === true;

        setStatusMessage(
          isClaimed
            ? "Necklace detected. Sign in to continue."
            : "Necklace detected. Activate in the app."
        );
        setStatusTone("good");
      } catch {
        if (!isMounted) {
          return;
        }
        setStatusMessage("Necklace detected. Continue in the app.");
        setStatusTone("neutral");
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [tagId]);

  const appStoreUrl = useMemo(() => {
    if (platform === "ios") {
      return IOS_APP_URL;
    }
    if (platform === "android") {
      return ANDROID_APP_URL;
    }
    return IOS_APP_URL;
  }, [platform]);

  const deepLink = useMemo(
    () => `luminecklace://activate/${encodeURIComponent(tagId)}`,
    [tagId]
  );

  const statusClassName =
    statusTone === "good"
      ? "text-emerald-700"
      : statusTone === "warn"
        ? "text-rose-700"
        : "text-[#6e4a4f]";

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fff7f5] via-[#fdf0ed] to-[#f8e5e2] px-6 py-12 text-[#2a1214]">
      <div className="mx-auto flex max-w-xl flex-col gap-8 rounded-3xl border border-[#f2d9d4] bg-white/75 p-8 shadow-sm backdrop-blur">
        <section className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#9f6f76]">
            Lumi Necklace
          </p>
          <h1 className="text-3xl font-semibold leading-tight">
            Your necklace is ready.
          </h1>
          <p className="text-base text-[#6e4a4f]">
            Download the Lumi app, sign in, and activate your necklace to unlock
            daily affirmations.
          </p>
        </section>

        <section className="rounded-2xl bg-[#fff4f1] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9f6f76]">
            Detected Necklace ID
          </p>
          <p className="mt-1 font-mono text-sm text-[#2a1214]">{tagId}</p>
          <p className={`mt-2 text-sm ${statusClassName}`}>{statusMessage}</p>
        </section>

        <div className="flex flex-col gap-3">
          <a
            href={appStoreUrl}
            className="rounded-xl bg-[#2a1214] px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Download the Lumi App
          </a>
          <a
            href={deepLink}
            className="rounded-xl border border-[#2a1214]/20 bg-white px-4 py-3 text-center text-sm font-semibold text-[#2a1214]"
          >
            Open in App
          </a>
        </div>
      </div>
    </main>
  );
}
