"use client";

import { motion } from "framer-motion";
import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";

const SPECS = [
  { label: "Material", value: "Stainless steel with hypoallergenic finish" },
  { label: "Pendant size", value: "16mm heart pendant" },
  { label: "Chain type", value: "Fine cable chain" },
  { label: "Waterproof", value: "Water-resistant for daily wear" },
  { label: "NFC compatibility", value: "iPhone (App Clip) + most NFC Android phones" },
];

export function DetailsSection() {
  return (
    <section id="details" className="relative mx-auto w-full max-w-6xl overflow-hidden px-4 py-20 sm:px-6 lg:px-8">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_100%,rgba(201,72,74,0.14),transparent_42%)]"
        animate={{ backgroundPosition: ["0% 100%", "6% 93%", "0% 100%"] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={5} opacity={0.16} className="z-0" />
      <FadeIn className="relative z-10">
        <p className="text-xs uppercase tracking-[0.2em] text-[#b8956e]">Details</p>
        <h2 className="mt-3 font-serif text-4xl text-[#2a1214]">Materials & specifications</h2>
      </FadeIn>

      <div className="relative z-10 mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SPECS.map((spec, index) => (
          <FadeIn
            key={spec.label}
            delay={index * 0.05}
            interactive
            className="rounded-3xl border border-[#3a1e22]/10 bg-[#f9f1ef] p-6 shadow-[0_14px_35px_-30px_rgba(15,15,15,0.4)]"
          >
            <p className="text-xs uppercase tracking-[0.14em] text-[#b8956e]">{spec.label}</p>
            <p className="mt-3 text-sm text-[#2a1214]">{spec.value}</p>
          </FadeIn>
        ))}
      </div>

      <p className="mt-8 text-sm text-[#6e4a4f]">
        NFC experience depends on device settings; App Clip requires tapping Open.
      </p>
    </section>
  );
}
