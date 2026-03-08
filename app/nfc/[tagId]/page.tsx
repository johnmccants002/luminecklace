import type { Metadata } from "next";

import { NfcLandingClient } from "./nfc-landing-client";

type NfcLandingPageProps = {
  params: Promise<{
    tagId: string;
  }>;
};

export const metadata: Metadata = {
  title: "Activate Your Necklace",
  description:
    "Your Lumi Necklace is ready. Download the app and activate your tag for daily affirmations.",
};

export default async function NfcLandingPage({ params }: NfcLandingPageProps) {
  const { tagId } = await params;
  const normalizedTagId = decodeURIComponent(tagId).trim();

  return <NfcLandingClient tagId={normalizedTagId} />;
}
