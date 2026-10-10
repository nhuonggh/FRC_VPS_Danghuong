import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { createCatalogItem, updateCatalogItemsBulk } from "@/server/catalog/service";
import { commitImport } from "@/server/import/framework";
import { productImportSpec } from "@/server/products/import-spec";
import { exportProductsXlsx, listProducts, PRODUCT_FILTER_KEYS } from "@/server/products/queries";
import { createProductSchema } from "@/server/products/schemas";
import { createProduct, setProductUnitsBulk } from "@/server/products/service";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { toXlsx } from "../../scripts/lib/customer-data";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
const mk = (code: string, units: { unit: string; factor: number }[] = []) => tx((db) => createProduct(db, actor, createProductSchema.parse({ code, name: `SP ${code}`, kind: "HANG", baseUnit: "md", minStock: 0, isCoil: false, isActive: true, note: "", units })));
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["catalog.manage", "product.manage", "product.view", "data.import"]) }; });

describe("sửa nhanh tỷ trọng sản phẩm", () => {
  it("đặt / đổi / xoá tỷ trọng nhiều sản phẩm một lần; lọc Chưa khai báo", async () => {
    const a = await mk("A"), b = await mk("B", [{ unit: "kg", factor: 2 }]), c = await mk("C", [{ unit: "kg", factor: 3 }]);
    await tx((db) => setProductUnitsBulk(db, actor, [{ id: a.id, unit: "kg", factor: "2,4" }, { id: b.id, unit: "m2", factor: "1,2" }, { id: c.id, unit: "", factor: "" }]));
    const units = async (id: number) => (await prisma.productUnit.findMany({ where: { productId: id } })).map((u) => `${u.unit}=${u.factor}`);
    expect(await units(a.id)).toEqual(["kg=2.4"]); expect(await units(b.id)).toEqual(["m2=1.2"]); expect(await units(c.id)).toEqual([]);
    const missing = await listProducts(prisma, parseListParams({ conv: "missing" }, PRODUCT_FILTER_KEYS));
    expect(missing.rows.map((r) => r.code)).toEqual(["C"]);
  });

  it("sai một dòng thì huỷ cả lô; SP nhiều đơn vị bị chặn; thiếu một nửa bị chặn", async () => {
    const a = await mk("A"), m = await mk("M", [{ unit: "kg", factor: 2 }, { unit: "m2", factor: 1 }]);
    await expect(tx((db) => setProductUnitsBulk(db, actor, [{ id: a.id, unit: "kg", factor: "2" }, { id: a.id, unit: "kg", factor: "abc" }]))).rejects.toThrow("Tỷ trọng");
    expect(await prisma.productUnit.count({ where: { productId: a.id } })).toBe(0);
    await expect(tx((db) => setProductUnitsBulk(db, actor, [{ id: m.id, unit: "kg", factor: "1" }]))).rejects.toThrow("nhiều đơn vị");
    await expect(tx((db) => setProductUnitsBulk(db, actor, [{ id: a.id, unit: "kg", factor: "" }]))).rejects.toThrow("đủ cả");
  });

  it("nhập Excel nhiều dòng cùng mã tạo nhiều đơn vị quy đổi; xuất ra đủ cột Tỷ trọng, mỗi đơn vị một dòng", async () => {
    const head = ["Mã", "Tên", "Đơn vị gốc", "Đơn vị quy đổi", "Tỷ trọng"];
    const res = await commitImport(prisma, actor, productImportSpec(), await toXlsx(head, [["X1", "Tôn X", "md", "kg", "2,4"], ["X1", "Tôn X", "md", "m2", "1,2"], ["X2", "Tôn Y", "md", "", ""]]), { overwrite: false, idempotencyKey: "k1" });
    expect(res).toMatchObject({ created: 3, failed: 0 });
    expect(await prisma.productUnit.count({ where: { product: { code: "X1" } } })).toBe(2);
    expect(await prisma.product.count()).toBe(2);
    const file = await toXlsx(head, [["X1", "Tôn X", "md", "kg", "3"], ["X1", "Tôn X", "md", "m2", "1,2"]]);
    expect(await commitImport(prisma, actor, productImportSpec(), file, { overwrite: false, idempotencyKey: "k1b" })).toMatchObject({ created: 0, skippedExisting: 2 });
    expect(await commitImport(prisma, actor, productImportSpec(), file, { overwrite: true, idempotencyKey: "k1c" })).toMatchObject({ updated: 2 });
    expect(String((await prisma.productUnit.findFirstOrThrow({ where: { product: { code: "X1" }, unit: "kg" } })).factor)).toBe("3");
    const bad = await commitImport(prisma, actor, productImportSpec(), await toXlsx(head, [["Z1", "Z", "md", "kg", "2"], ["Z1", "Z", "cây", "m2", "1"]]), { overwrite: false, idempotencyKey: "k2" });
    expect(bad.failed).toBe(2);
    const buf = await exportProductsXlsx(prisma, parseListParams({}, PRODUCT_FILTER_KEYS));
    const ExcelJS = (await import("exceljs")).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!; expect(String(ws.getRow(1).getCell(9).value)).toBe("Tỷ trọng"); expect(ws.rowCount).toBe(4);
  });
});

describe("sửa nhanh danh mục", () => {
  it("kiểu gia công: sửa tỷ lệ nhiều dòng một giao dịch, lỗi một dòng huỷ cả lô và báo tên dòng", async () => {
    const a = await tx((db) => createCatalogItem(db, actor, "processing-types", { name: "A", note: "", ratio: "", stockRatio: "", unit: "" }));
    const b = await tx((db) => createCatalogItem(db, actor, "processing-types", { name: "B", note: "", ratio: "", stockRatio: "", unit: "" }));
    await tx((db) => updateCatalogItemsBulk(db, actor, "processing-types", [{ id: a.id, values: { name: "A", note: "", ratio: "1,08", stockRatio: "1", unit: "m2" } }, { id: b.id, values: { name: "B", note: "x", ratio: "0,185", stockRatio: "", unit: "m2" } }]));
    expect(String((await prisma.processingType.findUniqueOrThrow({ where: { id: a.id } })).ratio)).toBe("1.08");
    expect(String((await prisma.processingType.findUniqueOrThrow({ where: { id: b.id } })).ratio)).toBe("0.185");
    await expect(tx((db) => updateCatalogItemsBulk(db, actor, "processing-types", [{ id: a.id, values: { name: "A2", note: "", ratio: "5", stockRatio: "", unit: "" } }, { id: b.id, values: { name: "B", note: "", ratio: "abc", stockRatio: "", unit: "" } }]))).rejects.toThrow("B: Tỷ lệ");
    expect((await prisma.processingType.findUniqueOrThrow({ where: { id: a.id } })).name).toBe("A");
  });
});
