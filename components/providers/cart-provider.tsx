"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { CartItem, VariantOptions } from "@/lib/types";
import { PRODUCT } from "@/lib/config";

type CartContextType = {
  items: CartItem[];
  addItem: (options: VariantOptions, quantity: number) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  itemCount: number;
  subtotal: number;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

function createItemId(options: VariantOptions) {
  return `${PRODUCT.id}-${options.finish}-${options.chainLength}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = (options: VariantOptions, quantity: number) => {
    setItems((prev) => {
      const itemId = createItemId(options);
      const existing = prev.find((item) => item.id === itemId);

      if (existing) {
        return prev.map((item) =>
          item.id === itemId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }

      return [
        ...prev,
        {
          id: itemId,
          productId: PRODUCT.id,
          name: PRODUCT.name,
          quantity,
          price: PRODUCT.price,
          image: PRODUCT.images[0].src,
          variants: options,
        },
      ];
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity < 1) {
      removeItem(id);
      return;
    }
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    );
  };

  const { itemCount, subtotal } = useMemo(() => {
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    return { itemCount: count, subtotal: total };
  }, [items]);

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQuantity, itemCount, subtotal }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
