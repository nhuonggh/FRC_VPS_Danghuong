import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { writeAudit } from "@/server/audit/write";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

describe("writeAudit", () => {
  it("ghi số cũ/số mới, chuẩn hoá Decimal và Date về JSON", async () => {
    await writeAudit(prisma, {
      userId: 7, action: "order.update", entity: "SaleOrder", entityId: 12,
      before: { total: new Prisma.Decimal("100.5"), at: new Date("2026-09-24T01:00:00Z") },
      after: { total: new Prisma.Decimal("200") },
    });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.userId).toBe(7);
    expect(row.entityId).toBe("12");
    expect(row.beforeJson).toEqual({ total: "100.5", at: "2026-09-24T01:00:00.000Z" });
    expect(row.afterJson).toEqual({ total: "200" });
  });

  it("nằm trong transaction: rollback thì không còn dòng audit", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await writeAudit(tx, { userId: 1, action: "x", entity: "E" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("userId null, không before/after/ip → ghi được với các cột rỗng", async () => {
    await writeAudit(prisma, { userId: null, action: "system.seed", entity: "System" });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.userId).toBeNull();
    expect(row.entityId).toBeNull();
    expect(row.beforeJson).toBeNull();
    expect(row.afterJson).toBeNull();
    expect(row.ip).toBeNull();
  });

  it("audit_log append-only ở mức DB: app_rw không sửa/xoá được dòng đã ghi", async () => {
    await writeAudit(prisma, { userId: 1, action: "x", entity: "E" });
    await expect(prisma.auditLog.updateMany({ data: { action: "sửa" } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow();
    expect(await prisma.auditLog.count()).toBe(1);
  });
});
