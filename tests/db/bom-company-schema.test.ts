import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makeProcessingType, makeProduct, makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function base() {
  const [user, pt, fg, m1, m2] = await Promise.all([
    makeUser(), makeProcessingType(), makeProduct({ kind: "THANH_PHAM" }), makeProduct({ kind: "NVL" }), makeProduct({ kind: "NVL" }),
  ]);
  return { user, pt, fg, m1, m2 };
}

describe("BOM schema (D-19)", () => {
  it("tạo phiên bản + dòng; unique (bom, NVL) và CHECK qty > 0", async () => {
    const b = await base();
    const v = await makeBomVersion({ productId: b.fg.id, processingTypeId: b.pt.id, createdBy: b.user.id, lines: [{ materialProductId: b.m1.id, qtyPerUnit: "1.250" }] });
    expect(v.versionNo).toBe(1);
    await expect(prisma.bomLine.create({ data: { bomVersionId: v.id, materialProductId: b.m1.id, qtyPerUnit: 1 } })).rejects.toThrow(); // trùng NVL
    await expect(prisma.bomLine.create({ data: { bomVersionId: v.id, materialProductId: b.m2.id, qtyPerUnit: 0 } })).rejects.toThrow(/check constraint/i);
  });

  it("NVL không được là chính thành phẩm", async () => {
    const b = await base();
    await expect(
      makeBomVersion({ productId: b.fg.id, processingTypeId: b.pt.id, createdBy: b.user.id, lines: [{ materialProductId: b.fg.id, qtyPerUnit: 1 }] }),
    ).rejects.toThrow(/trùng với chính thành phẩm/);
  });

  it("một (SP, kiểu gia công) chỉ có một Bom; cùng validFrom bị chặn, bản đã huỷ nhả ngày", async () => {
    const b = await base();
    const args = { productId: b.fg.id, processingTypeId: b.pt.id, createdBy: b.user.id, lines: [{ materialProductId: b.m1.id, qtyPerUnit: 1 }] };
    const v1 = await makeBomVersion({ ...args, validFrom: "2026-10-01" });
    await expect(makeBomVersion({ ...args, validFrom: "2026-10-01" })).rejects.toThrow(/Unique constraint/i);
    await prisma.bomVersion.update({ where: { id: v1.id }, data: { status: "CANCELLED" } });
    await expect(makeBomVersion({ ...args, validFrom: "2026-10-01" })).resolves.toMatchObject({ versionNo: 2 });
    expect(await prisma.bom.count()).toBe(1);
  });

  it("bất biến: không UPDATE/DELETE dòng, không xoá/sửa nội dung phiên bản, chỉ chuyển trạng thái hợp lệ", async () => {
    const b = await base();
    const v = await makeBomVersion({ productId: b.fg.id, processingTypeId: b.pt.id, createdBy: b.user.id, lines: [{ materialProductId: b.m1.id, qtyPerUnit: 1 }] });
    const line = v.lines[0]!;
    await expect(prisma.bomLine.update({ where: { id: line.id }, data: { qtyPerUnit: 2 } })).rejects.toThrow(/bất biến/);
    await expect(prisma.bomLine.delete({ where: { id: line.id } })).rejects.toThrow(/bất biến/);
    await expect(prisma.bomVersion.delete({ where: { id: v.id } })).rejects.toThrow(/không xoá/);
    await expect(prisma.bomVersion.update({ where: { id: v.id }, data: { validFrom: new Date("2026-11-01T00:00:00Z") } })).rejects.toThrow(/bất biến/);
    await expect(prisma.bomVersion.update({ where: { id: v.id }, data: { status: "DRAFT" } })).rejects.toThrow(/không hợp lệ/);
    await prisma.bomVersion.update({ where: { id: v.id }, data: { status: "CANCELLED" } });
    await expect(prisma.bomVersion.update({ where: { id: v.id }, data: { status: "ACTIVE" } })).rejects.toThrow(/không hợp lệ/);
  });

  it("FK RESTRICT: không xoá sản phẩm/kiểu gia công đang có BOM", async () => {
    const b = await base();
    await makeBomVersion({ productId: b.fg.id, processingTypeId: b.pt.id, createdBy: b.user.id, lines: [{ materialProductId: b.m1.id, qtyPerUnit: 1 }] });
    await expect(prisma.product.delete({ where: { id: b.m1.id } })).rejects.toThrow();
    await expect(prisma.processingType.delete({ where: { id: b.pt.id } })).rejects.toThrow();
  });
});

describe("print_templates & company_settings", () => {
  it("mẫu in: default an toàn (tắt), docType đúng định dạng, webhook chỉ https, unique (docType, name)", async () => {
    const t = await prisma.printTemplate.create({ data: { docType: "SALE_INVOICE", name: "Hoá đơn bán" } });
    expect(t).toMatchObject({ isActive: false, showCompanyInfo: true, secretCiphertext: null, webhookUrl: null });
    await expect(prisma.printTemplate.create({ data: { docType: "SALE_INVOICE", name: "Hoá đơn bán" } })).rejects.toThrow(/Unique/i);
    await expect(prisma.printTemplate.create({ data: { docType: "sale invoice", name: "x" } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.printTemplate.create({ data: { docType: "PO", name: "y", webhookUrl: "http://internal/x" } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.printTemplate.create({ data: { docType: "PO", name: "z", webhookUrl: "https://script.google.com/x" } })).resolves.toBeTruthy();
  });

  it("công ty: chỉ cho phép hàng id = 1", async () => {
    await prisma.companySetting.create({ data: { id: 1, name: "A" } });
    await expect(prisma.companySetting.create({ data: { id: 2, name: "B" } })).rejects.toThrow(/check constraint/i);
    const c = await prisma.companySetting.update({ where: { id: 1 }, data: { name: "A2" } });
    expect(c.updatedAt).toBeInstanceOf(Date);
  });
});
