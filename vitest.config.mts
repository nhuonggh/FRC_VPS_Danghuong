import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true }, // alias "@/..." theo tsconfig (Vite 8 có sẵn)
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    fileParallelism: false, // các file test dùng chung 1 DB thật
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
