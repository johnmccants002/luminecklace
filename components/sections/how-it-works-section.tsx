"use client";

import { Smartphone, Sparkles, Zap } from "lucide-react";
import { motion } from "framer-motion";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";

const STEPS = [
  {
    title: "Tap necklace with your phone",
    description: "Hold your phone near the pendant to trigger the NFC interaction.",
    icon: Smartphone,
  },
  {
    title: "App Clip opens instantly",
    description: "A lightweight App Clip launches immediately for a seamless handoff.",
    icon: Zap,
  },
  {
    title: "A message appears (rotates each time)",
    description: "Receive a fresh moment of love, motivation, or calm on every tap.",
    icon: Sparkles,
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative overflow-hidden bg-[#f4e6e3] py-20">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(201,72,74,0.18),transparent_46%),radial-gradient(circle_at_78%_82%,rgba(176,59,78,0.14),transparent_45%)]"
        animate={{ backgroundPosition: ["0% 0%, 100% 100%", "8% -5%, 93% 104%", "0% 0%, 100% 100%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={7} opacity={0.2} className="z-0" />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <p className="text-xs uppercase tracking-[0.2em] text-[#b8956e]">How it works</p>
          <h2 className="mt-3 font-serif text-4xl text-[#2a1214]">
            Intimate technology, beautifully invisible.
          </h2>
        </FadeIn>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <FadeIn
              key={step.title}
              delay={index * 0.08}
              interactive
              className="rounded-3xl border border-[#3a1e22]/10 bg-[#f9f1ef] p-6 shadow-[0_16px_50px_-28px_rgba(15,15,15,0.35)]"
            >
              <motion.div
                animate={{ y: [0, -4, 0], rotate: [0, index % 2 === 0 ? 4 : -4, 0] }}
                transition={{ duration: 2.2 + index * 0.2, repeat: Infinity, ease: "easeInOut" }}
              >
                <step.icon className="h-8 w-8 text-[#c9484a]" />
              </motion.div>
              <p className="mt-4 text-lg text-[#2a1214]">{step.title}</p>
              <p className="mt-3 text-sm text-[#654045]">{step.description}</p>
            </FadeIn>
          ))}
        </div>

        <p className="mt-6 text-sm text-[#6e4a4f]">No app install required to start.</p>
      </div>
    </section>
  );
}
