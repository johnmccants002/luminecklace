import Link from "next/link";

export default function InvitationErrorPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-16">
      <section className="w-full rounded-3xl border border-[#2a1214]/10 bg-white p-8 text-center shadow-sm">
        <h1 className="text-3xl font-semibold text-[#2a1214]">
          This setup link is no longer valid
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#2a1214]/70">
          Request a fresh invitation using the email address from your Lumi
          purchase, or contact support if you still cannot access your account.
        </p>
        <Link
          className="mt-8 inline-flex rounded-xl bg-[#2a1214] px-5 py-3 font-semibold text-white"
          href="/"
        >
          Return home
        </Link>
      </section>
    </main>
  );
}
