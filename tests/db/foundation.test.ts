import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

async function seedBasics() {
  const period = await prisma.period.create({
    data: { name: "K1", status: "OPEN", isOpen: true },
  });
  const product = await prisma.product.create({
    data: { code: "SP1", name: "Tôn 0.45", baseUnit: "md" },
  });
  return { period, product };
}

describe("kỳ (periods)", () => {
  it("chỉ cho đúng 1 kỳ OPEN", async () => {
    await prisma.period.create({ data: { name: "K1", status: "OPEN", isOpen: true } });
    await expect(
      prisma.period.create({ data: { name: "K2", status: "OPEN", isOpen: true } }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("cho phép nhiều kỳ CLOSED", async () => {
    await prisma.period.create({ data: { name: "K1", status: "CLOSED", isOpen: null } });
    await prisma.period.create({ data: { name: "K2", status: "CLOSED", isOpen: null } });
    expect(await prisma.period.count()).toBe(2);
  });

  it("isOpen không được lệch status", async () => {
    await expect(
      prisma.period.create({ data: { name: "K1", status: "CLOSED", isOpen: true } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.period.create({ data: { name: "K2", status: "OPEN", isOpen: null } }),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("audit_log append-only", () => {
  it("chủ sở hữu DB cũng không UPDATE được (trigger)", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "e" } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: "b" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("chủ sở hữu DB cũng không DELETE được (trigger)", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "e" } });
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("không TRUNCATE được (trigger)", async () => {
    await expect(prisma.$executeRawUnsafe("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
  });

  it("role app_rw: INSERT/SELECT được, UPDATE/DELETE bị từ chối quyền", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`INSERT INTO audit_log (action, entity) VALUES ('a', 'e')`);
      const rows = await tx.$queryRawUnsafe<{ id: number }[]>("SELECT id FROM audit_log");
      expect(rows.length).toBe(1);
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
        await tx.$executeRawUnsafe("UPDATE audit_log SET action = 'x'");
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
        await tx.$executeRawUnsafe("DELETE FROM audit_log");
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("role app_rw đọc/ghi được bảng nghiệp vụ", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`INSERT INTO warehouses (name) VALUES ('Kho 1')`);
      await tx.$executeRawUnsafe(`UPDATE warehouses SET name = 'Kho A'`);
    });
  });
});

describe("ràng buộc engine kho", () => {
  it("cost_layers: qtyRemaining ∈ [0, qtyIn], qtyIn > 0", async () => {
    const { period, product } = await seedBasics();
    const ledger = await prisma.stockLedger.create({
      data: {
        periodId: period.id, productId: product.id, docType: "PURCHASE", docId: 1, docLineId: 1,
        qtyIn: 10, at: new Date(), createdBy: 1,
      },
    });
    const base = {
      periodId: period.id, productId: product.id, sourceDocType: "PURCHASE" as const,
      sourceDocId: 1, sourceLineId: 1, ledgerId: ledger.id, unitCost: 100, at: new Date(),
    };
    await expect(
      prisma.costLayer.create({ data: { ...base, qtyIn: 10, qtyRemaining: 11 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.costLayer.create({ data: { ...base, qtyIn: 10, qtyRemaining: -1 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.costLayer.create({ data: { ...base, qtyIn: 0, qtyRemaining: 0 } }),
    ).rejects.toThrow(/check constraint/i);
    await prisma.costLayer.create({ data: { ...base, qtyIn: 10, qtyRemaining: 10 } });
  });

  it("stock_ledger: đúng một chiều nhập HOẶC xuất; qtyProvisional ≤ qtyOut", async () => {
    const { period, product } = await seedBasics();
    const base = {
      periodId: period.id, productId: product.id, docType: "SALE" as const,
      docId: 1, docLineId: 1, at: new Date(), createdBy: 1,
    };
    await expect(
      prisma.stockLedger.create({ data: { ...base, qtyIn: 1, qtyOut: 1 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.stockLedger.create({ data: { ...base, qtyIn: 0, qtyOut: 0 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.stockLedger.create({ data: { ...base, qtyOut: 5, qtyProvisional: 6 } }),
    ).rejects.toThrow(/check constraint/i);
    await prisma.stockLedger.create({ data: { ...base, qtyOut: 5, qtyProvisional: 5 } });
  });

  it("cost_consumptions: qty > 0", async () => {
    const { period, product } = await seedBasics();
    const inLedger = await prisma.stockLedger.create({
      data: { periodId: period.id, productId: product.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 10, at: new Date(), createdBy: 1 },
    });
    const outLedger = await prisma.stockLedger.create({
      data: { periodId: period.id, productId: product.id, docType: "SALE", docId: 1, docLineId: 1, qtyOut: 1, at: new Date(), createdBy: 1 },
    });
    const layer = await prisma.costLayer.create({
      data: { periodId: period.id, productId: product.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: inLedger.id, qtyIn: 10, qtyRemaining: 10, unitCost: 1, at: new Date() },
    });
    await expect(
      prisma.costConsumption.create({
        data: { layerId: layer.id, ledgerId: outLedger.id, docType: "SALE", docLineId: 1, qty: 0, unitCost: 1 },
      }),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("idempotency_keys", () => {
  it("trùng (userId, scope, key) bị từ chối", async () => {
    await prisma.idempotencyKey.create({ data: { userId: 1, scope: "order.create", key: "k1" } });
    await expect(
      prisma.idempotencyKey.create({ data: { userId: 1, scope: "order.create", key: "k1" } }),
    ).rejects.toThrow(/Unique constraint/i);
    await prisma.idempotencyKey.create({ data: { userId: 1, scope: "order.create", key: "k2" } });
  });
});
