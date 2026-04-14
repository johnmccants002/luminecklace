import { createClient } from "@supabase/supabase-js";

import { getRequiredEnvVar, getRequiredSupabaseUrl } from "../lib/supabase/env";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_SECRET_KEY_ENV = "SUPABASE_SECRET_KEY";

const supabaseAdmin = createClient(
  getRequiredSupabaseUrl(SUPABASE_URL_ENV),
  getRequiredEnvVar(SUPABASE_SECRET_KEY_ENV)
);

type MessageCategory =
  | "affection"
  | "comfort"
  | "encouragement"
  | "presence"
  | "reassurance";

type MessageTone = "warm" | "comforting" | "encouraging" | "grounded";

type SeedMessage = {
  text: string;
  category: MessageCategory;
  tone: MessageTone;
  active: boolean;
};

type SeedPackage = {
  id: string;
  title: string;
  is_premium: boolean;
  messages: SeedMessage[];
};

type SeedSkuMapping = {
  sku: string;
  name: string;
  base_package_ids: string[];
};

type MessageRow = {
  package_id?: string | null;
  text?: string | null;
  is_active?: boolean | null;
  category?: string | null;
  tone?: string | null;
};

type NecklaceSkuRow = {
  base_package_ids?: unknown;
};

const HEART_CORE_MESSAGES: SeedMessage[] = [
  { text: "You are loved more than you know.", category: "affection", tone: "warm", active: true },
  { text: "I'm so glad you're here.", category: "affection", tone: "warm", active: true },
  { text: "You make this world better just by being in it.", category: "affection", tone: "warm", active: true },
  { text: "You matter to me every single day.", category: "affection", tone: "warm", active: true },
  { text: "You are easy to love.", category: "affection", tone: "warm", active: true },
  { text: "Your heart is one of my favorite places.", category: "affection", tone: "warm", active: true },
  { text: "You are deeply appreciated.", category: "affection", tone: "warm", active: true },
  { text: "You are my kind of person.", category: "affection", tone: "warm", active: true },
  { text: "You don't have to carry everything alone.", category: "comfort", tone: "comforting", active: true },
  { text: "It's okay to pause and breathe for a minute.", category: "comfort", tone: "comforting", active: true },
  { text: "You're safe to take this one moment at a time.", category: "comfort", tone: "comforting", active: true },
  { text: "I'm with you, even in quiet moments.", category: "comfort", tone: "comforting", active: true },
  { text: "You are allowed to rest.", category: "comfort", tone: "comforting", active: true },
  { text: "You can exhale now. You're doing enough.", category: "comfort", tone: "comforting", active: true },
  { text: "Hard days don't erase your strength.", category: "comfort", tone: "comforting", active: true },
  { text: "Take your time. There is no rush here.", category: "comfort", tone: "comforting", active: true },
  { text: "You can do this, one small step at a time.", category: "encouragement", tone: "encouraging", active: true },
  { text: "You've handled hard things before, and you can again.", category: "encouragement", tone: "encouraging", active: true },
  { text: "Your effort counts, even when progress feels slow.", category: "encouragement", tone: "encouraging", active: true },
  { text: "Keep going. You're building something good.", category: "encouragement", tone: "encouraging", active: true },
  { text: "You are stronger than this moment feels.", category: "encouragement", tone: "encouraging", active: true },
  { text: "I believe in you, especially right now.", category: "encouragement", tone: "encouraging", active: true },
  { text: "Today is a fresh chance to begin again.", category: "encouragement", tone: "encouraging", active: true },
  { text: "Your pace is valid. Keep moving forward.", category: "encouragement", tone: "encouraging", active: true },
  { text: "I'm right here with you.", category: "presence", tone: "grounded", active: true },
  { text: "You are not alone in this.", category: "presence", tone: "grounded", active: true },
  { text: "Even when it's quiet, I'm still with you.", category: "presence", tone: "grounded", active: true },
  { text: "You're held in love right now.", category: "presence", tone: "grounded", active: true },
  { text: "I'm thinking of you in this moment.", category: "presence", tone: "grounded", active: true },
  { text: "If today feels heavy, lean on me.", category: "presence", tone: "grounded", active: true },
  { text: "You don't have to explain everything for me to stay.", category: "presence", tone: "grounded", active: true },
  { text: "I'm in your corner, always.", category: "presence", tone: "grounded", active: true },
  { text: "You are enough exactly as you are.", category: "reassurance", tone: "comforting", active: true },
  { text: "You are doing better than you think.", category: "reassurance", tone: "comforting", active: true },
  { text: "Nothing about this moment can reduce your worth.", category: "reassurance", tone: "comforting", active: true },
  { text: "You don't need to be perfect to be loved.", category: "reassurance", tone: "comforting", active: true },
  { text: "You are allowed to feel what you feel.", category: "reassurance", tone: "comforting", active: true },
  { text: "You are still growing, and that is a good thing.", category: "reassurance", tone: "comforting", active: true },
  { text: "You are not behind. You are on your path.", category: "reassurance", tone: "comforting", active: true },
  { text: "You are loved through every version of today.", category: "reassurance", tone: "comforting", active: true },
];

const SEED_PACKAGES: SeedPackage[] = [
  {
    id: "heart-core",
    title: "Heart Collection",
    is_premium: false,
    messages: HEART_CORE_MESSAGES,
  },
];

const SEED_SKU_MAPPINGS: SeedSkuMapping[] = [
  {
    sku: "HEART-01",
    name: "Heart Necklace",
    base_package_ids: ["heart-core"],
  },
];

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function isMissingColumnError(errorMessage: string, columnName: string): boolean {
  const normalized = errorMessage.toLowerCase();
  const quotedColumn = `'${columnName.toLowerCase()}'`;
  const doubleQuotedColumn = `"${columnName.toLowerCase()}"`;

  return (
    normalized.includes(`column ${doubleQuotedColumn} does not exist`) ||
    normalized.includes(`column messages.${columnName.toLowerCase()} does not exist`) ||
    normalized.includes(`could not find the ${quotedColumn} column`) ||
    normalized.includes(`could not find the ${doubleQuotedColumn} column`)
  );
}

async function supportsMessagesColumn(columnName: "category" | "tone") {
  const { error } = await supabaseAdmin.from("messages").select(columnName).limit(1);
  if (!error) {
    return true;
  }

  if (isMissingColumnError(error.message, columnName)) {
    console.log(`[seed] messages.${columnName} not found; seeding without ${columnName}.`);
    return false;
  }

  throw new Error(
    `[seed] Failed while checking messages.${columnName} support: ${error.message}`
  );
}

async function seedPackages() {
  const packageRows = SEED_PACKAGES.map((pkg) => ({
    id: pkg.id,
    title: pkg.title,
    is_premium: pkg.is_premium,
  }));

  console.log(`[seed] Upserting ${packageRows.length} package rows...`);
  const { error } = await supabaseAdmin
    .from("packages")
    .upsert(packageRows, { onConflict: "id" });

  if (error) {
    throw new Error(`[seed] Failed to upsert packages: ${error.message}`);
  }

  console.log("[seed] Packages upsert complete.");
}

async function seedSkuMappings() {
  for (const mapping of SEED_SKU_MAPPINGS) {
    const { data: existingSku, error: existingSkuError } = await supabaseAdmin
      .from("necklace_skus")
      .select("base_package_ids")
      .eq("sku", mapping.sku)
      .maybeSingle<NecklaceSkuRow>();

    if (existingSkuError) {
      throw new Error(
        `[seed] Failed to fetch existing sku ${mapping.sku}: ${existingSkuError.message}`
      );
    }

    const mergedBasePackageIds = Array.from(
      new Set([
        ...normalizeStringArray(existingSku?.base_package_ids),
        ...mapping.base_package_ids,
      ])
    );

    const { error: upsertError } = await supabaseAdmin.from("necklace_skus").upsert(
      {
        sku: mapping.sku,
        name: mapping.name,
        base_package_ids: mergedBasePackageIds,
      },
      { onConflict: "sku" }
    );

    if (upsertError) {
      throw new Error(
        `[seed] Failed to upsert necklace sku ${mapping.sku}: ${upsertError.message}`
      );
    }
  }

  console.log("[seed] Necklace SKU mappings upsert complete.");
}

async function seedMessages() {
  const supportsCategory = await supportsMessagesColumn("category");
  const supportsTone = await supportsMessagesColumn("tone");

  const packageIds = SEED_PACKAGES.map((pkg) => pkg.id);
  const allSeedTexts = SEED_PACKAGES.flatMap((pkg) =>
    pkg.messages.map((message) => message.text)
  );
  const selectColumns = ["package_id", "text", "is_active"];
  if (supportsCategory) {
    selectColumns.push("category");
  }
  if (supportsTone) {
    selectColumns.push("tone");
  }

  console.log("[seed] Loading existing messages to keep inserts idempotent...");
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("messages")
    .select(selectColumns.join(", "))
    .in("package_id", packageIds)
    .in("text", allSeedTexts);

  if (existingError) {
    throw new Error(
      `[seed] Failed to query existing messages: ${existingError.message}`
    );
  }

  const existingRowsByKey = new Map<string, MessageRow>();
  for (const row of (existingRows ?? []) as MessageRow[]) {
    const packageId = typeof row.package_id === "string" ? row.package_id : "";
    const text = typeof row.text === "string" ? row.text : "";
    const key = `${packageId}::${text}`;
    if (key === "::" || existingRowsByKey.has(key)) {
      continue;
    }
    existingRowsByKey.set(key, row);
  }

  const rowsToInsert = SEED_PACKAGES.flatMap((pkg) =>
    pkg.messages
      .filter((message) => !existingRowsByKey.has(`${pkg.id}::${message.text}`))
      .map((message) => {
        const row: {
          package_id: string;
          text: string;
          is_active: boolean;
          category?: MessageCategory;
          tone?: MessageTone;
        } = {
          package_id: pkg.id,
          text: message.text,
          is_active: message.active,
        };

        if (supportsCategory) {
          row.category = message.category;
        }

        if (supportsTone) {
          row.tone = message.tone;
        }

        return row;
      })
  );

  const rowsNeedingUpdate = SEED_PACKAGES.flatMap((pkg) =>
    pkg.messages
      .map((message) => {
        const existing = existingRowsByKey.get(`${pkg.id}::${message.text}`);
        if (!existing) {
          return null;
        }

        const updatePayload: {
          is_active?: boolean;
          category?: MessageCategory;
          tone?: MessageTone;
        } = {};

        if (existing.is_active !== message.active) {
          updatePayload.is_active = message.active;
        }

        if (supportsCategory && existing.category !== message.category) {
          updatePayload.category = message.category;
        }

        if (supportsTone && existing.tone !== message.tone) {
          updatePayload.tone = message.tone;
        }

        return Object.keys(updatePayload).length > 0
          ? {
              package_id: pkg.id,
              text: message.text,
              updatePayload,
            }
          : null;
      })
      .filter(
        (
          row
        ): row is {
          package_id: string;
          text: string;
          updatePayload: {
            is_active?: boolean;
            category?: MessageCategory;
            tone?: MessageTone;
          };
        } => row !== null
      )
  );

  if (rowsToInsert.length === 0) {
    console.log("[seed] No new messages to insert.");
  } else {
    console.log(`[seed] Inserting ${rowsToInsert.length} new messages...`);
    const { error: insertError } = await supabaseAdmin
      .from("messages")
      .insert(rowsToInsert);

    if (insertError) {
      throw new Error(`[seed] Failed to insert messages: ${insertError.message}`);
    }

    console.log("[seed] Message insert complete.");
  }

  if (rowsNeedingUpdate.length === 0) {
    console.log("[seed] No existing messages required updates.");
    return;
  }

  console.log(`[seed] Updating ${rowsNeedingUpdate.length} existing messages...`);
  for (const row of rowsNeedingUpdate) {
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update(row.updatePayload)
      .eq("package_id", row.package_id)
      .eq("text", row.text);

    if (updateError) {
      throw new Error(
        `[seed] Failed to update message "${row.text}": ${updateError.message}`
      );
    }
  }

  console.log("[seed] Message updates complete.");
}

async function main() {
  console.log("[seed] Starting seed...");
  await seedPackages();
  await seedSkuMappings();
  await seedMessages();
  console.log("[seed] Done.");
}

main().catch((error) => {
  console.error("[seed] Seed failed.");
  console.error(error);
  process.exitCode = 1;
});
