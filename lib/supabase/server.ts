import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getRequiredEnvVar, getRequiredSupabaseUrl } from "@/lib/supabase/env";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export async function createSupabaseServerClient() {
  const supabaseUrl = getRequiredSupabaseUrl(SUPABASE_URL_ENV);
  const supabasePublishableKey = getRequiredEnvVar(SUPABASE_PUBLISHABLE_KEY_ENV);
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name, options) {
        cookieStore.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });
}
