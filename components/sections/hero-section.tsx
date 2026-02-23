"use client";

import { useRef } from "react";
import Image from "next/image";
import { Heart } from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";
import { TRUST_ITEMS } from "@/lib/config";

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const imageY = useTransform(scrollYProgress, [0, 1], [0, 44]);
  const imageScale = useTransform(scrollYProgress, [0, 1], [1.04, 1.12]);

  const floatingHearts = [
    { left: "8%", top: "20%", size: 20, delay: 0.2, duration: 7.4 },
    { left: "18%", top: "62%", size: 14, delay: 1.1, duration: 8.2 },
    { left: "71%", top: "26%", size: 18, delay: 0.7, duration: 7.8 },
    { left: "84%", top: "56%", size: 13, delay: 1.6, duration: 8.4 },
    { left: "57%", top: "14%", size: 11, delay: 2, duration: 9.1 },
  ];

  return (
    <section ref={sectionRef} className="relative isolate overflow-hidden">
      <motion.div className="absolute inset-0" style={{ y: imageY, scale: imageScale }}>
        <Image
          src="/images/hero-lifestyle.svg"
          alt="Lifestyle image of a woman wearing the Lumi Necklace"
          fill
          priority
          className="object-cover"
        />
      </motion.div>
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(201,72,74,0.32),transparent_42%),radial-gradient(circle_at_80%_70%,rgba(176,59,78,0.26),transparent_45%)]"
        animate={{ backgroundPosition: ["0% 0%, 100% 100%", "8% -4%, 94% 104%", "0% 0%, 100% 100%"] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,8,10,0.36),rgba(30,10,13,0.68))]" />
      <HeartField hearts={10} opacity={0.17} className="z-0" colorClassName="text-[#e8afbb]" />
      <div className="pointer-events-none absolute inset-0">
        {floatingHearts.map((heart) => (
          <motion.div
            key={`${heart.left}-${heart.top}`}
            className="absolute text-[#e7b9bf]"
            style={{ left: heart.left, top: heart.top, opacity: 0.2 }}
            initial={{ y: 0, scale: 0.94 }}
            animate={{ y: [-5, -17, -6], scale: [0.94, 1.05, 0.96], opacity: [0.16, 0.25, 0.16] }}
            transition={{
              duration: heart.duration,
              delay: heart.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Heart fill="currentColor" size={heart.size} />
          </motion.div>
        ))}
      </div>

      <div className="relative mx-auto flex min-h-[86vh] w-full max-w-6xl items-end px-4 pb-20 pt-24 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl text-[#f9f1ef]">
          <p className="mb-4 text-xs uppercase tracking-[0.2em] text-[#d8bd93]">
            NFC-enabled necklace
          </p>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl lg:text-6xl">
            A heart necklace that speaks when you tap.
          </h1>
          <p className="mt-6 max-w-xl text-base text-[#f0d9d6] sm:text-lg">
            Tap with your phone to receive a message - love, motivation, or calm.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <motion.a
              href="#purchase"
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#f9f1ef] px-6 text-sm font-medium text-[#2a1214] transition hover:bg-white"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Buy Now
            </motion.a>
            <motion.a
              href="#how-it-works"
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#f9f1ef]/55 px-6 text-sm text-[#f9f1ef] transition hover:bg-[#f9f1ef]/10"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              How it works
            </motion.a>
          </div>

          <div className="mt-8 flex flex-wrap gap-2 text-xs text-[#f3dddd] sm:gap-3 sm:text-sm">
            {TRUST_ITEMS.map((item, index) => (
              <span key={item}>
                {item}
                {index < TRUST_ITEMS.length - 1 ? " •" : ""}
              </span>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
