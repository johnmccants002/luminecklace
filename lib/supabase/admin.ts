import "server-only";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_SECRET_KEY_ENV = "SUPABASE_SECRET_KEY";

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Missing required Supabase environment variable: ${name}. Add it to your .env file and restart the dev server.`
    );
  }

  return value;
}

const supabaseUrl = getRequiredEnvVar(SUPABASE_URL_ENV);
const supabaseSecretKey = getRequiredEnvVar(SUPABASE_SECRET_KEY_ENV);

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);
