import type { PrismaClient } from "@prisma/client";
import { normalizeUsername } from "./normalize";
import { hashPassword, verifyPassword } from "./password";

export type CredentialResult =
  | { ok: true; user: { id: number; fullName: string } }
  | { ok: false; reason: "INVALID" | "LOCKED" };

// Hash giả (cùng cost với hash thật) để LUÔN tốn thời gian băm dù tài khoản không tồn tại.
// Tính lười + nhớ lại (không băm đồng bộ lúc import làm chậm khởi động/cold start).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("khong-ai-dung-mat-khau-nay"));

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
  const user = await prisma.user.findUnique({ where: { username: normalizeUsername(username) } });
  const passwordOk = await verify(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !passwordOk) return { ok: false, reason: "INVALID" };
  // Chỉ báo LOCKED khi đã đúng mật khẩu → kẻ đoán mật khẩu không biết tài khoản có tồn tại
  if (user.isLocked) return { ok: false, reason: "LOCKED" };
  return { ok: true, user: { id: user.id, fullName: user.fullName } };
}
