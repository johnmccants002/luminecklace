import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  parseDeletePushDevice,
  parseRegisterPushDevice,
  PushValidationError,
} from "@/lib/push/validation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new PushValidationError("Invalid JSON body");
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const input = parseRegisterPushDevice(await readJson(req));
    const { error } = await supabaseAdmin.rpc("register_push_device", {
      p_user_id: user.id,
      p_device_token: input.deviceToken,
      p_environment: input.environment,
      p_bundle_id: input.bundleId,
      p_app_version: input.appVersion,
      p_device_model: input.deviceModel,
    });
    if (error) throw new Error("Push device upsert failed");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof PushValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to register push device");
    return NextResponse.json(
      { error: "Failed to register push device" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const input = parseDeletePushDevice(await readJson(req));
    const { error } = await supabaseAdmin.rpc("deactivate_push_device", {
      p_user_id: user.id,
      p_device_token: input.deviceToken,
      p_environment: input.environment,
      p_bundle_id: input.bundleId,
    });
    if (error) throw new Error("Push device deactivation failed");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof PushValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to deactivate push device");
    return NextResponse.json(
      { error: "Failed to deactivate push device" },
      { status: 500 }
    );
  }
}
