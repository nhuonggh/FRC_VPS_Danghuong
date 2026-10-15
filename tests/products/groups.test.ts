import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { getLinkedRecords } from "@/server/catalog/queries";
import { createCatalogItem, deleteCatalogItem } from "@/server/catalog/service";
import { DomainError } from "@/server/http/errors";
import { productImportSpec } from "@/server/products/import-spec";
import { exportProductsXlsx, getProduct, listProducts, PRODUCT_FILTER_KEYS, searchProducts } from "@/server/products/queries";
import { createProductSchema, basicSectionSchema } from "@/server/products/schemas";
import { createProduct, updateProductBasic } from "@/server/products/service";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
const mk = (code: string, groupId?: number | null) => tx((db) => createProduct(db, actor, createProductSchema.parse({ code, name: `SP ${code}`, kind: "HANG", baseUnit: "md", minStock: 0, isCoil: false, isActive: true, note: "", units: [], ...(groupId === undefined ? {} : { groupId }) })));
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["catalog.manage", "product.manage", "product.view"]) }; });

describe("nhóm hàng", () => {
  it("danh mục 'Nhóm hàng': tạo được, tên duy nhất; sản phẩm gán/đổi/bỏ nhóm; DTO + tìm kiếm + chi tiết có tên nhóm", async () => {
    const g1 = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Tấm alu" }));
    const g2 = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Tôn lạnh" }));
    await expect(tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Tấm alu" }))).rejects.toBeInstanceOf(Error);

    const a = await mk("A1", g1.id); const b = await mk("B1"); // B1 chưa có nhóm
    expect((await getProduct(prisma, a.id)).groupName).toBe("Tấm alu");
    expect((await getProduct(prisma, b.id)).groupId).toBeNull();
    expect((await searchProducts(prisma, { q: "A1" }))[0]).toMatchObject({ groupName: "Tấm alu" });

    const basic = { name: "SP A1", kind: "HANG" as const, baseUnit: "md", isCoil: false, note: "" };
    await tx((db) => updateProductBasic(db, actor, a.id, basicSectionSchema.parse({ ...basic, groupId: g2.id })));
    expect((await getProduct(prisma, a.id)).groupName).toBe("Tôn lạnh");
    await tx((db) => updateProductBasic(db, actor, a.id, basicSectionSchema.parse({ ...basic, groupId: null })));
    expect((await getProduct(prisma, a.id)).groupId).toBeNull();
    // không gửi groupId khi sửa ⇒ giữ nguyên
    await tx((db) => updateProductBasic(db, actor, a.id, basicSectionSchema.parse({ ...basic, groupId: g1.id })));
    await tx((db) => updateProductBasic(db, actor, a.id, basicSectionSchema.parse(basic)));
    expect((await getProduct(prisma, a.id)).groupId).toBe(g1.id);
  });

  it("lọc danh sách theo nhóm, cột nhóm trong DTO và file Excel", async () => {
    const g1 = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Nhóm 1" }));
    const g2 = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Nhóm 2" }));
    await mk("P1", g1.id); await mk("P2", g2.id); await mk("P3");
    const params = (group: string[]) => parseListParams({ group }, PRODUCT_FILTER_KEYS);
    expect((await listProducts(prisma, params([String(g1.id)]))).rows.map((r) => r.code)).toEqual(["P1"]);
    expect((await listProducts(prisma, params([String(g1.id), String(g2.id)]))).total).toBe(2);
    expect((await listProducts(prisma, params(["abc", "-1"]))).total).toBe(3); // giá trị rác bị bỏ qua
    const xlsx = await exportProductsXlsx(prisma, params([]));
    expect(xlsx.length).toBeGreaterThan(0);
  });

  it("danh mục: tab sản phẩm liên kết liệt kê sản phẩm của nhóm; xoá nhóm đang có sản phẩm ⇒ bị chặn", async () => {
    const g = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Có hàng" }));
    const p = await mk("L1", g.id);
    expect(await getLinkedRecords(prisma, "product-groups", g.id)).toEqual([expect.objectContaining({ id: p.id, sub: "L1", href: `/inventory/products/${p.id}` })]);
    await expect(tx((db) => deleteCatalogItem(db, actor, "product-groups", g.id))).rejects.toBeInstanceOf(DomainError);
    expect(await prisma.productGroup.count()).toBe(1);
    const empty = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Trống" }));
    await tx((db) => deleteCatalogItem(db, actor, "product-groups", empty.id));
    expect(await prisma.productGroup.count()).toBe(1);
  });

  it("nhập Excel: cột 'Nhóm hàng' khớp tên không phân biệt dấu/hoa thường; nhóm lạ ⇒ lỗi dòng; để trống ⇒ không nhóm", async () => {
    const g = await tx((db) => createCatalogItem(db, actor, "product-groups", { name: "Tấm alu" }));
    const spec = productImportSpec();
    const ctx = await spec.loadContext(prisma);
    const row = { code: "I1", name: "Tên", kind: "Hàng hóa", baseUnit: "md", minStock: "0", unit: "", factor: "", isCoil: "Không", stopped: "Không", note: "" };
    const ok = spec.parseRow({ ...row, group: "TAM ALU" }, ctx);
    expect(ok.ok && ok.data.groupId).toBe(g.id);
    const none = spec.parseRow({ ...row, group: "" }, ctx);
    expect(none.ok && none.data.groupId).toBeNull();
    const bad = spec.parseRow({ ...row, group: "Không có" }, ctx);
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.errors.join(" ")).toContain("Nhóm hàng");
    // ghi: tạo mới gắn nhóm; cập nhật dòng không có nhóm KHÔNG xoá nhóm cũ
    await tx((db) => spec.create(db, actor, [ok.ok ? ok.data : (undefined as never)], ctx));
    expect((await prisma.product.findUniqueOrThrow({ where: { code: "I1" } })).groupId).toBe(g.id);
    await tx((db) => spec.update(db, actor, [none.ok ? { ...none.data } : (undefined as never)], ctx));
    expect((await prisma.product.findUniqueOrThrow({ where: { code: "I1" } })).groupId).toBe(g.id);
  });
});
