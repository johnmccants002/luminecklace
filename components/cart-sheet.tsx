"use client";

import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, Trash2 } from "lucide-react";

import { useCart } from "@/components/providers/cart-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function CartSheet() {
  const { items, itemCount, subtotal, removeItem, updateQuantity } = useCart();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open cart">
          <ShoppingBag className="h-4 w-4" />
          {itemCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#2a1214] text-[10px] text-[#f9f1ef]">
              {itemCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription>
            Curated essentials, ready for checkout.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-[#3a1e22]/10 bg-[#fff8f7]/85 p-5 text-sm text-[#6b5558]">
              Your cart is empty. Add Lumi Necklace to continue.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-[#3a1e22]/10 bg-[#fff8f7] p-4"
              >
                <div className="flex gap-3">
                  <Image
                    src={item.image}
                    alt={item.name}
                    width={76}
                    height={76}
                    className="rounded-xl border border-[#3a1e22]/10 object-cover"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#2a1214]">{item.name}</p>
                    <p className="mt-1 text-xs text-[#654045]">
                      {item.variants.finish} • {item.variants.chainLength}
                    </p>
                    <p className="mt-2 text-sm text-[#2a1214]">
                      {formatPrice(item.price)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="inline-flex items-center gap-3 rounded-full border border-[#3a1e22]/10 bg-[#f9f1ef] px-3 py-1.5">
                    <button
                      aria-label="Decrease quantity"
                      className="text-sm"
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    >
                      -
                    </button>
                    <span className="text-sm">{item.quantity}</span>
                    <button
                      aria-label="Increase quantity"
                      className="text-sm"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="inline-flex items-center gap-1 text-xs text-[#6e4a4f] hover:text-[#2a1214]"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <SheetFooter className="border-t border-[#3a1e22]/10 pt-4">
          <div className="flex items-center justify-between text-sm text-[#4a2b2f]">
            <span>Subtotal</span>
            <span className="font-medium text-[#2a1214]">{formatPrice(subtotal)}</span>
          </div>
          <Button asChild disabled={items.length === 0}>
            <Link href="/checkout">Checkout</Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
