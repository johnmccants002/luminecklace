import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import { supabaseAdmin } from "@/lib/supabase/admin";

type TagRow = {
  tag_id?: string | null;
  sku?: string | null;
  owner_user_id?: string | null;
};

type UserSettingsRow = {
  enabled_package_ids?: unknown;
  equipped_tag_id?: string | null;
};

type NecklaceSkuRow = {
  theme_key?: string | null;
  animation_key?: string | null;
  sound_key?: string | null;
};

type PackageRow = {
  id?: string | null;
  is_premium?: boolean | null;
  title?: string | null;
};

type MessageRow = {
  id?: string | null;
  text?: string | null;
  package_id?: string | null;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

export async function GET(req: Request) {
  try {
    const { user } = await requireUser(req);

    const { searchParams } = new URL(req.url);
    const requestedTagId = searchParams.get("tagId")?.trim();

    const { data: userSettings, error: userSettingsError } = await supabaseAdmin
      .from("user_settings")
      .select("enabled_package_ids, equipped_tag_id")
      .eq("user_id", user.id)
      .maybeSingle<UserSettingsRow>();

    if (userSettingsError) {
      console.error("Failed to fetch user settings", userSettingsError);
      return NextResponse.json(
        { error: "Failed to fetch user settings" },
        { status: 500 }
      );
    }

    let activeTagId = requestedTagId ?? userSettings?.equipped_tag_id ?? null;

    if (requestedTagId) {
      const { data: requestedTag, error: requestedTagError } = await supabaseAdmin
        .from("tags")
        .select("tag_id, owner_user_id")
        .eq("tag_id", requestedTagId)
        .maybeSingle<TagRow>();

      if (requestedTagError) {
        console.error("Failed to fetch requested tag", requestedTagError);
        return NextResponse.json({ error: "Failed to fetch tag" }, { status: 500 });
      }

      if (!requestedTag) {
        return NextResponse.json({ error: "Tag not found" }, { status: 404 });
      }

      if (requestedTag.owner_user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (!activeTagId) {
      const { data: ownedTag, error: ownedTagError } = await supabaseAdmin
        .from("tags")
        .select("tag_id")
        .eq("owner_user_id", user.id)
        .order("claimed_at", { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle<TagRow>();

      if (ownedTagError) {
        console.error("Failed to fetch owned tag", ownedTagError);
        return NextResponse.json(
          { error: "Failed to resolve active tag" },
          { status: 500 }
        );
      }

      activeTagId = ownedTag?.tag_id ?? null;
    }

    if (!activeTagId) {
      return NextResponse.json(
        { error: "No activated necklace found for this user" },
        { status: 404 }
      );
    }

    const { data: activeTag, error: activeTagError } = await supabaseAdmin
      .from("tags")
      .select("sku, owner_user_id")
      .eq("tag_id", activeTagId)
      .maybeSingle<TagRow>();

    if (activeTagError) {
      console.error("Failed to fetch active tag", activeTagError);
      return NextResponse.json(
        { error: "Failed to fetch active tag" },
        { status: 500 }
      );
    }

    if (!activeTag) {
      return NextResponse.json({ error: "Active tag not found" }, { status: 404 });
    }

    if (activeTag.owner_user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!activeTag.sku) {
      return NextResponse.json(
        { error: "Active tag is missing sku" },
        { status: 500 }
      );
    }

    const { data: necklaceSku, error: necklaceSkuError } = await supabaseAdmin
      .from("necklace_skus")
      .select("theme_key, animation_key, sound_key")
      .eq("sku", activeTag.sku)
      .maybeSingle<NecklaceSkuRow>();

    if (necklaceSkuError) {
      console.error("Failed to fetch necklace sku", necklaceSkuError);
      return NextResponse.json(
        { error: "Failed to fetch experience settings" },
        { status: 500 }
      );
    }

    if (!necklaceSku) {
      return NextResponse.json(
        { error: "Necklace configuration not found" },
        { status: 404 }
      );
    }

    const enabledPackageIds = normalizeStringArray(userSettings?.enabled_package_ids);

    if (enabledPackageIds.length === 0) {
      return NextResponse.json(
        { error: "No packages are enabled for this account yet" },
        { status: 404 }
      );
    }

    const { data: activeSubscriptionRows, error: subscriptionError } =
      await supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .eq("user_id", user.id)
        .in("status", ["active"])
        .limit(1);

    if (subscriptionError) {
      console.error("Failed to fetch subscription status", subscriptionError);
      return NextResponse.json(
        { error: "Failed to check subscription status" },
        { status: 500 }
      );
    }

    const hasActiveSubscription = (activeSubscriptionRows?.length ?? 0) > 0;

    let allowedPackageIds = enabledPackageIds;
    if (!hasActiveSubscription) {
      const { data: allowedPackages, error: allowedPackagesError } =
        await supabaseAdmin
          .from("packages")
          .select("id, is_premium")
          .in("id", enabledPackageIds)
          .or("is_premium.is.false,is_premium.is.null");

      if (allowedPackagesError) {
        console.error("Failed to resolve allowed packages", allowedPackagesError);
        return NextResponse.json(
          { error: "Failed to resolve allowed packages" },
          { status: 500 }
        );
      }

      allowedPackageIds = (allowedPackages ?? [])
        .map((pkg: PackageRow) => pkg.id)
        .filter((id): id is string => typeof id === "string");
    }

    if (allowedPackageIds.length === 0) {
      return NextResponse.json(
        { error: "No messages available for your current access level" },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("messages")
      .select("id, text, package_id")
      .in("package_id", allowedPackageIds)
      .eq("is_active", true)
      .limit(50);

    if (messagesError) {
      console.error("Failed to fetch messages", messagesError);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    const messageCandidates = (messages ?? []).filter(
      (message: MessageRow) =>
        typeof message.id === "string" &&
        typeof message.text === "string" &&
        typeof message.package_id === "string"
    ) as Array<Required<Pick<MessageRow, "id" | "text" | "package_id">>>;

    if (messageCandidates.length === 0) {
      return NextResponse.json(
        { error: "No active messages are available for your enabled packages" },
        { status: 404 }
      );
    }

    const chosenMessage = pickRandom(messageCandidates);
    if (!chosenMessage) {
      return NextResponse.json(
        { error: "No active messages are available for your enabled packages" },
        { status: 404 }
      );
    }

    const { data: packageRow, error: packageError } = await supabaseAdmin
      .from("packages")
      .select("title")
      .eq("id", chosenMessage.package_id)
      .maybeSingle<{ title?: string | null }>();

    if (packageError) {
      console.error("Failed to fetch selected package title", packageError);
      return NextResponse.json(
        { error: "Failed to fetch selected package metadata" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: {
        id: chosenMessage.id,
        text: chosenMessage.text,
        packageId: chosenMessage.package_id,
        packageTitle: packageRow?.title ?? null,
      },
      experience: {
        themeKey: necklaceSku.theme_key ?? null,
        animationKey: necklaceSku.animation_key ?? null,
        soundKey: necklaceSku.sound_key ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Unhandled tap route error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
