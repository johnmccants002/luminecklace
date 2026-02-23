"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { ArrowLeft, Lock, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { FadeIn } from "@/components/animated/fade-in";
import { HeartField } from "@/components/animated/heart-field";
import { useCart } from "@/components/providers/cart-provider";
import { Button } from "@/components/ui/button";

const SHIPPING_FEE = 0;

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function CheckoutPage() {
  const { items, subtotal, updateQuantity, removeItem } = useCart();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = useMemo(() => subtotal + SHIPPING_FEE, [subtotal]);

  const handlePlaceOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (items.length === 0) {
      toast.error("Your cart is empty.");
      return;
    }

    if (
      !email ||
      !fullName ||
      !address ||
      !city ||
      !postalCode ||
      !cardName ||
      !cardNumber ||
      !expiry ||
      !cvc
    ) {
      toast.error("Please complete all required fields.");
      return;
    }

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setIsSubmitting(false);

    toast.success("Order placed", {
      description: "Your Lumi order is confirmed. A receipt will be sent by email.",
    });
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-12 sm:px-6 lg:px-8">
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_10%,rgba(201,72,74,0.14),transparent_36%),radial-gradient(circle_at_88%_84%,rgba(176,59,78,0.1),transparent_40%)]"
        animate={{ backgroundPosition: ["0% 0%, 100% 100%", "7% -5%, 93% 104%", "0% 0%, 100% 100%"] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <HeartField hearts={8} opacity={0.16} className="z-0" />
      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <FadeIn>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[#6e4a4f] transition hover:text-[#2a1214]"
          >
            <ArrowLeft className="h-4 w-4" />
            Continue shopping
          </Link>
          <h1 className="mt-4 font-serif text-4xl text-[#2a1214]">Checkout</h1>
          <p className="mt-2 text-sm text-[#6e4a4f]">
            Secure checkout with elegant essentials, powered by Lumi.
          </p>
        </FadeIn>

        <div className="mt-10 grid gap-7 lg:grid-cols-[1.3fr_0.8fr]">
          <FadeIn
            delay={0.05}
            className="rounded-3xl border border-[#3a1e22]/10 bg-[#fff8f7] p-5 sm:p-7"
          >
            <form className="space-y-8" onSubmit={handlePlaceOrder}>
              <section>
                <h2 className="text-lg font-medium text-[#2a1214]">Contact</h2>
                <div className="mt-3">
                  <label className="text-sm text-[#57363a]" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                    placeholder="you@example.com"
                  />
                </div>
              </section>

              <section>
                <h2 className="text-lg font-medium text-[#2a1214]">Shipping</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="text-sm text-[#57363a]" htmlFor="name">
                      Full name
                    </label>
                    <input
                      id="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="Avery Morgan"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-sm text-[#57363a]" htmlFor="address">
                      Address
                    </label>
                    <input
                      id="address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="123 Rose Street"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-[#57363a]" htmlFor="city">
                      City
                    </label>
                    <input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="San Francisco"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-[#57363a]" htmlFor="postalCode">
                      ZIP code
                    </label>
                    <input
                      id="postalCode"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="94107"
                    />
                  </div>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium text-[#2a1214]">Payment</h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#3a1e22]/15 bg-[#f9f1ef] px-2.5 py-1 text-xs text-[#6e4a4f]">
                    <Lock className="h-3 w-3" />
                    Encrypted
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="text-sm text-[#57363a]" htmlFor="cardName">
                      Name on card
                    </label>
                    <input
                      id="cardName"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="Avery Morgan"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-sm text-[#57363a]" htmlFor="cardNumber">
                      Card number
                    </label>
                    <input
                      id="cardNumber"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="4242 4242 4242 4242"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-[#57363a]" htmlFor="expiry">
                      Expiry
                    </label>
                    <input
                      id="expiry"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="MM/YY"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-[#57363a]" htmlFor="cvc">
                      CVC
                    </label>
                    <input
                      id="cvc"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-[#3a1e22]/15 bg-[#f9f1ef] px-3 text-sm outline-none transition focus:border-[#c9484a]/55"
                      placeholder="123"
                    />
                  </div>
                </div>
              </section>

              <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.995 }}>
                <Button className="w-full" type="submit" disabled={isSubmitting || items.length === 0}>
                  {isSubmitting ? "Processing..." : `Place order • ${formatPrice(total)}`}
                </Button>
              </motion.div>
            </form>
          </FadeIn>

          <FadeIn
            delay={0.1}
            className="h-fit rounded-3xl border border-[#3a1e22]/10 bg-[#fff8f7] p-5 sm:p-6"
          >
            <h2 className="text-lg font-medium text-[#2a1214]">Order summary</h2>

            <div className="mt-5 space-y-3">
              {items.length === 0 ? (
                <p className="rounded-2xl border border-[#3a1e22]/10 bg-[#f9f1ef] p-4 text-sm text-[#6e4a4f]">
                  Your cart is empty.
                </p>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[#3a1e22]/10 bg-[#f9f1ef] p-4"
                  >
                    <div className="flex gap-3">
                      <Image
                        src={item.image}
                        alt={item.name}
                        width={72}
                        height={72}
                        className="rounded-xl border border-[#3a1e22]/10 object-cover"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#2a1214]">{item.name}</p>
                        <p className="mt-1 text-xs text-[#654045]">
                          {item.variants.finish} • {item.variants.chainLength}
                        </p>
                        <p className="mt-2 text-sm text-[#2a1214]">{formatPrice(item.price)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="inline-flex items-center gap-3 rounded-full border border-[#3a1e22]/10 bg-[#fff8f7] px-3 py-1.5">
                        <button
                          aria-label="Decrease quantity"
                          className="text-sm"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          type="button"
                        >
                          -
                        </button>
                        <span className="text-sm">{item.quantity}</span>
                        <button
                          aria-label="Increase quantity"
                          className="text-sm"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          type="button"
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="inline-flex items-center gap-1 text-xs text-[#6e4a4f] hover:text-[#2a1214]"
                        onClick={() => removeItem(item.id)}
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 space-y-2 border-t border-[#3a1e22]/10 pt-4 text-sm">
              <div className="flex items-center justify-between text-[#6e4a4f]">
                <span>Subtotal</span>
                <span className="text-[#2a1214]">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-[#6e4a4f]">
                <span>Shipping</span>
                <span className="text-[#2a1214]">{SHIPPING_FEE === 0 ? "Free" : formatPrice(SHIPPING_FEE)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 text-base font-medium text-[#2a1214]">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </main>
  );
}
