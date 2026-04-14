import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getRequiredEnvVar, getRequiredSupabaseUrl } from "@/lib/supabase/env";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_SECRET_KEY_ENV = "SUPABASE_SECRET_KEY";

const supabaseUrl = getRequiredSupabaseUrl(SUPABASE_URL_ENV);
const supabaseSecretKey = getRequiredEnvVar(SUPABASE_SECRET_KEY_ENV);

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);
