import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildContract } from "@/server/print/contracts";
import { getReturn } from "@/server/returns/queries";
import { getProductionOrder } from "@/server/production/queries";
import { getStocktake } from "@/server/stocktake/queries";
import { getLossAdjust } from "@/server/stock-adjust/service";

vi.mock("@/server/returns/queries", () => ({ getReturn: vi.fn() }));
vi.mock("@/server/production/queries", () => ({ getProductionOrder: vi.fn() }));
vi.mock("@/server/stocktake/queries", () => ({ getStocktake: vi.fn(), STOCKTAKE_LABEL: { DRAFT: "Nháp", DONE: "Đã chốt", CANCELLED: "Đã hủy" } }));
vi.mock("@/server/stock-adjust/service", () => ({ getLossAdjust: vi.fn() }));
vi.mock("@/server/supplier-orders/service", () => ({ orderInclude: {}, progress: vi.fn(() => "SENT") }));
vi.mock("@/server/debt/queries", () => ({}));
vi.mock("@/server/purchase/queries", () => ({}));
vi.mock("@/server/quotes/queries", () => ({}));
vi.mock("@/server/sales/queries", () => ({}));
vi.mock("@/server/cash/queries", () => ({}));
vi.mock("@/server/trips/queries", () => ({}));
vi.mock("@/server/deposits/status", () => ({}));
const actor = { userId: 1, perms: new Set(["print.use"]) };
const settlement = { code: "TT1", partnerId: 3, method: "OFFSET", amount: new Prisma.Decimal(70000), at: new Date("2026-10-20"), note: null, createdBy: 1, isCancelled: false, payment: null };
const order = { code: "DN1", partnerId: 3, date: new Date("2026-10-20"), note: "", creator: { fullName: "D" }, lines: [{ qty: new Prisma.Decimal(10), unit: "kg", purchasePrice: new Prisma.Decimal(20000), processingTypeId: null, expectedDate: new Date("2026-10-30"), note: "", product: { code: "N1", name: "Tôn" } }] };
const db = { discountSettlement: { findFirst: async () => settlement }, supplierOrder: { findFirst: async () => order }, processingType: { findMany: async () => [] }, user: { findUnique: async () => ({ fullName: "Kế toán" }) }, goodsReturn: { findUnique: async () => ({ partnerId: 3 }) }, partner: { findUnique: async () => ({ code: "K1", name: "Khách", phone: null, address: null }) } };

describe("contract các phiếu mới (không lộ giá vốn)", () => {
  it("phiếu trả hàng khách: tiền hàng trừ khấu trừ", async () => {
    vi.mocked(getReturn).mockResolvedValue({ code: "TH1", kind: "BY_ORDER", at: new Date("2026-10-20"), orderCode: "DH1", note: null, createdByName: "A", isCancelled: false, returnTotal: "1000000", returnDeduction: "100000", deductionNote: "Cước", lines: [{ productCode: "T1", productName: "Tôn", unit: "m", qty: "10", note: null, salePrice: "100000", lineAmount: "1000000" }] } as never);
    const c = await buildContract(db as never, actor, "GOODS_RETURN", 1);
    expect(c.doc).toMatchObject({ kind: "Khách trả hàng", orderCode: "DH1" });
    expect(c.totals).toMatchObject({ deduction: expect.stringContaining("100.000"), net: expect.stringContaining("900.000") });
    expect(c.partner?.name).toBe("Khách");
  });
  it("phiếu trả NCC dùng giá nhập", async () => {
    vi.mocked(getReturn).mockResolvedValue({ code: "TN1", kind: "SUPPLIER", at: new Date("2026-10-20"), orderCode: null, note: null, createdByName: null, isCancelled: false, purchaseTotal: "500000", lines: [{ productCode: "T1", productName: "Tôn", unit: "m", qty: "5", note: null, purchasePrice: "100000", purchaseAmount: "500000" }] } as never);
    const c = await buildContract(db as never, actor, "GOODS_RETURN", 1);
    expect(c.doc.kind).toBe("Trả nhà cung cấp"); expect(c.lines[0].amount).toContain("500.000"); expect(c.totals.deduction).toBe("");
  });
  it("lệnh sản xuất: thành phẩm + NVL, không có giá thành", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue({ code: "SX1", at: new Date("2026-10-20"), note: null, createdByName: "B", isCancelled: false, totalCost: "999", unitCost: "9", outputs: [{ productCode: "P1", productName: "Phụ kiện", qty: "10", baseUnit: "cái", widthMm: "120", stripCount: 2, lengthM: null }], materials: [{ productCode: "N1", productName: "Tôn cuộn", baseUnit: "kg", qty: "30", unitCost: "5" }] } as never);
    const c = await buildContract(db as never, actor, "PRODUCTION_ORDER", 1);
    expect(c.lines.map((l) => l.section)).toEqual(["Thành phẩm", "Nguyên vật liệu tiêu hao"]);
    expect(c.lines[0].spec).toBe("Khổ 120 mm · 2 dải");
    expect(JSON.stringify(c)).not.toMatch(/999|"5"/);
  });
  it("kiểm kho: tồn sổ sách, thực đếm, chênh lệch; không có giá", async () => {
    vi.mocked(getStocktake).mockResolvedValue({ code: "KK1", at: new Date("2026-10-20"), status: "DONE", note: null, createdByName: "C", lines: [{ productCode: "P1", productName: "Tôn", baseUnit: "m", actualQty: "9", systemQty: "10", diff: "-1", unitCost: "777" }] } as never);
    const c = await buildContract(db as never, actor, "STOCKTAKE", 1);
    expect(c.doc.statusLabel).toBe("Đã chốt"); expect(c.lines[0]).toMatchObject({ no: "1", systemQty: "10", actualQty: "9", diff: "-1" });
    expect(JSON.stringify(c)).not.toContain("777");
  });
});

describe("contract hao hụt / tất toán chiết khấu / đặt hàng NCC", () => {
  it("hao hụt: không có giá vốn dù người xem có quyền cost.view", async () => {
    vi.mocked(getLossAdjust).mockResolvedValue({ code: "HH1", type: "LOSS", at: new Date("2026-10-20"), note: "Gió thổi", createdByName: "A", isCancelled: false, lines: [{ productCode: "P1", productName: "Tôn", baseUnit: "m", qty: "2", cost: "123456" }] } as never);
    const c = await buildContract(db as never, actor, "LOSS_ADJUST", 1);
    expect(c.doc).toMatchObject({ kind: "Hao hụt", note: "Gió thổi" }); expect(JSON.stringify(c)).not.toContain("123456");
  });
  it("tất toán chiết khấu: hình thức, số tiền, người lập", async () => {
    const c = await buildContract(db as never, actor, "DISCOUNT_SETTLEMENT", 1);
    expect(c.doc).toMatchObject({ method: "Trừ vào công nợ", createdBy: "Kế toán" }); expect(c.totals.amount).toContain("70.000");
  });
  it("đặt hàng NCC: thành tiền = SL × giá, ghi ngày dự kiến nhận", async () => {
    const c = await buildContract(db as never, actor, "SUPPLIER_ORDER", 1);
    expect(c.lines[0]).toMatchObject({ qty: "10", amount: expect.stringContaining("200.000"), note: expect.stringContaining("Dự kiến nhận") }); expect(c.totals.total).toContain("200.000");
  });
});
