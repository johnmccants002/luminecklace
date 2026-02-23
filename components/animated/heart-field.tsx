"use client";

import { Heart } from "lucide-react";
import { motion } from "framer-motion";

type HeartFieldProps = {
  hearts?: number;
  className?: string;
  colorClassName?: string;
  opacity?: number;
};

const HEART_LAYOUT = [
  { left: "6%", top: "14%", size: 11, drift: 11, delay: 0.2, duration: 7.4 },
  { left: "14%", top: "68%", size: 14, drift: 12, delay: 0.8, duration: 8.2 },
  { left: "28%", top: "26%", size: 9, drift: 10, delay: 0.4, duration: 7.7 },
  { left: "41%", top: "80%", size: 12, drift: 14, delay: 1.1, duration: 8.6 },
  { left: "56%", top: "18%", size: 15, drift: 13, delay: 1.6, duration: 8.1 },
  { left: "69%", top: "74%", size: 10, drift: 12, delay: 0.5, duration: 7.9 },
  { left: "83%", top: "23%", size: 13, drift: 13, delay: 1.3, duration: 8.4 },
  { left: "92%", top: "59%", size: 8, drift: 9, delay: 0.9, duration: 7.2 },
  { left: "36%", top: "8%", size: 10, drift: 10, delay: 2, duration: 8.9 },
  { left: "73%", top: "8%", size: 9, drift: 10, delay: 1.7, duration: 8.5 },
];

export function HeartField({
  hearts = 6,
  className,
  colorClassName = "text-[#df8997]",
  opacity = 0.24,
}: HeartFieldProps) {
  const active = HEART_LAYOUT.slice(0, Math.max(1, Math.min(hearts, HEART_LAYOUT.length)));

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}>
      {active.map((heart, index) => (
        <motion.div
          key={`${heart.left}-${heart.top}-${index}`}
          className={`absolute ${colorClassName}`}
          style={{ left: heart.left, top: heart.top, opacity }}
          initial={{ y: 0, scale: 0.92, rotate: -4 }}
          animate={{
            y: [0, -heart.drift, -2],
            x: [0, index % 2 === 0 ? 4 : -4, 0],
            scale: [0.92, 1.06, 0.94],
            rotate: [-4, 4, -2],
            opacity: [opacity * 0.8, opacity * 1.25, opacity * 0.85],
          }}
          transition={{
            duration: heart.duration,
            delay: heart.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Heart size={heart.size} fill="currentColor" />
        </motion.div>
      ))}
    </div>
  );
}
