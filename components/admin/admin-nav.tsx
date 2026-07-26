"use client";

import {
  Activity,
  Boxes,
  FileUp,
  LayoutDashboard,
  PackageCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/necklaces", label: "Necklaces", icon: Boxes },
  { href: "/admin/orders", label: "Orders", icon: PackageCheck },
  { href: "/admin/imports/messages", label: "Content imports", icon: FileUp },
  { href: "/admin/activity", label: "Activity", icon: Activity },
];

export function AdminNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin navigation"
      className={cn(
        mobile
          ? "flex gap-1 overflow-x-auto border-b border-[#3a1e22]/10 bg-white px-3 py-2 lg:hidden"
          : "space-y-1"
      )}
    >
      {items.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              active
                ? "bg-[#2a1214] text-white"
                : "text-[#6f5558] hover:bg-[#f6ece9] hover:text-[#2a1214]"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

