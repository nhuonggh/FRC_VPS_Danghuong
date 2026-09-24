"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmHost } from "@/components/ui/ConfirmDialog";
import { ToastHost } from "@/components/ui/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <ToastHost />
      <ConfirmHost />
    </QueryClientProvider>
  );
}
