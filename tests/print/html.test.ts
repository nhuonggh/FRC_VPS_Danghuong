import { Prisma } from "@prisma/client";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildHtmlPrint, combineInvoiceCuts, renderHtmlPrint, type HtmlPrintDocument } from "@/server/print/html-document";
import { moneyInWords } from "@/server/print/money-words";
import { getOrder } from "@/server/sales/queries";
import { getPurchase } from "@/server/purchase/queries";

vi.mock("@/server/company/queries", () => ({ getCompany: vi.fn(async () => ({ name: "Công ty thật", address: "Hà Nội", phone: "0901", taxCode: "", logo: "/logo.svg", bank: { accountNo: "123", bankName: "MB", accountHolder: "A", branch: "" } })) }));
vi.mock("@/server/print/contracts", () => ({ buildContract: vi.fn(async () => ({ docCode: "PG1", partner: { name: "Khách", phone: "", address: "", code: "KH1" }, doc: { code: "PG1", date: "19/10/2026", orderCode: "DH1" }, lines: [{ name: "Tôn", qty: "14", unit: "m", processing: "Xốp" }], totals: {} })) }));
vi.mock("@/server/sales/queries", () => ({ getOrder: vi.fn() }));
vi.mock("@/server/purchase/queries", () => ({ getPurchase: vi.fn() }));
vi.mock("@/server/deposits/status", () => ({ orderPaid: vi.fn(async () => new Prisma.Decimal(14000000)) }));
const actor = { userId: 2, perms: new Set(["print.use", "order.view"]) };

describe("HTML in trực tiếp", () => {
  it("hóa đơn cộng nợ cũ trước thời điểm lập đơn và trừ tiền gắn với đơn", async () => {
    vi.mocked(getOrder).mockResolvedValue({ partnerId: 1, orderDate: new Date("2026-10-01"), orderTotal: "14700000", shippingFee: "0", lines: [{ qty: "14", lineAmount: "14700000", note: null }] } as never);
    const aggregate = vi.fn(async () => ({ _sum: { debit: new Prisma.Decimal(5000000), credit: new Prisma.Decimal(2000000) } }));
    const db = { printTemplate: { findFirst: async () => null }, saleOrder: { findUniqueOrThrow: async () => ({ periodId: 1 }) }, openingDebt: { findFirst: async () => ({ amount: new Prisma.Decimal(27000000) }) }, partnerLedger: { aggregate } };
    const withDebt = { ...actor, perms: new Set(["print.use", "sale_price.view", "debt.view"]) };
    const model = await buildHtmlPrint(db as never, withDebt, "SALE_INVOICE", 1);
    expect(model.summary.find((r) => r.label === "Còn phải trả")?.value).toContain("30.700.000");
    expect(model.words).toBe("Ba mươi triệu bảy trăm nghìn đồng");
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ at: { lt: new Date("2026-10-01") } }) }));
    aggregate.mockClear();
    const withoutDebt = await buildHtmlPrint(db as never, { ...actor, perms: new Set(["print.use", "sale_price.view"]) }, "SALE_INVOICE", 1);
    expect(aggregate).not.toHaveBeenCalled();
    expect(withoutDebt.summary.some((r) => r.label === "Nợ cũ")).toBe(false);
    expect(withoutDebt.summary.at(-1)?.value).toContain("700.000");
  });
  it("phiếu nhập giữ nguyên tổng tiền hàng và không gán tiền chi NCC vào phiếu", async () => {
    vi.mocked(getPurchase).mockResolvedValue({ partnerId: 1, periodId: 1, at: new Date(), purchaseTotal: "4080000", freightCost: "200000", lines: [{ rollInfo: "C001" }] } as never);
    const db = { purchase: { findFirst: async () => ({ id: 1 }) }, printTemplate: { findFirst: async () => null } };
    const model = await buildHtmlPrint(db as never, { ...actor, perms: new Set(["print.use", "purchase_price.view"]) }, "PURCHASE_RECEIPT", 1);
    expect(model.summary.find((r) => r.label === "Tổng tiền hóa đơn")?.value).toContain("4.080.000");
    expect(model.summary.find((r) => r.label === "Thanh toán")?.value).toBe("—");
    expect(model.summary.find((r) => r.label === "Tổng phải trả")?.value).toBe("—");
  });
  it("gộp quy cách cùng hàng và giá, cộng tiền từ số liệu server thay vì nhân lại giá đã quy đổi", () => {
    const line = { code: "T1", name: "Tôn", processing: "Xốp", unit: "m²", price: "100" };
    const rows = combineInvoiceCuts([line, line, { ...line, price: "200" }], [
      { qty: "14", salePrice: "108", lineAmount: "1500", note: "7 m × 1,08 × 2 = 15,12 m²" },
      { qty: "3", salePrice: "108", lineAmount: "300", note: "3 m × 1,08 × 1 = 3,24 m²" },
      { qty: "3", salePrice: "216", lineAmount: "600", note: "3 m × 1,08 × 1 = 3,24 m²" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ qty: "18,36", pieces: "3", cuts: "7 m × 2 Tấm\n3 m × 1 Tấm" });
    expect(rows[0].amount).toContain("1.800");
  });
  it("chặn thiếu quyền trước khi đọc dữ liệu", async () => {
    await expect(buildHtmlPrint({} as never, { userId: 1, perms: new Set() }, "SALE_INVOICE", 1)).rejects.toThrow();
    await expect(buildHtmlPrint({} as never, actor, "SALE_INVOICE", 1)).rejects.toThrow();
  });
  it("phiếu nhập kiểm tra phạm vi NCC trước khi đọc DTO", async () => {
    const findFirst = vi.fn(async () => null);
    await expect(buildHtmlPrint({ purchase: { findFirst } } as never, { ...actor, perms: new Set(["print.use", "purchase_price.view"]) }, "PURCHASE_RECEIPT", 9)).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, partner: { ownerUserId: 2 } } }));
  });
  it("giao một phần không in toàn bộ số tấm của đơn gốc", async () => {
    const note = { lines: [{ qty: new Prisma.Decimal(14), orderLine: { qty: new Prisma.Decimal(28), note: "Ghi chú — 7 m × 1,08 × 4 = 30,24 m²" } }] };
    const model = await buildHtmlPrint({ printTemplate: { findFirst: async () => null }, deliveryNote: { findFirstOrThrow: async () => note } } as never, actor, "DELIVERY_NOTE", 1);
    expect(model.lines[0]).toMatchObject({ qty: "15,12", unit: "m²", issued: "14 m", note: "Ghi chú" });
    const html = renderHtmlPrint(model, true, true, "test-nonce");
    expect(() => new Script(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1])).not.toThrow();
    expect(html).not.toContain("4 Tấm");
    expect(html).not.toContain("Đơn giá");
    expect(html).toContain("window.print()");
    expect(html).toContain("document.fonts.ready");
    expect(html).toContain("thead{display:table-header-group}");
  });
  it.each(["SALE_INVOICE", "DELIVERY_NOTE", "PURCHASE_RECEIPT"] as const)("%s escape mọi dữ liệu và không giữ thông tin demo", (type) => {
    const model: HtmlPrintDocument = { type, body: { docCode: "X<script>", partner: null, doc: { date: "19/10/2026", note: '<img src=x onerror="alert(1)">' }, lines: [], totals: { total: "100" } }, company: { name: "Công ty", address: "", phone: "", taxCode: "", logo: "javascript:alert(1)", bank: { bankName: "", accountHolder: "", accountNo: "", branch: "" }, version: 1 }, signer: "", footer: "", qr: "", lines: [{ name: "<script>alert(1)</script>", note: "", qty: "1", price: "100", amount: "100" }], summary: [], words: "", notices: [] };
    const html = renderHtmlPrint(model, false, false, "nonce");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("THẬP THẢO");
    expect(html).not.toContain("Bùi Thị");
    expect(html).toContain('nonce="nonce"');
    expect(html).not.toContain("ready().then");
  });
  it.each([["0", "Không đồng"], ["30700000", "Ba mươi triệu bảy trăm nghìn đồng"], ["351499000", "Ba trăm năm mươi mốt triệu bốn trăm chín mươi chín nghìn đồng"], ["1000001", "Một triệu không trăm lẻ một đồng"], ["-15", "Âm mười lăm đồng"]])("số tiền bằng chữ %s", (input, output) => expect(moneyInWords(input)).toBe(output));
});
