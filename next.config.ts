import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BẮT BUỘC cho Dockerfile stage runner (.next/standalone). Thiếu → không có server.js.
  output: "standalone",
};

export default nextConfig;
