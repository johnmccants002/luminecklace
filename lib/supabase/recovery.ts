import { createClient } from "@supabase/supabase-js";

// Recovery begins in iOS and may finish in a different browser. A PKCE verifier
// stored in the requesting browser's cookies would not survive that handoff.
// This client never reads or persists the website's ordinary login session.
export function createSupabaseRecoveryClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Password recovery is not configured.");

  return createClient(url, key, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
