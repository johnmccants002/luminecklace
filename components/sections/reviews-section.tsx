"use client";

import { Star } from "lucide-react";
import { motion } from "framer-motion";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";

const REVIEWS = [
  {
    name: "Nina R.",
    text: "The finish looks way more expensive than $40. I wear it every day.",
  },
  {
    name: "Camille T.",
    text: "I bought it as a gift and the tap message made my friend cry in the best way.",
  },
  {
    name: "Sasha M.",
    text: "Minimal and elegant. The message experience feels thoughtful, not gimmicky.",
  },
  {
    name: "Jordan L.",
    text: "Fast shipping, pretty packaging, and the necklace feels light but solid.",
  },
];

export function ReviewsSection() {
  return (
    <section id="reviews" className="relative mx-auto w-full max-w-6xl overflow-hidden px-4 py-20 sm:px-6 lg:px-8">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_10%,rgba(201,72,74,0.14),transparent_38%)]"
        animate={{ backgroundPosition: ["100% 0%", "92% 7%", "100% 0%"] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={6} opacity={0.18} className="z-0" />
      <FadeIn className="relative z-10">
        <p className="text-xs uppercase tracking-[0.2em] text-[#b8956e]">Reviews</p>
        <div className="mt-3 flex items-center gap-3">
          <h2 className="font-serif text-4xl text-[#2a1214]">Loved by customers</h2>
          <motion.div
            className="inline-flex items-center gap-1 rounded-full border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 py-1 text-sm text-[#2a1214]"
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <Star className="h-4 w-4 fill-[#d7b98f] text-[#d7b98f]" /> 4.9 / 5
          </motion.div>
        </div>
      </FadeIn>

      <div className="relative z-10 mt-10 grid gap-4 md:grid-cols-2">
        {REVIEWS.map((review, index) => (
          <FadeIn
            key={review.name}
            delay={index * 0.08}
            interactive
            className="rounded-3xl border border-[#3a1e22]/10 bg-[#f9f1ef] p-6 shadow-[0_16px_40px_-30px_rgba(15,15,15,0.4)]"
          >
            <div className="mb-3 flex text-[#d7b98f]">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" />
              ))}
            </div>
            <p className="text-sm leading-relaxed text-[#57363a]">{review.text}</p>
            <p className="mt-4 text-sm font-medium text-[#2a1214]">{review.name}</p>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}
