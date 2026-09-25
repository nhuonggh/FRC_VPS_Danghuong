import { beforeEach, describe, expect, it } from "vitest";
import { PeriodClosedError, ProductNotLockedError } from "@/server/inventory/errors";
import { postIssue, postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { beginEngine } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod } from "../helpers/factories";
import { assertLedgerBalanced, newWorld, T, type World } from "./helpers";

beforeEach(resetDb);

const inTx = <R,>(w: World, products: number[], fn: (ctx: Awaited<ReturnType<typeof beginEngine>>) => Promise<R>) =>
  prisma.$transaction(async (tx) => fn(await beginEngine(tx, { periodId: w.periodId, userId: w.userId, products })));

// Kỳ mở 01/08/2026 00:00Z (07:00 ICT) → mốc cho phép là 00:00 ICT 01/08 = 31/07 17:00Z
const BEFORE_PERIOD = new Date("2026-07-31T16:59:59.999Z");

describe("cổng ghi nguồn — kiểm kỳ (Review Focus #5): lỗi tiếng Việt và KHÔNG ghi gì", () => {
  it("postReceipt / postIssue với ngày trước ngày mở kỳ → thông báo tiếng Việt, không có dòng sổ/lớp", async () => {
    const w = await newWorld();
    const msg = "Ngày chứng từ trước ngày mở kỳ hiện tại";
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: BEFORE_PERIOD }))).rejects.toThrow(msg);
    await expect(inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 1, docType: "SALE", docId: 1, docLineId: 1, at: BEFORE_PERIOD }))).rejects.toThrow(msg);
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
  });

  it("ngày đúng 00:00 ICT của ngày mở kỳ được ghi", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: new Date("2026-07-31T17:00:00Z") }));
    expect(await prisma.stockLedger.count()).toBe(1);
  });

  it("hủy chứng từ thuộc kỳ đã kết sổ: PeriodClosedError, dòng sổ + lớp còn nguyên", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 10, unitCost: 5, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
    });
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null } });
    const next = await makePeriod();
    const attempt = prisma.$transaction(async (tx) => {
      const ctx = await beginEngine(tx, { periodId: next.id, userId: w.userId, products: [w.p.id] });
      await removeDocument(ctx, "PURCHASE", 1);
    });
    await expect(attempt).rejects.toThrow(PeriodClosedError);
    expect(await prisma.stockLedger.count()).toBe(1);
    expect(await prisma.costLayer.count()).toBe(1);
  });

  it("đổi giá vốn lớp của chứng từ thuộc kỳ đã kết sổ → PeriodClosedError (không lẳng lặng updated = 0), giá cũ nguyên vẹn", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 10, unitCost: 5, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }));
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null } });
    const next = await makePeriod();
    const attempt = prisma.$transaction(async (tx) => {
      const ctx = await beginEngine(tx, { periodId: next.id, userId: w.userId, products: [w.p.id] });
      await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 9 });
    });
    await expect(attempt).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    expect((await prisma.costLayer.findFirstOrThrow()).unitCost.toString()).toBe("5");
  });
});

describe("cổng ghi nguồn — mọi cổng đòi khoá mã hàng (Review Focus #5)", () => {
  it("postIssue mã chưa khoá → ProductNotLockedError, không ghi gì", async () => {
    const w = await newWorld(2);
    await expect(inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.products[1]!.id, qty: 1, docType: "SALE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(ProductNotLockedError);
    expect(await prisma.stockLedger.count()).toBe(0);
  });

  it("updateLayerCost trên lớp của mã chưa khoá → ProductNotLockedError, giá cũ nguyên vẹn", async () => {
    const w = await newWorld(2);
    const other = w.products[1]!.id;
    await inTx(w, [other], (ctx) => postReceipt(ctx, { productId: other, qty: 10, unitCost: 5, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }));
    await expect(inTx(w, [w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 9 }))).rejects.toThrow(ProductNotLockedError);
    expect((await prisma.costLayer.findFirstOrThrow()).unitCost.toString()).toBe("5");
  });

  it("removeDocument mã chưa khoá → ProductNotLockedError và chứng từ còn nguyên", async () => {
    const w = await newWorld(2);
    await inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 4, docType: "SALE", docId: 3, docLineId: 3, at: T(0) }));
    await expect(inTx(w, [w.products[1]!.id], (ctx) => removeDocument(ctx, "SALE", 3))).rejects.toThrow(ProductNotLockedError);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: 3 } })).toBe(1);
  });
});

describe("cổng ghi nguồn — chỉ ghi NGUỒN, không tự tính consumption (việc của replayProduct)", () => {
  it("postReceipt + postIssue không tạo consumption, không đổi qty_remaining, không đổi unitCostOut/qtyProvisional", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 20000, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postIssue(ctx, { productId: w.p.id, qty: 30, docType: "SALE", docId: 2, docLineId: 2, at: T(10) });
    });
    expect(await prisma.costConsumption.count()).toBe(0);
    expect((await prisma.costLayer.findFirstOrThrow()).qtyRemaining.toString()).toBe("100");
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } });
    expect([out.unitCostOut.toString(), out.qtyProvisional.toString()]).toEqual(["0", "0"]);
  });

  it("lỗi giữa chừng trong transaction → rollback toàn bộ nguồn đã ghi", async () => {
    const w = await newWorld();
    const attempt = inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 5, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postIssue(ctx, { productId: w.p.id, qty: 0, docType: "SALE", docId: 2, docLineId: 2, at: T(1) });
    });
    await expect(attempt).rejects.toThrow("Số lượng phải lớn hơn 0.");
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
  });

  it("giữ nguyên `at` truyền vào (người gọi sửa chứng từ cùng ngày phải truyền lại `at` đã lưu)", async () => {
    const w = await newWorld();
    const at = new Date("2026-09-15T16:59:59.999Z");
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at });
      await removeDocument(ctx, "PURCHASE", 1);
      await postReceipt(ctx, { productId: w.p.id, qty: 2, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at });
    });
    expect((await prisma.stockLedger.findFirstOrThrow()).at).toEqual(at);
    expect((await prisma.costLayer.findFirstOrThrow()).at).toEqual(at);
  });
});

describe("removeDocument — trả lại qty_remaining nhiều lớp (fix lỗi plan: qty_remaining cũ sau khi xoá consumption)", () => {
  it("xoá lệnh xuất ăn 2 lớp → cả 2 lớp về đủ số lượng, sổ cân", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 10, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 12, docType: "PURCHASE", docId: 2, docLineId: 2, at: T(5) });
      await postIssue(ctx, { productId: w.p.id, qty: 130, docType: "SALE", docId: 9, docLineId: 9, at: T(10) });
    });
    // giả lập kết quả replay của Task 4: ăn 100 lớp 1 + 30 lớp 2
    const [l1, l2] = await prisma.costLayer.findMany({ orderBy: { id: "asc" } });
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } });
    await prisma.costConsumption.createMany({
      data: [
        { layerId: l1!.id, ledgerId: out.id, docType: "SALE", docLineId: 9, qty: 100, unitCost: 10 },
        { layerId: l2!.id, ledgerId: out.id, docType: "SALE", docLineId: 9, qty: 30, unitCost: 12 },
      ],
    });
    await prisma.costLayer.update({ where: { id: l1!.id }, data: { qtyRemaining: 0 } });
    await prisma.costLayer.update({ where: { id: l2!.id }, data: { qtyRemaining: 70 } });
    await prisma.stockLedger.update({ where: { id: out.id }, data: { unitCostOut: "10.4615" } });
    await assertLedgerBalanced(w.p.id, w.periodId);

    await inTx(w, [w.p.id], (ctx) => removeDocument(ctx, "SALE", 9));

    const layers = await prisma.costLayer.findMany({ orderBy: { id: "asc" } });
    expect(layers.map((l) => l.qtyRemaining.toString())).toEqual(["100", "100"]);
    expect(await prisma.costConsumption.count()).toBe(0);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});
