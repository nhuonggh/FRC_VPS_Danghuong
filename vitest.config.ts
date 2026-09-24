import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    fileParallelism: false, // các file test dùng chung 1 DB thật
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
