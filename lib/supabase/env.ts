const SUPABASE_HOSTNAME_SUFFIX = ".supabase.co";

export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Missing required Supabase environment variable: ${name}. Add it to your .env file and restart the dev server.`
    );
  }

  return value.trim();
}

export function getRequiredSupabaseUrl(name: string): string {
  const value = getRequiredEnvVar(name);

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Invalid Supabase URL in ${name}. Expected a full https URL like https://<project-ref>.supabase.co.`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Invalid Supabase URL in ${name}. Expected an https URL like https://<project-ref>.supabase.co.`
    );
  }

  if (!parsed.hostname.endsWith(SUPABASE_HOSTNAME_SUFFIX)) {
    throw new Error(
      `Invalid Supabase URL in ${name}. Expected a Supabase host ending in ${SUPABASE_HOSTNAME_SUFFIX}.`
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

export function getSupabaseConnectionErrorMessage(error: unknown): string | null {
  if (!(error && typeof error === "object")) {
    return null;
  }

  const message = "message" in error ? error.message : "";
  const details = "details" in error ? error.details : "";
  const combined = [message, details]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  if (combined.includes("ENOTFOUND")) {
    return "Supabase host could not be resolved. Check NEXT_PUBLIC_SUPABASE_URL and restart the dev server.";
  }

  if (combined.includes("fetch failed")) {
    return "Failed to reach Supabase. Verify your Supabase URL and network access, then restart the dev server.";
  }

  return null;
}
