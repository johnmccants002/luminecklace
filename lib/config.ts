import { Product } from "@/lib/types";

export const SITE_NAME = "Lumi Necklace";
export const SITE_TAGLINE = "A heart necklace that speaks when you tap.";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://luminecklace.com";
export const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "";

export const PRODUCT: Product = {
  id: "lumi-necklace",
  name: "Lumi Necklace",
  price: 40,
  currency: "USD",
  description:
    "A minimal heart pendant with NFC that reveals a message when tapped with your phone.",
  benefits: [
    "Minimal heart pendant",
    "NFC-enabled message experience",
    "Gift-ready packaging",
  ],
  finishes: ["Gold", "Silver"],
  chainLengths: ["16\"", "18\""],
  images: [
    { src: "/images/product-1.svg", alt: "Lumi necklace front view" },
    { src: "/images/product-2.svg", alt: "Lumi necklace on cream backdrop" },
    { src: "/images/product-3.svg", alt: "Lumi necklace pendant close-up" },
    { src: "/images/product-4.svg", alt: "Lumi necklace gift box and chain" },
  ],
};

export const TRUST_ITEMS = [
  "Free shipping over $50",
  "30-day returns",
  "Secure checkout",
];
