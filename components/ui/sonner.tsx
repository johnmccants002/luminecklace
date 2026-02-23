"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      richColors
      toastOptions={{
        style: {
          borderRadius: "14px",
          background: "#2a1214",
          color: "#f9f1ef",
          border: "1px solid #4a2b2f",
        },
      }}
    />
  );
}
