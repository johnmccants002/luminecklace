"use client";

import { motion } from "framer-motion";

export function FadeIn({
  children,
  delay = 0,
  y = 20,
  interactive = false,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={interactive ? { y: -4, scale: 1.01 } : undefined}
      whileTap={interactive ? { scale: 0.995 } : undefined}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
