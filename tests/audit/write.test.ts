import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_SECRET_KEYS, stripAuditSecrets, writeAudit } from "@/server/audit/write";
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

describe("writeAudit: không bao giờ ghi bí mật vào nhật ký (append-only, không xoá được)", () => {
  it("danh sách cấm gồm các khoá bắt buộc", () => {
    for (const k of [
      "passwordHash", "password", "newPassword", "currentPassword", "tempPassword",
      "temporaryPassword", "token", "accessToken", "refreshToken", "secret", "authSecret",
    ]) {
      expect(AUDIT_SECRET_KEYS.has(k.toLowerCase()), k).toBe(true);
    }
  });

  it("cả dòng user ({...user}) ghi vào audit không kéo theo passwordHash; field thường còn nguyên", async () => {
    const user = { id: 3, username: "nam", status: "ACTIVE", passwordHash: "$2a$10$abc", fullName: "Nam" };
    await writeAudit(prisma, { userId: 1, action: "user.create", entity: "User", entityId: 3, before: user, after: { ...user } });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.afterJson).toEqual({ id: 3, username: "nam", status: "ACTIVE", fullName: "Nam" });
    expect(row.beforeJson).toEqual({ id: 3, username: "nam", status: "ACTIVE", fullName: "Nam" });
    expect(JSON.stringify(row)).not.toContain("$2a$10$abc");
  });

  it("bỏ khoá bí mật ở mọi tầng: object lồng, mảng object, mảng trong mảng", () => {
    const out = stripAuditSecrets({
      user: { username: "a", credentials: { password: "p1", nested: [{ tempPassword: "p2", ok: 1 }] } },
      list: [{ id: 1, refreshToken: "r" }, [{ secret: "s", id: 2 }]],
    });
    expect(out).toEqual({
      user: { username: "a", credentials: { nested: [{ ok: 1 }] } },
      list: [{ id: 1 }, [{ id: 2 }]],
    });
  });

  it("không phân biệt hoa/thường và bắt hậu tố Token/Secret/Password", () => {
    const out = stripAuditSecrets({
      PasswordHash: "1", PASSWORD: "2", AccessToken: "3", csrfToken: "4", apiSecret: "5",
      oldPassword: "6", authsecret: "7", username: "u", status: "OPEN",
    });
    expect(out).toEqual({ username: "u", status: "OPEN" });
  });

  it("không mutate đối tượng của người gọi", () => {
    const input = { passwordHash: "h", list: [{ token: "t", id: 1 }], username: "u" };
    const snapshot = JSON.parse(JSON.stringify(input));
    stripAuditSecrets(input);
    expect(input).toEqual(snapshot);
  });

  it("giá trị nguyên thuỷ/null/undefined đi qua an toàn", () => {
    expect(stripAuditSecrets(null)).toBeNull();
    expect(stripAuditSecrets(undefined)).toBeUndefined();
    expect(stripAuditSecrets(5)).toBe(5);
    expect(stripAuditSecrets("x")).toBe("x");
  });

  it("khoá bí mật ở tầng sâu của before/after đều bị bỏ khi ghi DB (kể cả Decimal/Date cùng lúc)", async () => {
    await writeAudit(prisma, {
      userId: 1, action: "x", entity: "E",
      after: { items: [{ total: new Prisma.Decimal("5"), authSecret: "s", at: new Date("2026-09-24T00:00:00Z") }] },
    });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.afterJson).toEqual({ items: [{ total: "5", at: "2026-09-24T00:00:00.000Z" }] });
  });
});
