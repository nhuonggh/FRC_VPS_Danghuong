import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makePartnerGroup, makeProduct } from "../helpers/factories";

beforeEach(resetDb);

describe("danh mục nền — cột & ràng buộc mới", () => {
  it("nhóm khách, kho: có isActive mặc định true", async () => {
    const group = await makePartnerGroup("Thợ");
    const warehouse = await prisma.warehouse.create({ data: { name: "Kho 1" } });
    expect(group.isActive).toBe(true);
    expect(warehouse.isActive).toBe(true);
  });

  it("5 bảng danh mục mới tạo được, tên/biển số là duy nhất", async () => {
    await prisma.vehicle.create({ data: { plate: "51C-123.45" } });
    await expect(prisma.vehicle.create({ data: { plate: "51C-123.45" } })).rejects.toThrow(/Unique constraint/i);
    await prisma.route.create({ data: { name: "Quận 12" } });
    await prisma.expenseType.create({ data: { name: "Dầu xe" } });
    await prisma.processingType.create({ data: { name: "Tôn xốp" } });
    await prisma.driver.create({ data: { name: "Nguyễn Văn Tài", isAssistant: false } });
    await prisma.driver.create({ data: { name: "Nguyễn Văn Tài", isAssistant: true } });
    expect(await prisma.driver.count()).toBe(2);
  });

  it("sản phẩm: isCoil mặc định false", async () => {
    expect((await makeProduct()).isCoil).toBe(false);
  });

  it("CHECK: hệ số quy đổi > 0, định mức tồn ≥ 0, hạn mức nợ ≥ 0, đối tác phải là khách hoặc NCC", async () => {
    const product = await makeProduct();
    await expect(prisma.productUnit.create({ data: { productId: product.id, unit: "kg", factor: 0 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.product.update({ where: { id: product.id }, data: { minStock: -1 } })).rejects.toThrow(/check constraint/i);
    const group = await makePartnerGroup();
    await expect(prisma.partner.create({ data: { code: "X1", name: "X", groupId: group.id, debtLimit: -5 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.partner.create({ data: { code: "X2", name: "X", groupId: group.id, isCustomer: false, isSupplier: false } })).rejects.toThrow(/check constraint/i);
  });
});
