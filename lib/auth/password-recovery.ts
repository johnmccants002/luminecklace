import type { SupabaseClient } from "@supabase/supabase-js";

type RecoveryAuth = Pick<SupabaseClient["auth"], "verifyOtp" | "setSession" | "getUser">;
type SendReset = (email: string) => Promise<{ error: { code?: string } | null }>;

export function normalizedRecoveryEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^.\s@]+(?:\.[^.\s@]+)+$/.test(email)
    ? email
    : null;
}

export async function handlePasswordResetRequest(request: Request, send: SendReset) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = normalizedRecoveryEmail(
    body && typeof body === "object" && "email" in body ? body.email : null
  );
  if (!email) {
    return Response.json({ error: "A valid email is required" }, { status: 400 });
  }

  try {
    // The public Supabase recovery API enforces its configured email cooldown
    // and project rate limits. Do not use admin.generateLink to bypass them.
    const { error } = await send(email);
    if (error) console.warn("Password recovery request was not delivered", error.code ?? "provider_error");
  } catch {
    return Response.json(
      { error: "Password recovery is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }

  // Match for existing/missing accounts, email cooldowns, and provider failures.
  // Accepted means the request was received, not that an email was delivered.
  return Response.json(
    { success: true, message: "If the account is eligible, a password-reset link will be sent." },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}

export type RecoveryLink =
  | { kind: "tokenHash"; tokenHash: string }
  | { kind: "session"; accessToken: string; refreshToken: string };

export function parseRecoveryLink(href: string): RecoveryLink | null {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.has("error") || url.searchParams.has("error_code") || fragment.has("error") || fragment.has("error_code")) return null;

  // Supports a custom recovery email template as well as Supabase's default
  // ConfirmationURL, which verifies the link and redirects with session tokens.
  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash && url.searchParams.get("type") === "recovery") {
    return { kind: "tokenHash", tokenHash };
  }
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (fragment.get("type") === "recovery" && accessToken && refreshToken) {
    return { kind: "session", accessToken, refreshToken };
  }
  return null;
}

export async function verifyRecoveryLink(auth: RecoveryAuth, link: RecoveryLink | null): Promise<string> {
  if (!link) throw new Error("Open the newest password-reset link from your email.");
  const result = link.kind === "tokenHash"
    ? await auth.verifyOtp({ token_hash: link.tokenHash, type: "recovery" })
    : await auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
  if (result.error || !result.data.session) throw new Error("This reset link has expired or is invalid. Request a new link below.");
  // Verify with Auth rather than trusting URL contents or a decoded JWT.
  const { data, error } = await auth.getUser();
  if (error || !data.user?.email) throw new Error("This reset link has expired or is invalid. Request a new link below.");
  return data.user.email;
}

export async function saveRecoveryPassword(
  auth: Pick<SupabaseClient["auth"], "updateUser">,
  password: string,
  confirmation: string
) {
  if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  const { error } = await auth.updateUser({ password });
  if (error) throw new Error("We couldn’t save your password. Try again, or request a new reset link.");
}
