"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-2xl border border-red-100 bg-white p-8">
      <p className="text-xs font-bold uppercase tracking-wide text-red-700">Unable to load</p>
      <h1 className="mt-2 font-serif text-3xl">The admin data request failed</h1>
      <p className="mb-5 mt-2 text-sm text-[#765d60]">No changes were made. Try the request again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

