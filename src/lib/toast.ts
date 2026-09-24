import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";
export interface ToastAction { label: string; onClick: () => void }
export interface ToastItem { id: number; kind: ToastKind; message: string; action?: ToastAction }

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

const make = (kind: ToastKind) => (message: string, action?: ToastAction) =>
  useToastStore.getState().push({ kind, message, action });

export const toast = {
  success: make("success"),
  error: make("error"),
  info: make("info"),
  warning: make("warning"),
};
