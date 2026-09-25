import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** DB treo không được làm treo health check (docker/Caddy/giám sát sẽ tự coi là hỏng). */
const DB_TIMEOUT_MS = 3_000;

/**
 * Health check CÔNG KHAI (middleware loại `api/health` khỏi đăng nhập): KHÔNG kiểm quyền, KHÔNG đọc dữ liệu.
 * Chỉ `SELECT 1`. Trả đúng 3 khoá {status, db, time}; lỗi chỉ ghi vào log máy chủ, tuyệt đối không đưa vào response.
 */
export async function GET() {
  const time = new Date().toISOString();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ status: "ok", db: true, time }, { headers: NO_STORE });
  } catch (err) {
    console.error("[health] kiểm tra DB thất bại:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ status: "error", db: false, time }, { status: 503, headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
