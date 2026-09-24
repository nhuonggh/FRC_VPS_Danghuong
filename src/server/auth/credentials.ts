import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { BCRYPT_COST, verifyPassword } from "./password";

export type CredentialResult =
  | { ok: true; user: { id: number; fullName: string } }
  | { ok: false; reason: "INVALID" | "LOCKED" };

// Hash giả (cùng cost với hash thật) để LUÔN tốn thời gian băm dù tài khoản không tồn tại
const DUMMY_HASH = bcrypt.hashSync("khong-ai-dung-mat-khau-nay", BCRYPT_COST);

/**
 * `verify` chỉ để test tiêm spy nhằm ghim việc luôn chạy một phép so bcrypt;
 * production dùng mặc định.
 */
export async function verifyCredentials(
  prisma: PrismaClient,
  username: string,
  password: string,
  verify: (plain: string, hash: string) => Promise<boolean> = verifyPassword,
): Promise<CredentialResult> {
  const user = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  const passwordOk = await verify(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return { ok: false, reason: "INVALID" };
  // Chỉ báo LOCKED khi đã đúng mật khẩu → kẻ đoán mật khẩu không biết tài khoản có tồn tại
  if (user.isLocked) return { ok: false, reason: "LOCKED" };
  return { ok: true, user: { id: user.id, fullName: user.fullName } };
}
