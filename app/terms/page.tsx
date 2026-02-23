import { LegalPage } from "@/components/legal-page";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="February 23, 2026">
      <p>
        By purchasing Lumi Necklace, you agree to use the product responsibly
        and follow any provided care instructions.
      </p>
      <p>
        NFC functionality may vary depending on phone model, settings, and
        software version. Lumi cannot guarantee identical behavior across all
        devices.
      </p>
      <p>
        We reserve the right to update product details, pricing, and policies at
        any time. Continued use of the site constitutes acceptance of updates.
      </p>
    </LegalPage>
  );
}
