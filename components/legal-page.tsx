import Link from "next/link";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f9f1ef] px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/" className="text-sm text-[#6e4a4f] hover:text-[#2a1214]">
          ← Back to Lumi
        </Link>
        <h1 className="mt-4 font-serif text-4xl text-[#2a1214]">{title}</h1>
        <p className="mt-2 text-sm text-[#7a5f63]">Last updated: {updated}</p>
        <div className="prose prose-neutral mt-8 max-w-none prose-p:text-[#573d41] prose-strong:text-[#2a1214]">
          {children}
        </div>
      </div>
    </main>
  );
}
