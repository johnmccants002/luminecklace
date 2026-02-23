"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { motion } from "framer-motion";

import { CartSheet } from "@/components/cart-sheet";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Details", href: "#details" },
  { label: "Reviews", href: "#reviews" },
  { label: "FAQ", href: "#faq" },
];

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#3a1e22]/10 bg-[#f9f1ef]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Link href="/" className="inline-flex items-center gap-2 font-serif text-2xl tracking-wide text-[#2a1214]">
            Lumi
            <motion.span
              className="text-[#c9484a]"
              animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Heart className="h-4 w-4 fill-current" />
            </motion.span>
          </Link>
        </motion.div>

        <div className="hidden items-center gap-8 md:flex">
          <nav aria-label="Main navigation" className="flex items-center gap-6">
            {NAV_ITEMS.map((item) => (
              <motion.a
                key={item.href}
                href={item.href}
                className="text-sm text-[#4f3135] transition hover:text-[#2a1214]"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
              >
                {item.label}
              </motion.a>
            ))}
          </nav>

          <a href="#purchase">
            <Button size="sm">Buy Now</Button>
          </a>

          <CartSheet />
        </div>

        <div className="flex items-center gap-3 md:hidden">
          <a href="#purchase">
            <Button size="sm">Buy Now</Button>
          </a>
          <CartSheet />
        </div>
      </div>
    </header>
  );
}
