"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/auth/invitation-error");
        return;
      }
      setReady(true);
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError("We could not set your password. Please request a new setup link.");
      return;
    }

    router.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-16">
      <section className="w-full rounded-3xl border border-[#2a1214]/10 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#9d5d63]">
          Lumi Necklace
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-[#2a1214]">
          Set your password
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#2a1214]/70">
          Finish setting up the account connected to your purchase.
        </p>

        <form className="mt-8 space-y-5" onSubmit={submit}>
          <label className="block text-sm font-medium text-[#2a1214]">
            Password
            <input
              className="mt-2 w-full rounded-xl border border-[#2a1214]/20 px-4 py-3 outline-none focus:border-[#9d5d63]"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!ready || saving}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-[#2a1214]">
            Confirm password
            <input
              className="mt-2 w-full rounded-xl border border-[#2a1214]/20 px-4 py-3 outline-none focus:border-[#9d5d63]"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!ready || saving}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button
            className="w-full rounded-xl bg-[#2a1214] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={!ready || saving}
          >
            {saving ? "Saving…" : ready ? "Save password" : "Checking link…"}
          </button>
        </form>
      </section>
    </main>
  );
}
