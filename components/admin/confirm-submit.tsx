"use client";

import { useFormStatus } from "react-dom";

export function ConfirmSubmit({
  children,
  confirmation,
  tone = "default",
}: {
  children: React.ReactNode;
  confirmation?: string;
  tone?: "default" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (confirmation && !window.confirm(confirmation)) event.preventDefault();
      }}
      className={
        tone === "danger"
          ? "rounded-full bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          : "rounded-full bg-[#2a1214] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3a1b20] disabled:opacity-50"
      }
    >
      {pending ? "Working…" : children}
    </button>
  );
}

