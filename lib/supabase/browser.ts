import { createBrowserClient } from "@supabase/ssr";

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

export function createSupabaseBrowserClient() {
  const supabaseUrl = getRequiredEnvVar(SUPABASE_URL_ENV);
  const supabasePublishableKey = getRequiredEnvVar(SUPABASE_PUBLISHABLE_KEY_ENV);

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
