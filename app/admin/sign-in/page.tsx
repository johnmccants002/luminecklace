import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Admin sign in" };

export default function AdminSignInPage() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <section className="w-full max-w-md rounded-3xl border border-[#3a1e22]/10 bg-white p-8 shadow-xl shadow-[#4b2028]/5">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#c9484a]">Lumi internal</p>
        <h1 className="mt-3 font-serif text-4xl">Admin sign in</h1>
        <p className="mt-2 text-sm text-[#765d60]">Use your authorized Lumi account.</p>
        <Suspense fallback={<p className="mt-8 text-sm text-[#765d60]">Loading…</p>}>
          <SignInForm />
        </Suspense>
      </section>
    </main>
  );
}

