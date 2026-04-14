import { createBrowserClient } from "@supabase/ssr";

import { getRequiredEnvVar, getRequiredSupabaseUrl } from "@/lib/supabase/env";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export function createSupabaseBrowserClient() {
  const supabaseUrl = getRequiredSupabaseUrl(SUPABASE_URL_ENV);
  const supabasePublishableKey = getRequiredEnvVar(SUPABASE_PUBLISHABLE_KEY_ENV);

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
