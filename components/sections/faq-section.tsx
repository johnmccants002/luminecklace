"use client";

import { motion } from "framer-motion";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    question: "Does it need an app?",
    answer:
      "No installation is required to start. iPhone opens an App Clip, and Android devices open a lightweight web experience when NFC is enabled.",
  },
  {
    question: "Does it work on Android?",
    answer:
      "Yes. Most modern Android phones with NFC enabled can tap and launch the message experience.",
  },
  {
    question: "Can I change the message category?",
    answer:
      "Yes. You can switch between Love, Motivation, and Calm styles for your message stream.",
  },
  {
    question: "What if the tag stops working?",
    answer:
      "Reach out and we will troubleshoot device settings first, then replace defective units under warranty.",
  },
  {
    question: "Shipping & returns",
    answer:
      "Orders ship within 1-2 business days. You can return your item in original condition within 30 days.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="relative overflow-hidden bg-[#f4e6e3] py-20">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_75%,rgba(201,72,74,0.16),transparent_45%)]"
        animate={{ backgroundPosition: ["0% 100%", "7% 92%", "0% 100%"] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={7} opacity={0.19} className="z-0" />
      <div className="relative z-10 mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <p className="text-xs uppercase tracking-[0.2em] text-[#b8956e]">FAQ</p>
          <h2 className="mt-3 font-serif text-4xl text-[#2a1214]">Answers before checkout</h2>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-8 rounded-3xl border border-[#3a1e22]/10 bg-[#f9f1ef] px-6 py-2">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, index) => (
              <AccordionItem key={faq.question} value={`item-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </FadeIn>
      </div>
    </section>
  );
}
