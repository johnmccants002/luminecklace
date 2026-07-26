import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-serif text-3xl tracking-tight text-[#2a1214]">{title}</h1>
        <p className="mt-1 text-sm text-[#765d60]">{description}</p>
      </div>
      {actions}
    </header>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[#3a1e22]/10 bg-white p-5 shadow-[0_12px_36px_rgba(69,31,37,0.04)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Card className="min-h-32">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8d7376]">
        {label}
      </p>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      {note ? <p className="mt-2 text-xs text-[#8d7376]">{note}</p> : null}
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#3a1e22]/15 px-4 py-8 text-center text-sm text-[#8d7376]">
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "bg-[#f4eae7] text-[#62494c]",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-red-700",
  };
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

export const fieldClass =
  "h-10 w-full rounded-xl border border-[#3a1e22]/15 bg-white px-3 text-sm outline-none focus:border-[#c9484a] focus:ring-2 focus:ring-[#c9484a]/15";

export const tableClass =
  "w-full min-w-[680px] text-left text-sm [&_th]:border-b [&_th]:border-[#3a1e22]/10 [&_th]:px-3 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-[#8d7376] [&_td]:border-b [&_td]:border-[#3a1e22]/5 [&_td]:px-3 [&_td]:py-3";

