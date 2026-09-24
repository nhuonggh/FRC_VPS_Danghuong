import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()], // JSX automatic runtime (tsconfig của Next đặt jsx: preserve)
  resolve: { tsconfigPaths: true }, // alias "@/..." theo tsconfig (Vite 8 có sẵn)
  test: {
    environment: "node", // test UI đặt `// @vitest-environment jsdom` ở đầu file
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts", "tests/setup-dom.ts"],
    fileParallelism: false, // các file test dùng chung 1 DB thật
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
