"use client";

import { create } from "zustand";
import { useEffect } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";

type Variant = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  variant: Variant;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (message: string, variant: Variant) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, variant) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id: Math.random().toString(36).slice(2), message, variant },
      ],
    })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "error"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
};

const ICONS = {
  success: <CheckCircle2 className="h-5 w-5 text-[var(--up)]" />,
  error: <XCircle className="h-5 w-5 text-[var(--down)]" />,
  info: <Info className="h-5 w-5 text-[var(--accent)]" />,
};

function ToastRow({ item }: { item: ToastItem }) {
  const remove = useToastStore((s) => s.remove);
  useEffect(() => {
    const t = setTimeout(() => remove(item.id), 3200);
    return () => clearTimeout(t);
  }, [item.id, remove]);

  return (
    <div className="animate-fade-in flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-lg shadow-black/5 w-[320px]">
      <div className="mt-0.5">{ICONS[item.variant]}</div>
      <p className="text-sm text-[var(--foreground)] leading-snug">
        {item.message}
      </p>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </div>
  );
}
