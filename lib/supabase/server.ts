import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Missing required Supabase environment variable: ${name}. Add it to your .env file and restart the dev server.`
    );
  }

  return value;
}

export async function createSupabaseServerClient() {
  const supabaseUrl = getRequiredEnvVar(SUPABASE_URL_ENV);
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
