"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { apiFetch } from "@/lib/api-fetch";
import { toastApiError } from "@/lib/api-error-toast";
import type { Prefs } from "@/lib/workspace";

interface WorkspaceState { prefs: Prefs; update: (fn: (p: Prefs) => Prefs) => void }
const SAVE_DELAY_MS = 500;

/** Store theo TỪNG lần render (không singleton ở module): SSR dùng chung process cho mọi người dùng nên singleton sẽ lộ cấu hình người này sang người khác. */
function makeStore(initial: Prefs): StoreApi<WorkspaceState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const store = createStore<WorkspaceState>((set, get) => ({
    prefs: initial,
    update: (fn) => {
      const next = fn(get().prefs);
      if (next === get().prefs) return;
      set({ prefs: next });
      clearTimeout(timer);
      timer = setTimeout(() => { apiFetch("/api/account/preferences", { method: "PUT", json: get().prefs }).catch((e) => toastApiError(e)); }, SAVE_DELAY_MS);
    },
  }));
  return store;
}

const Ctx = createContext<StoreApi<WorkspaceState> | null>(null);
export function WorkspaceProvider({ prefs, children }: { prefs: Prefs; children: ReactNode }) {
  const ref = useRef<StoreApi<WorkspaceState> | null>(null);
  if (!ref.current) ref.current = makeStore(prefs);
  return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
}
export function useWorkspace<T>(selector: (s: WorkspaceState) => T): T {
  const store = useContext(Ctx);
  if (!store) throw new Error("useWorkspace phải nằm trong <WorkspaceProvider>.");
  return useStore(store, selector);
}
