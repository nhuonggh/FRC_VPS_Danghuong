import { beforeEach, describe, expect, it } from "vitest";
import { estimateCost, getOnHand } from "@/server/inventory/queries";
import { prisma, resetDb } from "../helpers/db";
import { newWorld, T, type World } from "./helpers";

beforeEach(resetDb);

// Dựng lớp/dòng xuất THÔ (chưa qua engine) để kiểm truy vấn độc lập
async function rawLayer(w: World, at: number, qty: number, unitCost: number, opts: { ref?: boolean } = {}) {
  const n = (await prisma.stockLedger.count()) + 1;
  const l = await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE", docId: n, docLineId: n, qtyIn: qty, at: T(at), createdBy: w.userId } });
  return prisma.costLayer.create({
    data: {
      periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: n, sourceLineId: n, ledgerId: l.id,
      qtyIn: qty, qtyRemaining: qty, unitCost, at: T(at),
      ...(opts.ref ? { costRefType: "SALE" as const, costRefId: 1, costRefQty: qty } : {}),
    },
  });
}

describe("getOnHand", () => {
  it("= Σ qty_remaining − Σ qty_provisional (có thể ÂM khi bán âm kho)", async () => {
    const w = await newWorld();
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("0");
    await rawLayer(w, 0, 100, 10);
    await prisma.costLayer.updateMany({ data: { qtyRemaining: 60 } });
    await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "SALE", docId: 9, docLineId: 9, qtyOut: 25, qtyProvisional: 25, at: T(5), createdBy: w.userId } });
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("35");
  });

  it("âm hẳn khi chỉ có dòng xuất treo (chưa có lớp nào)", async () => {
    const w = await newWorld();
    await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "SALE", docId: 9, docLineId: 9, qtyOut: 7.5, qtyProvisional: 7.5, at: T(5), createdBy: w.userId } });
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-7.5");
  });

  it("giữ độ chính xác Decimal (0,1 + 0,2 = 0,3, không lệch số thực)", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 0.1, 1);
    await rawLayer(w, 1, 0.2, 1);
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("0.3");
  });

  it("chỉ tính đúng kỳ và đúng mã hàng", async () => {
    const w = await newWorld(2);
    await rawLayer(w, 0, 100, 10);
    expect((await getOnHand(prisma, w.periodId, w.products[1]!.id)).toString()).toBe("0");
    expect((await getOnHand(prisma, w.periodId + 99, w.p.id)).toString()).toBe("0");
  });

  it("chạy được trong transaction (Tx)", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 12, 10);
    const v = await prisma.$transaction((tx) => getOnHand(tx, w.periodId, w.p.id));
    expect(v.toString()).toBe("12");
  });
});

describe("estimateCost — giá vốn tạm cho phần xuất thiếu hàng (spec 3.3)", () => {
  it("lấy giá lớp nhập GẦN NHẤT có at ≤ thời điểm xuất", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 10, 100);
    await rawLayer(w, 10, 10, 120);
    await rawLayer(w, 20, 10, 150);
    const price = (at: number) => prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(at)));
    expect((await price(5)).toString()).toBe("100");
    expect((await price(10)).toString()).toBe("120"); // lớp cùng thời điểm tính là "đã có"
    expect((await price(15)).toString()).toBe("120");
    expect((await price(99)).toString()).toBe("150");
  });

  it("chưa có lớp nào trước thời điểm xuất → lấy lớp nhập ĐẦU TIÊN; không có lớp nào → 0", async () => {
    const w = await newWorld();
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(0)))).toString()).toBe("0");
    await rawLayer(w, 50, 10, 200);
    await rawLayer(w, 60, 10, 300);
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(0)))).toString()).toBe("200");
  });

  it("bỏ qua lớp PHỤ THUỘC (trả hàng/thành phẩm) — không phải 'giá nhập'", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 10, 100);
    await rawLayer(w, 10, 5, 999, { ref: true });
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(20)))).toString()).toBe("100");
  });

  it("chỉ có lớp phụ thuộc → 0 (không dùng làm giá nhập)", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 5, 999, { ref: true });
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(20)))).toString()).toBe("0");
  });

  it("cùng thời điểm: lấy lớp có id lớn hơn; đúng mã hàng/kỳ", async () => {
    const w = await newWorld(2);
    await rawLayer(w, 5, 10, 100);
    await rawLayer(w, 5, 10, 110);
    const at = T(5);
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, at))).toString()).toBe("110");
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.products[1]!.id, at))).toString()).toBe("0");
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId + 99, w.p.id, at))).toString()).toBe("0");
  });
});
