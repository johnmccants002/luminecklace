"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart } from "lucide-react";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const QUOTES = {
  love: "You are deeply loved, even in the quiet moments.",
  motivation: "Small steps today become your beautiful breakthrough tomorrow.",
  calm: "Breathe in slowly. You are safe, grounded, and enough.",
};

export function QuotePreviewSection() {
  return (
    <section className="relative overflow-hidden bg-[#2a1214] py-20 text-[#f9f1ef]">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(201,72,74,0.25),transparent_42%),radial-gradient(circle_at_84%_76%,rgba(176,59,78,0.18),transparent_44%)]"
        animate={{ backgroundPosition: ["0% 0%, 100% 100%", "7% -5%, 93% 105%", "0% 0%, 100% 100%"] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={8} opacity={0.2} className="z-0" colorClassName="text-[#e38f9f]" />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <p className="text-xs uppercase tracking-[0.2em] text-[#d7b98f]">Message preview</p>
          <h2 className="mt-3 font-serif text-4xl">A moment delivered with every tap</h2>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#f9f1ef]/20 bg-[#3a1b20]/70 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#efc1c7]">
            <motion.span
              animate={{ scale: [1, 1.16, 1], opacity: [0.72, 1, 0.72] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              className="text-[#cf4f62]"
            >
              <Heart className="h-3.5 w-3.5 fill-current" />
            </motion.span>
            Tap to reveal message
          </div>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-10 max-w-2xl">
          <Tabs defaultValue="love" className="w-full">
            <TabsList>
              <TabsTrigger value="love">Love</TabsTrigger>
              <TabsTrigger value="motivation">Motivation</TabsTrigger>
              <TabsTrigger value="calm">Calm</TabsTrigger>
            </TabsList>

            {Object.entries(QUOTES).map(([key, message]) => (
              <TabsContent key={key} value={key}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    className="rounded-3xl border border-[#f9f1ef]/15 bg-[#2a1518] p-8"
                  >
                    <p className="text-sm uppercase tracking-[0.14em] text-[#d7b98f]">{key}</p>
                    <p className="mt-4 text-lg leading-relaxed">“{message}”</p>
                  </motion.div>
                </AnimatePresence>
              </TabsContent>
            ))}
          </Tabs>
        </FadeIn>
      </div>
    </section>
  );
}
