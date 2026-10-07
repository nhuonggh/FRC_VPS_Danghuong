import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createBomVersionSchema } from "@/server/bom/schemas";
import { createBomVersion, setProcessingRatio } from "@/server/bom/service";
import { getBom } from "@/server/bom/queries";
import { prisma, resetDb } from "../helpers/db";
import { makeProcessingType, makeProduct, makeUser } from "../helpers/factories";

let manager: Actor; let seller: Actor; let fg: { id: number }; let pt: { id: number }; let bomId: number;

beforeEach(async () => {
  await resetDb();
  const u = await makeUser();
  manager = { userId: u.id, perms: new Set(["bom.manage", "order.create"]) };
  seller = { userId: u.id, perms: new Set(["order.create"]) };
  fg = await makeProduct({ kind: "THANH_PHAM" }); pt = await makeProcessingType();
  const m1 = await makeProduct({ kind: "NVL" });
  const r = await prisma.$transaction((db) => createBomVersion(db, manager, createBomVersionSchema.parse({ productId: fg.id, processingTypeId: pt.id, validFrom: "2026-09-15", lines: [{ materialProductId: m1.id, qtyPerUnit: 1 }] }), new Date("2026-09-15T03:00:00Z")));
  bomId = r.bomId;
});
const set = (actor: Actor, ratio: number, onlyIfMissing: boolean) => prisma.$transaction((db) => setProcessingRatio(db, actor, { productId: fg.id, processingTypeId: pt.id, ratio, onlyIfMissing }));

describe("setProcessingRatio", () => {
  it("người bán nhập lần đầu → lưu; lần sau giữ nguyên (không ghi đè)", async () => {
    expect((await set(seller, 1.08, true)).saved).toBe(true);
    expect(await set(seller, 1.5, true)).toMatchObject({ saved: false, ratio: "1.08" });
    expect((await getBom(prisma, bomId)).areaRatio).toBe("1.08");
  });
  it("chỉ người có bom.manage sửa được tỷ lệ đã có; có audit", async () => {
    await set(seller, 1.08, true);
    await expect(set(seller, 1.1, false)).rejects.toThrow();
    expect((await set(manager, 1.1, false)).saved).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "product.set_processing_ratio" } })).toBe(2);
  });
  it("từ chối tỷ lệ ≤ 0 hoặc quá 4 số thập phân; SP chưa có định mức vẫn lưu được", async () => {
    await expect(set(manager, 0, false)).rejects.toThrow();
    await expect(set(manager, 1.23456, false)).rejects.toThrow();
    const other = await makeProduct({ kind: "THANH_PHAM" });
    expect((await prisma.$transaction((db) => setProcessingRatio(db, manager, { productId: other.id, processingTypeId: pt.id, ratio: 1.1, onlyIfMissing: false }))).saved).toBe(true);
  });
});
