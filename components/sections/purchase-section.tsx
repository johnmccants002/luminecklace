"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";
import { useCart } from "@/components/providers/cart-provider";
import { Button } from "@/components/ui/button";
import { CHECKOUT_URL, PRODUCT } from "@/lib/config";
import { ChainLength, Finish } from "@/lib/types";

const PAYMENT_METHODS = ["Visa", "Mastercard", "Apple Pay"];
const HEART_PARTICLES = [
  { x: -48, y: -24, rotate: -22, scale: 0.78 },
  { x: -26, y: -38, rotate: -8, scale: 0.92 },
  { x: 0, y: -52, rotate: 0, scale: 1.08 },
  { x: 29, y: -37, rotate: 12, scale: 0.9 },
  { x: 49, y: -22, rotate: 23, scale: 0.76 },
  { x: -16, y: -61, rotate: -16, scale: 0.7 },
  { x: 17, y: -63, rotate: 17, scale: 0.68 },
];

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: PRODUCT.currency,
  }).format(value);
}

function HeartBurst({ burstKey }: { burstKey: number }) {
  return (
    <AnimatePresence>
      {burstKey > 0 && (
        <motion.div
          key={burstKey}
          className="pointer-events-none absolute left-1/2 top-1/2"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55 }}
        >
          {HEART_PARTICLES.map((particle, index) => (
            <motion.span
              key={`${burstKey}-${index}`}
              className="absolute text-[#d85b6f]"
              style={{ left: 0, top: 0 }}
              initial={{ x: 0, y: 0, opacity: 0.95, scale: 0.3, rotate: 0 }}
              animate={{
                x: particle.x,
                y: particle.y,
                opacity: 0,
                scale: particle.scale,
                rotate: particle.rotate,
              }}
              transition={{
                duration: 0.6,
                delay: index * 0.02,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <Heart className="h-4 w-4 fill-current" />
            </motion.span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PurchaseSection() {
  const router = useRouter();
  const [activeImage, setActiveImage] = useState(PRODUCT.images[0]);
  const [finish, setFinish] = useState<Finish>(PRODUCT.finishes[0]);
  const [chainLength, setChainLength] = useState<ChainLength>(PRODUCT.chainLengths[0]);
  const [quantity, setQuantity] = useState(1);
  const [addToCartBurst, setAddToCartBurst] = useState(0);
  const [buyNowBurst, setBuyNowBurst] = useState(0);

  const { addItem } = useCart();

  const total = useMemo(() => PRODUCT.price * quantity, [quantity]);

  const handleAddToCart = () => {
    setAddToCartBurst((prev) => prev + 1);
    addItem({ finish, chainLength }, quantity);
    toast.success("Added to cart", {
      description: `${quantity} x ${PRODUCT.name} (${finish}, ${chainLength})`,
    });
  };

  const handleBuyNow = () => {
    setBuyNowBurst((prev) => prev + 1);
    addItem({ finish, chainLength }, quantity);

    if (CHECKOUT_URL) {
      window.location.href = CHECKOUT_URL;
      return;
    }

    router.push("/checkout");
  };

  return (
    <section id="purchase" className="relative mx-auto w-full max-w-6xl overflow-hidden px-4 py-20 sm:px-6 lg:px-8">
      <HeartField hearts={6} opacity={0.14} className="z-0" />
      <FadeIn className="relative z-10 grid gap-8 lg:grid-cols-2 lg:gap-14">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-3xl border border-[#3a1e22]/10 bg-[#f4e6e3]">
            <Image
              src={activeImage.src}
              alt={activeImage.alt}
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {PRODUCT.images.map((image) => (
              <button
                key={image.src}
                type="button"
                onClick={() => setActiveImage(image)}
                className={`relative aspect-square overflow-hidden rounded-2xl border ${
                  activeImage.src === image.src
                    ? "border-[#c9484a]"
                    : "border-[#3a1e22]/10"
                }`}
              >
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 25vw, 15vw"
                />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          <p className="text-xs uppercase tracking-[0.2em] text-[#b8956e]">Lumi Collection</p>
          <h2 className="mt-3 font-serif text-4xl text-[#2a1214]">{PRODUCT.name}</h2>
          <p className="mt-3 text-[#4f3135]">{PRODUCT.description}</p>
          <p className="mt-6 text-3xl text-[#2a1214]">{formatPrice(PRODUCT.price)}</p>

          <ul className="mt-6 space-y-2 text-sm text-[#4f3135]">
            {PRODUCT.benefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#c9484a]" />
                {benefit}
              </li>
            ))}
          </ul>

          <div className="mt-8 space-y-6">
            <div>
              <p className="mb-2 text-sm font-medium text-[#2a1214]">Finish</p>
              <div className="flex gap-2">
                {PRODUCT.finishes.map((option) => (
                  <button
                    key={option}
                    onClick={() => setFinish(option)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      finish === option
                        ? "border-[#2a1214] bg-[#2a1214] text-[#f9f1ef]"
                        : "border-[#3a1e22]/20 text-[#57363a] hover:border-[#2a1214]/50"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[#2a1214]">Chain Length</p>
              <div className="flex gap-2">
                {PRODUCT.chainLengths.map((option) => (
                  <button
                    key={option}
                    onClick={() => setChainLength(option)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      chainLength === option
                        ? "border-[#2a1214] bg-[#2a1214] text-[#f9f1ef]"
                        : "border-[#3a1e22]/20 text-[#57363a] hover:border-[#2a1214]/50"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[#2a1214]">Quantity</p>
              <div className="inline-flex items-center gap-4 rounded-full border border-[#3a1e22]/15 bg-[#f6e9e6] px-4 py-2">
                <button
                  onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
                  aria-label="Decrease quantity"
                >
                  -
                </button>
                <span>{quantity}</span>
                <button
                  onClick={() => setQuantity((prev) => prev + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <motion.div className="relative" whileHover={{ y: -1 }} whileTap={{ scale: 0.99 }}>
              <HeartBurst burstKey={addToCartBurst} />
              <Button className="relative w-full overflow-visible" onClick={handleAddToCart}>
                Add to cart • {formatPrice(total)}
              </Button>
            </motion.div>
            <motion.div className="relative" whileHover={{ y: -1 }} whileTap={{ scale: 0.99 }}>
              <HeartBurst burstKey={buyNowBurst} />
              <Button
                variant="secondary"
                className="relative w-full overflow-visible border-[#b8956e]/35"
                onClick={handleBuyNow}
              >
                Buy now
              </Button>
            </motion.div>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-[#6e4a4f] sm:text-sm">
            <span>Secure payments:</span>
            {PAYMENT_METHODS.map((method, index) => (
              <span key={method}>
                {method}
                {index < PAYMENT_METHODS.length - 1 ? " •" : ""}
              </span>
            ))}
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
