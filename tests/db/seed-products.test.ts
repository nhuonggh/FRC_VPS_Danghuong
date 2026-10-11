import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed-lib";
import { seedCustomerData } from "../../prisma/seed-customer";
import { DEFAULT_SYNC_FILE, seedProductSync, type ProductSync } from "../../prisma/seed-products";
import { prisma, resetDb } from "../helpers/db";

const bundle = () => JSON.parse(readFileSync(DEFAULT_SYNC_FILE, "utf8")) as ProductSync;
beforeEach(async () => { await resetDb(); await seed(prisma, { bootstrapAdminPassword: "Mat-khau-khoi-tao-1!" }); await seedCustomerData(prisma); });

describe("đồng bộ danh mục sản phẩm theo file khách", () => {
  it("nạp kiểu gia công (tỷ lệ), tỷ trọng, liên kết gia công, thành phẩm, tên số lượng", async () => {
    const d = bundle(); const logs: string[] = [];
    expect(await seedProductSync(prisma, { log: (m) => logs.push(m) })).toBe(true);
    expect(await prisma.processingType.count()).toBe(d.processingTypes.length);
    expect(Number((await prisma.processingType.findFirstOrThrow({ where: { name: "Sóng ngói,6 sóng" } })).stockRatio)).toBe(1.04);
    const withWeight = d.products.find((p) => p.weight && p.baseUnit !== "kg")!;
    const unit = await prisma.productUnit.findFirstOrThrow({ where: { product: { code: withWeight.code } } });
    expect(unit.unit).toBe("kg"); expect(Number(unit.factor)).toBe(Number(withWeight.weight));
    const kgBase = d.products.find((p) => p.weight && p.baseUnit === "kg")!;
    const inv = await prisma.productUnit.findFirstOrThrow({ where: { product: { code: kgBase.code } } });
    expect(inv.unit).toBe("cây"); expect(Number(inv.factor) * Number(kgBase.weight)).toBeCloseTo(1, 4);
    expect(await prisma.productProcessingRatio.count()).toBe(d.products.reduce((n, p) => n + p.processing.length, 0));
    expect(await prisma.product.count({ where: { kind: "THANH_PHAM" } })).toBe(d.products.filter((p) => p.kind === "THANH_PHAM").length);
    expect(await prisma.product.count({ where: { qtyLabel: { not: null } } })).toBe(d.products.filter((p) => p.qtyLabel).length);
    expect(await prisma.unit.count()).toBe(d.units.length);
  });

  it("chỉ chạy một lần: sửa tay sau đó không bị nạp lại", async () => {
    expect(await seedProductSync(prisma)).toBe(true);
    await prisma.productProcessingRatio.deleteMany({ where: { product: { code: bundle().products.find((p) => p.processing.length)!.code } } });
    expect(await seedProductSync(prisma)).toBe(false);
  });
});
