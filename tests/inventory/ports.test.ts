import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { DependentDocumentsError, DocDateBeforePeriodError, InvalidCostError, InvalidQuantityError, PeriodClosedError, ProductNotLockedError, ProductRecomputingError } from "@/server/inventory/errors";
import { postIssue, postReceipt, productsOfDocument, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { beginEngine } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod } from "../helpers/factories";
import { newWorld, T, type World } from "./helpers";

beforeEach(resetDb);

const begin = (w: World, products: number[], over = {}) =>
  prisma.$transaction((tx) => beginEngine(tx, { periodId: w.periodId, userId: w.userId, products, ...over }));
const inTx = <R,>(w: World, products: number[], fn: (ctx: Awaited<ReturnType<typeof beginEngine>>) => Promise<R>) =>
  prisma.$transaction(async (tx) => fn(await beginEngine(tx, { periodId: w.periodId, userId: w.userId, products })));

describe("beginEngine", () => {
  it("kỳ đã kết sổ → PeriodClosedError và không tạo gì", async () => {
    const w = await newWorld();
    const closed = await makePeriod({ status: "CLOSED", isOpen: null });
    await expect(prisma.$transaction((tx) => beginEngine(tx, { periodId: closed.id, userId: 1, products: [w.p.id] }))).rejects.toThrow(PeriodClosedError);
  });

  it("bỏ periodId → dùng kỳ đang mở", async () => {
    const w = await newWorld();
    await prisma.$transaction(async (tx) => {
      const ctx = await beginEngine(tx, { userId: w.userId, products: [w.p.id] });
      expect(ctx.period.id).toBe(w.periodId);
      expect(ctx.locked.has(w.p.id)).toBe(true);
    });
  });
});

describe("postReceipt", () => {
  it("ghi 1 dòng sổ + 1 lớp cùng thời điểm; unitCost làm tròn 4 chữ số; đánh dấu dirty", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await postReceipt(ctx, { productId: w.p.id, qty: "3", unitCost: new Prisma.Decimal(10000).div(3), docType: "PURCHASE", docId: 1, docLineId: 1, at: T(5) });
      expect(ctx.dirty.get(w.p.id)).toEqual(T(5));
      const layer = await ctx.tx.costLayer.findUniqueOrThrow({ where: { id: r.layerId } });
      expect(layer.unitCost.toString()).toBe("3333.3333");
      expect(layer.qtyRemaining.toString()).toBe("3");
      expect(layer.ledgerId).toBe(r.ledgerId);
      expect(layer.at).toEqual(T(5));
      const led = await ctx.tx.stockLedger.findUniqueOrThrow({ where: { id: r.ledgerId } });
      expect(led.qtyIn.toString()).toBe("3");
      expect(led.periodId).toBe(w.periodId);
      expect(led.createdBy).toBe(w.userId);
    });
  });

  it("dirty giữ mốc SỚM NHẤT khi ghi nhiều lần", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(20) });
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 2, docLineId: 2, at: T(5) });
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 3, docLineId: 3, at: T(30) });
      expect(ctx.dirty.get(w.p.id)).toEqual(T(5));
    });
  });

  it("từ chối số lượng ≤ 0, giá âm, mã hàng chưa khoá, ngày trước kỳ — không ghi gì", async () => {
    const w = await newWorld(2);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 0, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(InvalidQuantityError);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: -5, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow("Số lượng phải lớn hơn 0.");
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: -1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(InvalidCostError);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.products[1]!.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(ProductNotLockedError);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: new Date("2026-07-31T00:00:00Z") }))).rejects.toThrow(DocDateBeforePeriodError);
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
  });

  it("ghi lớp phụ thuộc (costRef) cho trả hàng / thành phẩm", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await postReceipt(ctx, { productId: w.p.id, qty: 10, unitCost: 20444.4444, docType: "RETURN_IN", docId: 5, docLineId: 5, at: T(40), costRef: { docType: "SALE", docLineId: 2, qty: 90 } });
      const layer = await ctx.tx.costLayer.findUniqueOrThrow({ where: { id: r.layerId } });
      expect([layer.costRefType, layer.costRefId, layer.costRefQty?.toString()]).toEqual(["SALE", 2, "90"]);
    });
  });
});

describe("postIssue", () => {
  it("ghi 1 dòng xuất (chưa có consumption — Task 4 tính); từ chối ≤ 0 và mã đang tính lại", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await postIssue(ctx, { productId: w.p.id, qty: 30, docType: "SALE", docId: 1, docLineId: 1, at: T(10) });
      const led = await ctx.tx.stockLedger.findUniqueOrThrow({ where: { id: r.ledgerId } });
      expect([led.qtyOut.toString(), led.qtyIn.toString(), led.qtyProvisional.toString()]).toEqual(["30", "0", "0"]);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(10));
    });
    await expect(inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 0, docType: "SALE", docId: 2, docLineId: 2, at: T(11) }))).rejects.toThrow(InvalidQuantityError);
    await prisma.product.update({ where: { id: w.p.id }, data: { recomputing: true } });
    await expect(inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 1, docType: "SALE", docId: 3, docLineId: 3, at: T(12) }))).rejects.toThrow(ProductRecomputingError);
  });
});

describe("removeDocument", () => {
  async function seedDocs(w: World) {
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 10, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postIssue(ctx, { productId: w.p.id, qty: 30, docType: "SALE", docId: 7, docLineId: 71, at: T(10) });
      await postIssue(ctx, { productId: w.p.id, qty: 5, docType: "SALE", docId: 7, docLineId: 72, at: T(10) });
    });
  }

  it("xoá mọi dòng sổ + lớp của chứng từ, đánh dấu dirty từ thời điểm sớm nhất bị ảnh hưởng", async () => {
    const w = await newWorld();
    await seedDocs(w);
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await removeDocument(ctx, "SALE", 7);
      expect(r.removed).toBe(2);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(10));
    });
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: 7 } })).toBe(0);
    expect(await prisma.stockLedger.count({ where: { docType: "PURCHASE" } })).toBe(1);
  });

  it("xoá phiếu NHẬP: xoá lớp + dòng sổ và kéo mốc dirty về sớm nhất giữa lớp và các dòng xuất đã ăn lớp đó", async () => {
    const w = await newWorld();
    await seedDocs(w);
    // giả lập 1 consumption của SALE#7 lên lớp phiếu nhập (Task 4 sẽ tự sinh)
    const layer = await prisma.costLayer.findFirstOrThrow();
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docLineId: 71 } });
    await prisma.costConsumption.create({ data: { layerId: layer.id, ledgerId: out.id, docType: "SALE", docLineId: 71, qty: 30, unitCost: 10 } });
    await prisma.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: 70 } });
    await inTx(w, [w.p.id], async (ctx) => {
      await removeDocument(ctx, "PURCHASE", 1);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(0));
    });
    expect(await prisma.costLayer.count()).toBe(0);
    expect(await prisma.costConsumption.count()).toBe(0);
  });

  it("xoá dòng xuất đã ăn lớp → TRẢ LẠI qty_remaining của lớp (kể cả lớp nằm trước mốc tính lại)", async () => {
    const w = await newWorld();
    await seedDocs(w);
    const layer = await prisma.costLayer.findFirstOrThrow();
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docLineId: 71 } });
    await prisma.costConsumption.create({ data: { layerId: layer.id, ledgerId: out.id, docType: "SALE", docLineId: 71, qty: 30, unitCost: 10 } });
    await prisma.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: 70 } });
    await inTx(w, [w.p.id], (ctx) => removeDocument(ctx, "SALE", 7));
    expect((await prisma.costLayer.findFirstOrThrow()).qtyRemaining.toString()).toBe("100");
  });

  it("chứng từ không tồn tại → removed = 0, không lỗi", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => expect((await removeDocument(ctx, "SALE", 999)).removed).toBe(0));
  });

  it("chứng từ thuộc KỲ ĐÃ KẾT SỔ → PeriodClosedError, không xoá gì (Review Focus #5)", async () => {
    const w = await newWorld();
    await seedDocs(w);
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null } });
    const next = await makePeriod();
    await expect(
      prisma.$transaction(async (tx) => {
        const ctx = await beginEngine(tx, { periodId: next.id, userId: w.userId, products: [w.p.id] });
        await removeDocument(ctx, "SALE", 7);
      }),
    ).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: 7 } })).toBe(2);
  });

  it("mã hàng của chứng từ chưa khoá → ProductNotLockedError", async () => {
    const w = await newWorld(2);
    await seedDocs(w);
    await expect(inTx(w, [w.products[1]!.id], (ctx) => removeDocument(ctx, "SALE", 7))).rejects.toThrow(ProductNotLockedError);
  });

  it("chặn xoá khi còn lớp PHỤ THUỘC vào dòng của chứng từ (trả hàng/thành phẩm)", async () => {
    const w = await newWorld();
    await seedDocs(w);
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 5, unitCost: 10, docType: "RETURN_IN", docId: 9, docLineId: 9, at: T(50), costRef: { docType: "SALE", docLineId: 71, qty: 30 } });
    });
    await expect(inTx(w, [w.p.id], (ctx) => removeDocument(ctx, "SALE", 7))).rejects.toThrow(DependentDocumentsError);
  });
});

describe("productsOfDocument", () => {
  it("trả các mã hàng khác nhau, tăng dần", async () => {
    const w = await newWorld(3);
    const [a, b, c] = w.products;
    await inTx(w, [a!.id, b!.id, c!.id], async (ctx) => {
      await postIssue(ctx, { productId: c!.id, qty: 1, docType: "SALE", docId: 3, docLineId: 31, at: T(1) });
      await postIssue(ctx, { productId: a!.id, qty: 1, docType: "SALE", docId: 3, docLineId: 32, at: T(1) });
      await postIssue(ctx, { productId: a!.id, qty: 1, docType: "SALE", docId: 3, docLineId: 33, at: T(1) });
    });
    expect(await productsOfDocument(prisma, "SALE", 3)).toEqual([a!.id, c!.id].sort((x, y) => x - y));
  });
});

describe("updateLayerCost — cước nhập sau phiếu hàng (spec 3.1)", () => {
  it("đổi giá vốn lớp của chứng từ nguồn và đánh dấu dirty từ thời điểm lớp", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 20000, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(3) }));
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: "20500.12345" });
      expect(r.updated).toBe(1);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(3));
    });
    expect((await prisma.costLayer.findFirstOrThrow()).unitCost.toString()).toBe("20500.1235");
  });

  it("lọc theo docLineId khi chỉ định; chứng từ không có lớp → updated = 0; giá âm bị từ chối", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 2, at: T(0) });
    });
    await inTx(w, [w.p.id], async (ctx) => {
      expect((await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, docLineId: 2, unitCost: 5 })).updated).toBe(1);
      expect((await updateLayerCost(ctx, { docType: "PURCHASE", docId: 99, unitCost: 5 })).updated).toBe(0);
    });
    await expect(inTx(w, [w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: -1 }))).rejects.toThrow(InvalidCostError);
  });
});
