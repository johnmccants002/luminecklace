"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { normalizedRecoveryEmail, parseRecoveryLink, saveRecoveryPassword, verifyRecoveryLink } from "@/lib/auth/password-recovery";
import { createSupabaseRecoveryClient } from "@/lib/supabase/recovery";

const inputClass = "mt-2 w-full rounded-xl border border-[#2a1214]/20 px-4 py-3 outline-none focus:border-[#9d5d63]";
const buttonClass = "w-full rounded-xl bg-[#2a1214] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

export default function ResetPasswordPage() {
  const client = useRef<ReturnType<typeof createSupabaseRecoveryClient> | null>(null);
  const verification = useRef<Promise<string> | null>(null);
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "saved">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    // Reuse this promise during React's development effect replay so a
    // single-use email token is not redeemed twice.
    if (!verification.current) {
      const link = parseRecoveryLink(window.location.href);
      window.history.replaceState(null, "", window.location.pathname);
      verification.current = (async () => {
        client.current = createSupabaseRecoveryClient();
        return verifyRecoveryLink(client.current.auth, link);
      })();
    }
    void verification.current.then((address) => {
      if (active) { setEmail(address); setStatus("ready"); }
    }).catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : "We couldn’t verify this link. Request a new one below.");
        setStatus("invalid");
      }
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || status !== "ready" || !client.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await saveRecoveryPassword(client.current.auth, password, confirmation);
      setPassword("");
      setConfirmation("");
      setStatus("saved");
      // Recovery credentials remain only in memory and are discarded on success.
      // This must not sign out an unrelated website session in another tab.
      const completed = client.current;
      client.current = null;
      void completed.auth.signOut({ scope: "local" }).catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t save your password. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-16">
      <section className="w-full rounded-3xl border border-[#2a1214]/10 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#9d5d63]">Lumi Necklace</p>
        <h1 className="mt-3 text-3xl font-semibold text-[#2a1214]">{status === "saved" ? "Password updated" : "Reset your password"}</h1>
        {status === "checking" && <p className="mt-4" role="status">Checking your reset link…</p>}
        {status === "saved" ? (
          <div className="mt-6 space-y-4" role="status">
            <p>Return to the Lumi app and sign in as <strong className="break-all">{email}</strong> with your new password.</p>
            <p>You can close this page now.</p>
            <Link className="inline-block underline" href="/">Go to Lumi website</Link>
          </div>
        ) : (
          <>
            {status === "ready" && <p className="mt-3 break-words text-sm">Choose a new password for {email}.</p>}
            {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
            {status === "ready" && (
              <form className="mt-6 space-y-5" onSubmit={submit}>
                <label className="block text-sm font-medium">New password
                  <input className={inputClass} type="password" autoComplete="new-password" minLength={8} required disabled={saving} value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <label className="block text-sm font-medium">Confirm new password
                  <input className={inputClass} type="password" autoComplete="new-password" minLength={8} required disabled={saving} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                </label>
                <button className={buttonClass} disabled={saving} type="submit">{saving ? "Saving…" : "Save new password"}</button>
              </form>
            )}
            {status !== "checking" && <ResetLinkRequest initialEmail={email} />}
          </>
        )}
        <p className="mt-8 text-sm">Need help? <a className="break-all underline" href="mailto:support@luminecklace.com">support@luminecklace.com</a></p>
      </section>
    </main>
  );
}

function ResetLinkRequest({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setError("");
    setNotice("");
    const address = normalizedRecoveryEmail(email);
    if (!address) { setError("Enter a valid email address."); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      if (!response.ok || (await response.json()).success !== true) throw new Error("Request failed");
      setNotice(`If ${address} has an eligible account, you’ll receive a reset link. Check your inbox and spam folder. Allow a few minutes before requesting another email.`);
    } catch {
      setError("The reset link couldn’t be requested. Try again, or contact support below.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="mt-8 border-t pt-6" open={!initialEmail}>
      <summary className="cursor-pointer font-semibold">Request a new reset link</summary>
      <form className="mt-4 space-y-4" onSubmit={request}>
        <label className="block text-sm font-medium">Account email
          <input className={inputClass} type="email" autoComplete="email" required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <button className={buttonClass} type="submit" disabled={busy}>{busy ? "Requesting…" : "Request reset link"}</button>
      </form>
    </details>
  );
}
