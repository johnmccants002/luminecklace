import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { SITE_URL } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const INVITE_TYPE: EmailOtpType = "invite";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const errorUrl = new URL("/auth/invitation-error", SITE_URL);

  if (!tokenHash || type !== INVITE_TYPE) {
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: INVITE_TYPE,
  });

  if (verifyError) {
    return NextResponse.redirect(errorUrl);
  }

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user || !data.user.email_confirmed_at) {
    return NextResponse.redirect(errorUrl);
  }

  const { error: attachError } = await supabase.rpc(
    "attach_confirmed_orders",
    { p_auth_user_id: data.user.id }
  );
  if (attachError) {
    console.error("Failed to attach confirmed orders", attachError);
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(new URL("/auth/set-password", SITE_URL));
}
