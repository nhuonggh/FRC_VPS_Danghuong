import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Ngưỡng (ms) ghi log truy vấn chậm; đặt SLOW_QUERY_MS=0 để tắt. Mặc định 300ms. */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 300);

function createClient(): PrismaClient {
  const dev = process.env.NODE_ENV === "development";
  const client = new PrismaClient({
    log: [
      ...(SLOW_QUERY_MS > 0 ? [{ emit: "event" as const, level: "query" as const }] : []),
      { emit: "stdout", level: "error" },
      ...(dev ? [{ emit: "stdout" as const, level: "warn" as const }] : []),
    ],
  });
  if (SLOW_QUERY_MS > 0) {
    // Chỉ log thời gian + đoạn đầu câu SQL (không log tham số ⇒ không lộ dữ liệu).
    (client as unknown as { $on(e: "query", cb: (q: { query: string; duration: number }) => void): void }).$on("query", (q) => {
      if (q.duration >= SLOW_QUERY_MS) console.warn(`[slow-query] ${q.duration}ms ${q.query.replace(/\s+/g, " ").slice(0, 200)}`);
    });
  }
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
