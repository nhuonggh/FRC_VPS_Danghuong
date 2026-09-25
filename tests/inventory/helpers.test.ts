import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, newWorld, T, type World } from "./helpers";

beforeEach(resetDb);

const ledgerIn = (w: World, qty: number, at = 0, docId = 1, productId = w.p.id) =>
  prisma.stockLedger.create({
    data: { periodId: w.periodId, productId, docType: "PURCHASE", docId, docLineId: docId, qtyIn: qty, at: T(at), createdBy: w.userId },
  });

const layer = (w: World, ledgerId: number, qtyIn: number, qtyRemaining: number, at = 0, productId = w.p.id) =>
  prisma.costLayer.create({
    data: { periodId: w.periodId, productId, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId, qtyIn, qtyRemaining, unitCost: 5, at: T(at) },
  });

const ledgerOut = (w: World, qty: number, prov = 0, at = 10, docId = 100, productId = w.p.id) =>
  prisma.stockLedger.create({
    data: { periodId: w.periodId, productId, docType: "SALE", docId, docLineId: docId, qtyOut: qty, qtyProvisional: prov, at: T(at), createdBy: w.userId },
  });

const consume = (w: World, layerId: number, ledgerId: number, qty: number) =>
  prisma.costConsumption.create({ data: { layerId, ledgerId, docType: "SALE", docLineId: 1, qty, unitCost: 5 } });

describe("newWorld", () => {
  it("dựng user + kỳ mở từ 01/08/2026 + số mã hàng yêu cầu (mặc định 1)", async () => {
    const w = await newWorld();
    expect(w.products).toHaveLength(1);
    expect(w.p.id).toBe(w.products[0]!.id);
    expect(w.period.openedAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.period.isOpen).toBe(true);
  });

  it("newWorld(3) tạo 3 mã hàng khác nhau; T(n) = n phút sau 01/09/2026 00:00Z", async () => {
    const w = await newWorld(3);
    expect(new Set(w.products.map((p) => p.id)).size).toBe(3);
    expect(T(0).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(T(90).toISOString()).toBe("2026-09-01T01:30:00.000Z");
    expect(T(0).getTime()).toBeGreaterThan(w.period.openedAt.getTime());
  });
});

describe("assertLedgerBalanced — sổ cân thì im lặng", () => {
  it("sổ rỗng và sổ nhập đơn giản thì cân", async () => {
    const w = await newWorld();
    await assertLedgerBalanced(w.p.id, w.periodId);
    const l = await ledgerIn(w, 10);
    await layer(w, l.id, 10, 10);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("có xuất ăn 1 phần lớp + một phần treo thì cân", async () => {
    const w = await newWorld();
    const l = await ledgerIn(w, 10);
    const ly = await layer(w, l.id, 10, 0); // lớp cạn
    const o = await ledgerOut(w, 14, 4); // xuất 14: ăn 10, treo 4
    await consume(w, ly.id, o.id, 10);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("chỉ xét đúng (mã hàng, kỳ) được hỏi: sổ lệch của mã KHÁC không làm mã này đỏ", async () => {
    const w = await newWorld(2);
    const other = w.products[1]!;
    const l = await ledgerIn(w, 10, 0, 1, other.id);
    await layer(w, l.id, 10, 7, 0, other.id); // mã 2 lệch
    await assertLedgerBalanced(w.p.id, w.periodId); // mã 1 rỗng → cân
    await expect(assertLedgerBalanced(other.id, w.periodId)).rejects.toThrow();
  });
});

describe("assertLedgerBalanced — PHÁT HIỆN sổ lệch (checker có răng)", () => {
  it("(1)+(2) lớp bị trừ mà không có consumption", async () => {
    const w = await newWorld();
    const l = await ledgerIn(w, 10);
    await layer(w, l.id, 10, 7);
    await expect(assertLedgerBalanced(w.p.id, w.periodId)).rejects.toThrow();
  });

  it("(1) tổng nhập − xuất ≠ tồn lớp − treo: có dòng xuất mà lớp không giảm, không consumption, không treo", async () => {
    const w = await newWorld();
    const l = await ledgerIn(w, 10);
    await layer(w, l.id, 10, 10);
    await ledgerOut(w, 3, 0);
    await expect(assertLedgerBalanced(w.p.id, w.periodId)).rejects.toThrow(/Σin − Σout/);
  });

  it("(2) từng lớp: tổng khớp nhưng consumption ăn sai lớp → lớp báo lệch", async () => {
    const w = await newWorld();
    const l1 = await ledgerIn(w, 10, 0, 1);
    const l2 = await ledgerIn(w, 10, 1, 2);
    const a = await layer(w, l1.id, 10, 10, 0); // đáng lẽ đã bị ăn hết
    await layer(w, l2.id, 10, 0, 1); // nhưng lại ghi lớp 2 cạn
    const o = await ledgerOut(w, 10);
    await consume(w, a.id, o.id, 10); // consumption trỏ lớp 1
    // Σin−Σout = 10 ; Σremaining = 10 → (1) đúng; (3) đúng; chỉ (2) sai
    await expect(assertLedgerBalanced(w.p.id, w.periodId)).rejects.toThrow(/lớp \d+: remaining = in − Σconsumption/);
  });

  it("(3) từng dòng xuất: 2 dòng lệch bù trừ nhau (tổng đúng) → vẫn bắt được dòng lệch", async () => {
    const w = await newWorld();
    const l = await ledgerIn(w, 10);
    const ly = await layer(w, l.id, 10, 4);
    const o1 = await ledgerOut(w, 4, 0, 10, 100); // consumption chỉ 3 (thiếu 1)
    const o2 = await ledgerOut(w, 2, 0, 11, 101); // consumption 3 (dư 1)
    await consume(w, ly.id, o1.id, 3);
    await consume(w, ly.id, o2.id, 3);
    // (1): 10 − 6 = 4 = 4 − 0 ; (2): 10 − 6 = 4 ✓ ; chỉ (3) sai
    await expect(assertLedgerBalanced(w.p.id, w.periodId)).rejects.toThrow(/dòng xuất \d+: Σconsumption \+ provisional = qtyOut/);
  });

  it("(3) dòng xuất khai qtyProvisional nhưng consumption vẫn ăn đủ → lệch", async () => {
    const w = await newWorld();
    const l = await ledgerIn(w, 10);
    const ly = await layer(w, l.id, 10, 5);
    const o = await ledgerOut(w, 5, 2); // treo 2 nhưng consumption 5
    await consume(w, ly.id, o.id, 5);
    await expect(assertLedgerBalanced(w.p.id, w.periodId)).rejects.toThrow();
  });
});
