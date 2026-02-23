"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { HeartField } from "@/components/animated/heart-field";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[#3a1e22]/10 bg-[#2a1214] py-10 text-[#f2dedc]">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(201,72,74,0.22),transparent_40%),radial-gradient(circle_at_12%_90%,rgba(201,72,74,0.14),transparent_44%)]"
        animate={{ backgroundPosition: ["100% 0%, 0% 100%", "94% 6%, 6% 94%", "100% 0%, 0% 100%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={8} opacity={0.17} className="z-0" colorClassName="text-[#de7e8e]" />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
        <div>
          <p className="font-serif text-2xl">Lumi</p>
          <p className="mt-2 text-sm text-[#cfaeac]">
            Designed for daily rituals, crafted for modern romance.
          </p>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <Link className="hover:text-white" href="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-white" href="/terms">
            Terms
          </Link>
          <Link className="hover:text-white" href="/returns">
            Returns
          </Link>
        </div>

        <div className="text-sm text-[#cfaeac]">
          <p>Instagram • TikTok • Pinterest</p>
          <p className="mt-2">© {new Date().getFullYear()} Lumi Necklace</p>
        </div>
      </div>
    </footer>
  );
}
