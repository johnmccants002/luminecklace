export const APNS_BUNDLE_ID = "luminecklace.luminecklace";

export const PUSH_EVENT_TYPES = [
  "lumi.revealed",
  "lumi.reacted",
  "lumi.responded",
] as const;

export type PushEventType = (typeof PUSH_EVENT_TYPES)[number];
export type ApnsEnvironment = "sandbox" | "production";

export type PushEventPayload = {
  type: PushEventType;
  necklaceId: string;
  lumiId: string;
  revealSessionId?: string;
  reaction?: string;
};

export type ClaimedPushDelivery = {
  deliveryId: string;
  claimToken: string;
  attemptCount: number;
  deviceToken: string;
  environment: ApnsEnvironment;
  bundleId: string;
  eventType: PushEventType;
  eventPayload: PushEventPayload;
};

export type DispatchSummary = {
  claimed: number;
  sent: number;
  retried: number;
  invalid: number;
  failed: number;
};

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: "default";
    "thread-id": string;
    category: "LUMI_ACTIVITY";
  };
  type: PushEventType;
  necklaceId: string;
  lumiId: string;
  revealSessionId?: string;
};
