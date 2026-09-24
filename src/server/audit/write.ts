import type { Prisma, PrismaClient } from "@prisma/client";

export interface AuditInput {
  userId: number | null;
  action: string; // vd "order.update"
  entity: string; // vd "SaleOrder"
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

// Decimal/Date đều có toJSON → round-trip JSON chuẩn hoá về giá trị thuần.
const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Ghi nhật ký thao tác — CỬA DUY NHẤT ghi audit_log (append-only ở DB).
 * Truyền `tx` để nằm CÙNG transaction với thao tác nghiệp vụ.
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
      ip: input.ip ?? null,
    },
  });
}
