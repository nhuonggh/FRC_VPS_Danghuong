import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createBomVersionSchema } from "@/server/bom/schemas";
import { parseListParams } from "@/lib/query-params";
import { PRODUCT_FILTER_KEYS } from "@/server/products/queries";
import { bulkSetProcessingLinks, createBomVersion, setProcessingRatio, unlinkProcessingType } from "@/server/bom/service";
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

describe("gắn kiểu gia công cho sản phẩm", () => {
  it("ratio null = chỉ gắn kiểu (dùng mặc định của kiểu); người bán chưa có tỷ lệ vẫn khai báo lần đầu được", async () => {
    const other = await makeProduct({ kind: "THANH_PHAM" });
    const link = (actor: Actor, ratio: number | null, onlyIfMissing: boolean) => prisma.$transaction((db) => setProcessingRatio(db, actor, { productId: other.id, processingTypeId: pt.id, ratio, onlyIfMissing }));
    expect(await link(manager, null, false)).toMatchObject({ saved: true, ratio: null });
    expect(await prisma.productProcessingRatio.count({ where: { productId: other.id } })).toBe(1);
    expect(await link(seller, 1.08, true)).toMatchObject({ saved: true, ratio: "1.08" });
  });
  it("bỏ kiểu gia công: cần quyền quản lý, có audit; bỏ kiểu chưa gắn thì không lỗi", async () => {
    await set(manager, 1.08, false);
    await expect(prisma.$transaction((db) => unlinkProcessingType(db, seller, { productId: fg.id, processingTypeId: pt.id }))).rejects.toThrow();
    expect(await prisma.$transaction((db) => unlinkProcessingType(db, manager, { productId: fg.id, processingTypeId: pt.id }))).toEqual({ removed: true });
    expect(await prisma.productProcessingRatio.count({ where: { productId: fg.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "product.unlink_processing_type" } })).toBe(1);
    expect(await prisma.$transaction((db) => unlinkProcessingType(db, manager, { productId: fg.id, processingTypeId: pt.id }))).toEqual({ removed: false });
  });
});

describe("gắn / bỏ kiểu gia công hàng loạt", () => {
  const bulk = (actor: Actor, o: Partial<Parameters<typeof bulkSetProcessingLinks>[2]> & { action: "link" | "unlink" }) => prisma.$transaction((db) => bulkSetProcessingLinks(db, actor, { processingTypeId: pt.id, ratio: null, ...o }));
  it("gắn cho nhiều SP: SP đã có giữ tỷ lệ riêng; có ratio thì đặt lại cho tất cả; có audit", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM" }); const b = await makeProduct({ kind: "THANH_PHAM" });
    await set(manager, 1.2, false); // fg đã có tỷ lệ riêng 1.2
    expect(await bulk(manager, { action: "link", ids: [fg.id, a.id, b.id] })).toEqual({ selected: 3, changed: 2 });
    expect(Number((await prisma.productProcessingRatio.findFirstOrThrow({ where: { productId: fg.id } })).ratio)).toBe(1.2);
    expect((await prisma.productProcessingRatio.findFirstOrThrow({ where: { productId: a.id } })).ratio).toBeNull();
    expect(await bulk(manager, { action: "link", ids: [fg.id, a.id], ratio: 1.08 })).toEqual({ selected: 2, changed: 2 });
    expect(Number((await prisma.productProcessingRatio.findFirstOrThrow({ where: { productId: fg.id } })).ratio)).toBe(1.08);
    expect(await prisma.auditLog.count({ where: { action: "product.bulk_link_processing" } })).toBe(2);
  });
  it("bỏ hàng loạt; theo bộ lọc; từ chối người không quản lý và danh sách rỗng", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM" });
    await bulk(manager, { action: "link", ids: [fg.id, a.id] });
    await expect(bulk(seller, { action: "unlink", ids: [fg.id] })).rejects.toThrow();
    await expect(bulk(manager, { action: "unlink", ids: [] })).rejects.toThrow();
    expect(await bulk(manager, { action: "unlink", filter: parseListParams({ kind: "THANH_PHAM" }, PRODUCT_FILTER_KEYS) })).toMatchObject({ changed: 2 });
    expect(await prisma.productProcessingRatio.count()).toBe(0);
  });
});
