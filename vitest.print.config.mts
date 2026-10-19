import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Read-only print checks: deliberately no database reset or migration hooks.
export default defineConfig({
  plugins: [react()], resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["tests/print/html*.test.ts", "tests/ui/print.test.tsx", "tests/ui/sale-order-form.test.tsx"], setupFiles: ["tests/setup-dom.ts"], testTimeout: 30_000 },
});
