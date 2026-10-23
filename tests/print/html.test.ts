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
    const db = { printTemplate: { findFirst: async () => null }, saleOrder: { findUniqueOrThrow: async () => ({ periodId: 1, printDebt: true }) }, openingDebt: { findFirst: async () => ({ amount: new Prisma.Decimal(27000000) }) }, partnerLedger: { aggregate } };
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
    // Đơn tắt "In công nợ": có quyền xem nợ vẫn không in nợ cũ; chữ ký kế toán là người lập đơn.
    vi.mocked(getOrder).mockResolvedValue({ partnerId: 1, orderDate: new Date("2026-10-01"), orderTotal: "14700000", shippingFee: "0", createdByName: "Phượng", lines: [{ qty: "14", lineAmount: "14700000", note: null }] } as never);
    const hidden = await buildHtmlPrint({ ...db, saleOrder: { findUniqueOrThrow: async () => ({ periodId: 1, printDebt: false }) } } as never, withDebt, "SALE_INVOICE", 1);
    expect(hidden.summary.some((r) => r.label === "Nợ cũ")).toBe(false);
    expect(hidden.signer).toBe("Phượng");
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

describe("HTML in: các phiếu còn lại", () => {
  const company = { name: "Công ty", address: "HN", phone: "09", taxCode: "", logo: "", bank: { bankName: "", accountHolder: "", accountNo: "", branch: "" }, version: 1 };
  const base = (type: string, body: Partial<HtmlPrintDocument["body"]>, extra: Partial<HtmlPrintDocument> = {}): HtmlPrintDocument => ({ type, body: { docCode: "X1", partner: { code: "K1", name: "Khách A", phone: "0909", address: "HN" }, doc: { date: "20/10/2026" }, lines: [], totals: {}, ...body }, company, signer: "", footer: "", qr: "", lines: body.lines ?? [], summary: [], words: "", notices: [], ...extra });
  it("phiếu thu/chi: không có bảng, hiện số tiền và tiền bằng chữ", () => {
    const html = renderHtmlPrint(base("RECEIPT", { doc: { date: "20/10/2026", type: "Thu công nợ", account: "Quỹ TM" }, totals: { amount: "1.500.000" } }, { summary: [{ label: "Số tiền", value: "1.500.000", big: true }], words: moneyInWords("1500000") }), false, false, "n");
    expect(html).toContain("PHIẾU THU"); expect(html).toContain("Người nộp tiền"); expect(html).toContain("Một triệu năm trăm nghìn đồng"); expect(html).not.toContain("<table");
    expect(renderHtmlPrint(base("PAYMENT", { doc: { date: "x" } }), false, false, "n")).toContain("Người nhận tiền");
  });
  it("công nợ, chuyến, lệnh SX, kiểm kho, báo giá, trả hàng có đúng tiêu đề và cột", () => {
    const debt = renderHtmlPrint(base("DEBT_STATEMENT", {}, { lines: [{ no: "1", date: "01/10/2026", docLabel: "Đơn bán", docCode: "DH1", debit: "100", credit: "", running: "100" }] }), true, false, "n");
    expect(debt).toContain("BIÊN BẢN ĐỐI CHIẾU CÔNG NỢ"); expect(debt).toContain("Phát sinh tăng"); expect(debt).toContain("DH1");
    const trip = renderHtmlPrint(base("TRIP_SHEET", { partner: null, doc: { date: "d", vehicle: "51C-1", driver: "Lái A" }, totals: { stops: "2" } }, { lines: [{ stop: "1", customer: "Khách B", phone: "", address: "Q12", order: "DH2", no: "1", code: "T1", name: "Tôn", unit: "m", qty: "5", due: "1.000" }, { stop: "2", customer: "Khách C", phone: "", address: "", order: "DH3", no: "1", code: "T2", name: "Xà gồ", unit: "cây", qty: "2", due: "" }] }), false, false, "n");
    expect(trip).toContain("PHIẾU GIAO NHẬN THEO CHUYẾN"); expect(trip).toContain("Điểm 1: Khách B"); expect(trip).toContain("Cần thu: 1.000"); expect(trip).toContain("Điểm 2: Khách C"); expect(trip).toContain("51C-1");
    const prod = renderHtmlPrint(base("PRODUCTION_ORDER", { partner: null }, { lines: [{ section: "Thành phẩm", no: "1", code: "P1", name: "Phụ kiện", spec: "", unit: "cái", qty: "10" }, { section: "Nguyên vật liệu tiêu hao", no: "1", code: "N1", name: "Tôn cuộn", spec: "", unit: "kg", qty: "30" }] }), false, false, "n");
    expect(prod).toContain("LỆNH SẢN XUẤT"); expect(prod).toContain("Nguyên vật liệu tiêu hao"); expect(prod).toContain("Thợ sản xuất");
    const st = renderHtmlPrint(base("STOCKTAKE", { partner: null, doc: { date: "d", statusLabel: "Đã chốt" } }, { lines: [{ no: "1", code: "P1", name: "Tôn", unit: "m", systemQty: "10", actualQty: "9", diff: "-1" }] }), false, false, "n");
    expect(st).toContain("PHIẾU KIỂM KHO"); expect(st).toContain("Tồn sổ sách"); expect(st).toContain("Đã chốt");
    const quote = renderHtmlPrint(base("QUOTE", { totals: { total: "5" } }, { lines: [{ name: "Tôn", qty: "1", unit: "m", price: "5", amount: "5", note: "", processing: "" }] }), false, false, "n");
    expect(quote).toContain("BÁO GIÁ"); expect(quote).toContain("Người lập báo giá"); expect(quote).not.toContain("Quét để thanh toán");
    const ret = renderHtmlPrint(base("GOODS_RETURN", { doc: { date: "d", kind: "Trả nhà cung cấp", orderCode: "" } }), false, false, "n");
    expect(ret).toContain("PHIẾU TRẢ HÀNG"); expect(ret).toContain("Nhà cung cấp:");
  });
  it("hao hụt / tất toán chiết khấu / đặt hàng NCC có đúng tiêu đề", () => {
    expect(renderHtmlPrint(base("LOSS_ADJUST", { partner: null, doc: { date: "d", kind: "Xuất hủy", createdBy: "A" } }, { lines: [{ no: "1", code: "P1", name: "Tôn", unit: "m", qty: "2" }] }), false, false, "n")).toContain("PHIẾU XUẤT HỦY");
    expect(renderHtmlPrint(base("LOSS_ADJUST", { partner: null, doc: { date: "d", kind: "Hao hụt" } }), false, false, "n")).toContain("PHIẾU HAO HỤT");
    const settle = renderHtmlPrint(base("DISCOUNT_SETTLEMENT", { doc: { date: "d", method: "Chuyển vào lãi công ty" }, totals: { amount: "70.000" } }, { summary: [{ label: "Số tiền tất toán", value: "70.000", big: true }], words: moneyInWords("70000") }), false, false, "n");
    expect(settle).toContain("PHIẾU TẤT TOÁN CHIẾT KHẤU"); expect(settle).toContain("Bảy mươi nghìn đồng"); expect(settle).not.toContain("<table");
    const po = renderHtmlPrint(base("SUPPLIER_ORDER", { totals: { total: "200.000" } }, { lines: [{ name: "Tôn", qty: "10", unit: "kg", price: "20.000", amount: "200.000", note: "", processing: "" }] }), false, false, "n");
    expect(po).toContain("ĐƠN ĐẶT HÀNG NHÀ CUNG CẤP"); expect(po).toContain("Nhà cung cấp:"); expect(po).toContain("Nhà cung cấp xác nhận"); expect(po).toContain("Thành tiền");
  });
  it("escape dữ liệu ở nhóm bảng riêng", () => {
    const html = renderHtmlPrint(base("TRIP_SHEET", { partner: null }, { lines: [{ stop: "1", customer: "<b>x</b>", phone: "", address: "", order: "", no: "1", code: "", name: "<script>1</script>", unit: "", qty: "", due: "" }] }), false, false, "n");
    expect(html).not.toContain("<script>1</script>"); expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("lệnh in thiếu quyền loại phiếu bị chặn trước khi đọc dữ liệu", async () => {
    await expect(buildHtmlPrint({} as never, { userId: 1, perms: new Set(["print.use"]) }, "STOCKTAKE", 1)).rejects.toThrow();
  });
});
