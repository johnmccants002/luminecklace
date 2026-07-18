import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DEV_USER_EMAIL = "johnmccants002@gmail.com";
const DEV_USER_PASSWORD = process.env.LUMI_DEV_USER_PASSWORD?.trim() || "LumiDev002!";
const DEV_USER_DISPLAY_NAME = process.env.LUMI_DEV_USER_DISPLAY_NAME?.trim() || "John";

function readDotEnvVars() {
  try {
    const raw = readFileSync(".env", "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) {
          return null;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        return [key, value];
      })
      .filter(Boolean);

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

const dotEnv = readDotEnvVars();

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  (typeof dotEnv.NEXT_PUBLIC_SUPABASE_URL === "string"
    ? dotEnv.NEXT_PUBLIC_SUPABASE_URL.trim()
    : "");
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  (typeof dotEnv.SUPABASE_SECRET_KEY === "string"
    ? dotEnv.SUPABASE_SECRET_KEY.trim()
    : "");

if (!supabaseUrl) {
  throw new Error(
    "Missing required Supabase environment variable: NEXT_PUBLIC_SUPABASE_URL"
  );
}

if (!supabaseSecretKey) {
  throw new Error("Missing required Supabase environment variable: SUPABASE_SECRET_KEY");
}

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseSecretKey
);

async function seedDevUser() {
  const { data: usersData, error: listUsersError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listUsersError) {
    throw new Error(`Failed to list auth users: ${listUsersError.message}`);
  }

  const existingUser = usersData.users.find(
    (user) => typeof user.email === "string" && user.email.toLowerCase() === DEV_USER_EMAIL
  );

  if (existingUser) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
      password: DEV_USER_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: DEV_USER_DISPLAY_NAME,
      },
    });

    if (error) {
      throw new Error(`Failed to update existing dev user: ${error.message}`);
    }

    return { userId: data.user.id, created: false };
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: DEV_USER_EMAIL,
    password: DEV_USER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: DEV_USER_DISPLAY_NAME,
    },
  });

  if (error) {
    throw new Error(`Failed to create dev user: ${error.message}`);
  }

  if (!data.user) {
    throw new Error("Dev user was not returned after creation");
  }

  return { userId: data.user.id, created: true };
}

async function upsertProfile(userId: string) {
  const profileWithDisplayName = {
    id: userId,
    email: DEV_USER_EMAIL,
    display_name: DEV_USER_DISPLAY_NAME,
  };

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(profileWithDisplayName, { onConflict: "id" });

  if (!profileError) {
    return;
  }

  if (profileError.code === "42P01") {
    console.log("[seed-dev-user] profiles table does not exist yet; skipped profile insert.");
    return;
  }

  if (profileError.code === "42703" || profileError.message.includes("display_name")) {
    const { error: fallbackError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          email: DEV_USER_EMAIL,
        },
        { onConflict: "id" }
      );

    if (!fallbackError) {
      console.log("[seed-dev-user] profiles.display_name is not available; seeded email only.");
      return;
    }

    if (fallbackError.code === "42P01") {
      console.log("[seed-dev-user] profiles table does not exist yet; skipped profile insert.");
      return;
    }

    throw new Error(`Failed to upsert fallback profile row: ${fallbackError.message}`);
  }

  throw new Error(`Failed to upsert profile row: ${profileError.message}`);
}

async function main() {
  const result = await seedDevUser();
  await upsertProfile(result.userId);

  console.log(
    `[seed-dev-user] ${result.created ? "Created" : "Updated"} auth user ${DEV_USER_EMAIL}`
  );
  console.log(`[seed-dev-user] Password: ${DEV_USER_PASSWORD}`);
}

main().catch((error) => {
  console.error("[seed-dev-user] Failed", error);
  process.exitCode = 1;
});
