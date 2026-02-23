import { DetailsSection } from "@/components/sections/details-section";
import { FaqSection } from "@/components/sections/faq-section";
import { HeroSection } from "@/components/sections/hero-section";
import { HowItWorksSection } from "@/components/sections/how-it-works-section";
import { PurchaseSection } from "@/components/sections/purchase-section";
import { QuotePreviewSection } from "@/components/sections/quote-preview-section";
import { ReviewsSection } from "@/components/sections/reviews-section";
import { SiteFooter } from "@/components/sections/site-footer";
import { TopNav } from "@/components/sections/top-nav";

export default function HomePage() {
  return (
    <>
      <TopNav />
      <main>
        <HeroSection />
        <PurchaseSection />
        <HowItWorksSection />
        <DetailsSection />
        <QuotePreviewSection />
        <ReviewsSection />
        <FaqSection />
      </main>
      <SiteFooter />
    </>
  );
}
