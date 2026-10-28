import { beforeEach, describe, expect, it } from "vitest";
import { cancelAdjustmentInTx, createAdjustmentInIdempotent, getAdjustmentIn, updateAdjustmentInTx } from "@/server/purchase/adjustment-in";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, newWorld, useNoopCostOwners } from "../inventory/helpers";

beforeEach(resetDb);
useNoopCostOwners();

const input = (productId: number, unitCost: number | null = 12_500) => ({ date: "2026-09-01", note: "Hàng nhập bổ sung", lines: [{ productId, qty: 10, unitCost }] });

describe("nhập kho không NCC", () => {
  it("cùng Idempotency-Key chỉ tạo một phiếu, một dòng sổ và một lớp FIFO", async () => {
    const w = await newWorld();
    const actor = { userId: w.userId, perms: new Set(["stock_adjust.manage", "cost.view"]) };
    const first = await createAdjustmentInIdempotent(prisma, actor, "adjustment-idempotent-1", input(w.p.id));
    const again = await createAdjustmentInIdempotent(prisma, actor, "adjustment-idempotent-1", input(w.p.id));
    expect(again).toEqual(first);
    expect(await prisma.stockAdjustment.count()).toBe(1);
    expect(await prisma.stockLedger.count()).toBe(1);
    expect(await prisma.costLayer.count()).toBe(1);
    expect((await getAdjustmentIn(prisma, actor, first.id)).lines[0]).toMatchObject({ qty: "10", unitCost: "12500" });
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("thiếu giá gần nhất và không có giá tay: báo lỗi, không tạo giá 0", async () => {
    const w = await newWorld();
    const actor = { userId: w.userId, perms: new Set(["stock_adjust.manage"]) };
    await expect(createAdjustmentInIdempotent(prisma, actor, "adjustment-no-cost", input(w.p.id, null))).rejects.toThrow("Chưa có giá nhập gần nhất");
    expect(await prisma.stockAdjustment.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
  });

  it("sửa phiếu: thay dòng hàng, giữ mã + giá cũ khi để trống giá, sổ kho/FIFO khớp; phiếu đã hủy không sửa được", async () => {
    const w = await newWorld();
    const writer = { userId: w.userId, perms: new Set(["stock_adjust.manage", "cost.view"]) };
    const created = await createAdjustmentInIdempotent(prisma, writer, "adjustment-edit", input(w.p.id));
    const edited = await updateAdjustmentInTx(prisma, writer, created.id, { date: "2026-09-01", note: "Sửa số lượng", lines: [{ productId: w.p.id, qty: 4, unitCost: null }] });
    expect(edited).toEqual({ id: created.id, code: created.code });
    const detail = await getAdjustmentIn(prisma, writer, created.id);
    expect(detail.note).toBe("Sửa số lượng");
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]).toMatchObject({ qty: "4", unitCost: "12500" });
    expect(await prisma.stockAdjustment.count()).toBe(1);
    expect(await prisma.stockLedger.count()).toBe(1);
    expect(await prisma.costLayer.count()).toBe(1);
    await assertLedgerBalanced(w.p.id, w.periodId);
    await cancelAdjustmentInTx(prisma, writer, created.id, "Nhập nhầm");
    await expect(updateAdjustmentInTx(prisma, writer, created.id, input(w.p.id))).rejects.toMatchObject({ status: 409 });
  });

  it("hủy phiếu hoàn lớp và ẩn đơn giá cho người thiếu cost.view", async () => {
    const w = await newWorld();
    const writer = { userId: w.userId, perms: new Set(["stock_adjust.manage", "cost.view"]) };
    const created = await createAdjustmentInIdempotent(prisma, writer, "adjustment-cancel", input(w.p.id));
    await cancelAdjustmentInTx(prisma, writer, created.id, "Nhập nhầm");
    expect(await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: created.id }, select: { isCancelled: true } })).toEqual({ isCancelled: true });
    expect(await prisma.costLayer.count()).toBe(0);
    expect(await prisma.stockLedger.count()).toBe(0);
    const reader = { userId: w.userId, perms: new Set(["stock_adjust.manage"]) };
    expect((await getAdjustmentIn(prisma, reader, created.id)).lines[0]!.unitCost).toBeUndefined();
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});
