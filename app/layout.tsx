import type { Metadata } from "next";

import { AppToaster } from "@/components/ui/sonner";
import { CartProvider } from "@/components/providers/cart-provider";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | NFC Heart Necklace`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Lumi Necklace is a minimalist NFC heart necklace that reveals beautiful messages with every tap.",
  openGraph: {
    title: `${SITE_NAME} | NFC Heart Necklace`,
    description: SITE_TAGLINE,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/images/hero-lifestyle.svg",
        width: 1200,
        height: 630,
        alt: "Lumi Necklace lifestyle preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | NFC Heart Necklace`,
    description: SITE_TAGLINE,
    images: ["/images/hero-lifestyle.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-[#f9f1ef] font-sans text-[#2a1214] antialiased">
        <CartProvider>
          {children}
          <AppToaster />
        </CartProvider>
      </body>
    </html>
  );
}
