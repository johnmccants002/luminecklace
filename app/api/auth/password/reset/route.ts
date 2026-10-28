import { handlePasswordResetRequest } from "@/lib/auth/password-recovery";
import { SITE_URL } from "@/lib/config";
import { createSupabaseRecoveryClient } from "@/lib/supabase/recovery";

export async function POST(request: Request) {
  return handlePasswordResetRequest(request, (email) =>
    createSupabaseRecoveryClient().auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/auth/reset-password", SITE_URL).toString(),
    })
  );
}
