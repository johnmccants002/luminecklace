import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { AdminAuthError, requireAdmin } from "@/lib/admin/auth";

export default async function SecureAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthError && error.status === 401) {
      redirect("/admin/sign-in?next=/admin");
    }
    if (error instanceof AdminAuthError && error.status === 403) {
      return (
        <main className="grid min-h-screen place-items-center px-5">
          <div className="max-w-lg rounded-3xl border bg-white p-10 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#c9484a]">403 forbidden</p>
            <h1 className="mt-3 font-serif text-3xl">Administrator access required</h1>
            <p className="mt-3 text-sm text-[#765d60]">
              This account is authenticated but has not been granted a Lumi admin role.
            </p>
            <div className="mt-6"><SignOutButton /></div>
          </div>
        </main>
      );
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-[#fbf7f5]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-[#3a1e22]/10 bg-white p-5 lg:flex lg:flex-col">
        <div className="border-b border-[#3a1e22]/10 px-2 pb-5">
          <p className="font-serif text-2xl">Lumi</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#c9484a]">Operations</p>
        </div>
        <div className="mt-5 flex-1"><AdminNav /></div>
        <div className="border-t border-[#3a1e22]/10 px-2 pt-4">
          <p className="truncate text-sm font-medium">{admin.user.email}</p>
          <p className="mb-3 mt-0.5 text-xs text-[#8d7376]">{admin.role.replace("_", " ")}</p>
          <SignOutButton />
        </div>
      </aside>
      <div className="lg:pl-64">
        <div className="flex items-center justify-between border-b border-[#3a1e22]/10 bg-white px-4 py-3 lg:hidden">
          <div><span className="font-serif text-xl">Lumi</span> <span className="text-xs text-[#c9484a]">ADMIN</span></div>
          <SignOutButton />
        </div>
        <AdminNav mobile />
        <main className="mx-auto max-w-[1500px] p-4 sm:p-7 lg:p-10">{children}</main>
      </div>
    </div>
  );
}

