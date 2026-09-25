import type { Prisma, PrismaClient } from "@prisma/client";
import { currentRequestIp } from "@/server/http/request-context";

export interface AuditInput {
  userId: number | null;
  action: string; // vd "order.update"
  entity: string; // vd "SaleOrder"
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Khoá KHÔNG BAO GIỜ được vào audit_log (tên viết thường). audit_log append-only ở DB (D-2) nên
 * bí mật lỡ ghi vào là không xoá được. Ngoài danh sách này còn bắt hậu tố: *token, *secret, *password.
 */
export const AUDIT_SECRET_KEYS: ReadonlySet<string> = new Set([
  "passwordhash", "password", "newpassword", "currentpassword", "temppassword", "temporarypassword",
  "token", "accesstoken", "refreshtoken", "secret", "authsecret",
]);

const SECRET_SUFFIXES = ["token", "secret", "password"];

export function isAuditSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return AUDIT_SECRET_KEYS.has(k) || SECRET_SUFFIXES.some((s) => k.endsWith(s));
}

/** Bỏ khoá bí mật ở mọi tầng (object + mảng), trả bản sao, không mutate đầu vào. */
export function stripAuditSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripAuditSecrets(v)) as unknown as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isAuditSecretKey(k)) continue;
      out[k] = stripAuditSecrets(v);
    }
    return out as T;
  }
  return value;
}

// Decimal/Date đều có toJSON → round-trip JSON chuẩn hoá về giá trị thuần (và cho ra bản sao thuần
// để strip đi qua được mọi tầng), rồi bỏ khoá bí mật.
const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : stripAuditSecrets(JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Ghi nhật ký thao tác — CỬA DUY NHẤT ghi audit_log (append-only ở DB).
 * Truyền `tx` để nằm CÙNG transaction với thao tác nghiệp vụ.
 * before/after được lọc bí mật (mật khẩu, hash, token) ở mọi tầng trước khi ghi.
 * LƯU Ý GĐ0b: before/after vẫn có thể chứa field giá vốn/lãi/giá nhập/giá bán → đường ĐỌC audit
 * (màn Nhật ký, quyền audit.view) PHẢI chạy redactDeep trên beforeJson/afterJson trước khi trả ra client.
 */
export async function writeAudit(
  db: Prisma.TransactionClient | PrismaClient,
  input: AuditInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId == null ? null : String(input.entityId),
      beforeJson: toJson(input.before),
      afterJson: toJson(input.after),
      ip: input.ip ?? currentRequestIp(), // mặc định: IP của request API đang xử lý (apiHandler) — null ngoài request
    },
  });
}
