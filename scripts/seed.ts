import "server-only";

import { supabaseAdmin } from "../lib/supabase/admin";

type SeedPackage = {
  id: string;
  title: string;
  is_premium: boolean;
  messages: string[];
};

const SEED_PACKAGES: SeedPackage[] = [
  {
    id: "love",
    title: "Love",
    is_premium: false,
    messages: [
      "You are my favorite part of every day.",
      "I choose you, again and again.",
      "You make ordinary moments feel like magic.",
      "My heart feels at home with you.",
    ],
  },
  {
    id: "motivation",
    title: "Motivation",
    is_premium: false,
    messages: [
      "Small steps still move you forward.",
      "You can do hard things.",
      "Progress beats perfection every time.",
      "Your future is built by what you do today.",
    ],
  },
  {
    id: "calm",
    title: "Calm",
    is_premium: false,
    messages: [
      "Breathe in for four, out for six.",
      "You are safe in this moment.",
      "Let your shoulders soften and your jaw relax.",
      "Peace grows in the pauses.",
    ],
  },
  {
    id: "confidence",
    title: "Confidence",
    is_premium: true,
    messages: [
      "You belong in every room you enter.",
      "Trust the strength you've already built.",
      "Your voice matters. Use it.",
      "Stand tall. You are ready for this.",
    ],
  },
];

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

async function seedMessages() {
  const packageIds = SEED_PACKAGES.map((pkg) => pkg.id);
  const allSeedTexts = SEED_PACKAGES.flatMap((pkg) => pkg.messages);

  console.log("[seed] Loading existing messages to keep inserts idempotent...");
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("messages")
    .select("package_id, text")
    .in("package_id", packageIds)
    .in("text", allSeedTexts);

  if (existingError) {
    throw new Error(
      `[seed] Failed to query existing messages: ${existingError.message}`
    );
  }

  const existingKeys = new Set(
    (existingRows ?? [])
      .map((row) => {
        const packageId = typeof row.package_id === "string" ? row.package_id : "";
        const text = typeof row.text === "string" ? row.text : "";
        return `${packageId}::${text}`;
      })
      .filter((key) => key !== "::")
  );

  const rowsToInsert = SEED_PACKAGES.flatMap((pkg) =>
    pkg.messages
      .filter((text) => !existingKeys.has(`${pkg.id}::${text}`))
      .map((text) => ({
        package_id: pkg.id,
        text,
        is_active: true,
      }))
  );

  if (rowsToInsert.length === 0) {
    console.log("[seed] No new messages to insert.");
    return;
  }

  console.log(`[seed] Inserting ${rowsToInsert.length} new messages...`);
  const { error: insertError } = await supabaseAdmin
    .from("messages")
    .insert(rowsToInsert);

  if (insertError) {
    throw new Error(`[seed] Failed to insert messages: ${insertError.message}`);
  }

  console.log("[seed] Message insert complete.");
}

async function main() {
  console.log("[seed] Starting seed...");
  await seedPackages();
  await seedMessages();
  console.log("[seed] Done.");
}

main().catch((error) => {
  console.error("[seed] Seed failed.");
  console.error(error);
  process.exitCode = 1;
});
