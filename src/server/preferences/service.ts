import type { Prisma, PrismaClient } from "@prisma/client";
import { emptyPrefs, parsePrefs, type Prefs } from "@/lib/workspace";

type Db = Prisma.TransactionClient | PrismaClient;

/** Đọc cấu hình giao diện của tài khoản; chưa có/hỏng ⇒ mặc định. */
export async function getPreferences(db: Db, userId: number): Promise<Prefs> {
  const row = await db.userPreference.findUnique({ where: { userId }, select: { data: true } });
  return row ? parsePrefs(row.data) : emptyPrefs();
}
/** Ghi đè toàn bộ cấu hình (đã qua zod ở route). Chỉ sửa được của CHÍNH MÌNH — userId lấy từ phiên, không từ body. */
export async function savePreferences(db: Db, userId: number, prefs: Prefs): Promise<void> {
  await db.userPreference.upsert({ where: { userId }, create: { userId, data: prefs as Prisma.InputJsonValue }, update: { data: prefs as Prisma.InputJsonValue } });
}
