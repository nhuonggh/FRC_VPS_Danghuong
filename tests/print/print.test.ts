import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createPayment, createReceipt } from "@/server/cash/vouchers";
import { paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { encryptSecret } from "@/server/company/secret";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNote } from "@/server/delivery/service";
import { quoteSchema } from "@/server/quotes/schemas";
import { createQuote } from "@/server/quotes/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { buildContract } from "@/server/print/contracts";
import { getLastPrint, printDocument } from "@/server/print/service";
import { PRINT_DOCS } from "@/server/print/types";
import { assertWebhookUrl, callPrintWebhook, isAllowedFileUrl } from "@/server/print/webhook";
import { tripSchema } from "@/server/trips/schemas";
import { createTrip } from "@/server/trips/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
const NOW = new Date("2026-09-15T03:00:00Z");
const SECRET = "s3cret-Value-XYZ-123";
const HOOK = "https://script.google.com/macros/s/AKfycbxDEPLOYMENT/exec?key=QUERYKEY";
const ALL = ["print.use", "sale_price.view", "order.view", "order.create", "order.edit_price", "receipt.manage", "payment.manage", "cash.transaction.create", "debt.view", "purchase_price.view", "trip.manage", "partner.view_all", "quote.manage", "order.edit"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let customer: { id: number }; let cash: { id: number };
let n = 0;
type Call = { url: string; method: string; body: Record<string, unknown> | null };
const ok = (fileId: string) => new Response(JSON.stringify({ ok: true, fileId, url: `https://docs.google.com/document/d/${fileId}/edit`, name: `n-${fileId}` }), { status: 200 });
function mockFetch(handler: (c: Call, i: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => { const c = { url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null }; calls.push(c); return handler(c, calls.length - 1); };
  return { calls, fetchImpl };
}
const tpl = (over: Record<string, unknown> = {}) => prisma.printTemplate.create({ data: { docType: "SALE_INVOICE", name: "Mẫu A4", webhookUrl: HOOK, secretCiphertext: encryptSecret(SECRET), isActive: true, title: "HÓA ĐƠN BÁN HÀNG", signerName: "Nguyễn Hương", phone: "0909", footerNote: "Cảm ơn quý khách", ...over } });
const order = () => createSaleOrderIdempotent(prisma, actor, `p-${++n}`, saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-16", note: "Giao buổi sáng", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, discountNow: 10_000, discountAccum: 20_000, processingTypeId: null, note: "" }] }), NOW);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(ALL) };
  customer = await makePartner({ isCustomer: true, name: "Khách Đạt", searchText: "khach dat", address: "Q12", phone: "0912" });
  cash = await makeCashAccount({ name: "Tiền mặt" });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("data contract 13 mẫu", () => {
  it("hóa đơn bán hàng: công ty (theo cờ), khách, dòng có chiết khấu theo dòng + tổng chiết khấu, đã thu, còn phải trả; có version", async () => {
    const o = await order();
    await tx((t) => createReceipt(t, actor, receiptSchema.parse({ type: "THU_NO", partnerId: customer.id, orderId: o.id, cashAccountId: cash.id, amount: 50_000, date: "2026-09-15", note: "" }), NOW));
    const b = await buildContract(prisma, actor, "SALE_INVOICE", o.id, NOW);
    expect(b.doc).toMatchObject({ code: o.code, note: "Giao buổi sáng" });
    expect(b.partner).toEqual({ code: expect.any(String), name: "Khách Đạt", phone: "0912", address: "Q12" });
    expect(b.lines[0]).toMatchObject({ no: "1", qty: "4", discountNow: expect.stringContaining("10.000"), discountAccum: expect.stringContaining("20.000") });
    expect(b.totals).toMatchObject({ total: expect.stringContaining("190.000"), paid: expect.stringContaining("50.000"), remaining: expect.stringContaining("140.000"), discountNow: expect.stringContaining("10.000"), discountAccum: expect.stringContaining("20.000") });
    const lines = b.lines[0]!; expect(JSON.stringify(b)).not.toMatch(/unitCost|lineProfit|10\.000\s*₫?.*giá vốn/);
    expect(lines.name).toBeTruthy();
  });
  it("báo giá, phiếu giao, phiếu thu/chi, phiếu nhập, đối chiếu công nợ, phiếu giao chuyến đều dựng được", async () => {
    const q = await tx((t) => createQuote(t, actor, quoteSchema.parse({ partnerId: customer.id, date: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 2, salePrice: 60_000, note: "" }] }), NOW));
    expect((await buildContract(prisma, actor, "QUOTE", q.id, NOW)).totals.total).toContain("120.000");
    const o = await order(); const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.id } });
    const note = await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: 4 }] }), NOW));
    const dn = await buildContract(prisma, actor, "DELIVERY_NOTE", note.id, NOW);
    expect(dn.doc.orderCode).toBe(o.code); expect(dn.lines).toHaveLength(1); expect(JSON.stringify(dn)).not.toMatch(/₫/); // phiếu giao không có tiền
    const r = await tx((t) => createReceipt(t, actor, receiptSchema.parse({ type: "THU_NO", partnerId: customer.id, orderId: null, cashAccountId: cash.id, amount: 70_000, date: "2026-09-15", note: "" }), NOW));
    expect((await buildContract(prisma, actor, "RECEIPT", r.id, NOW)).totals.amount).toContain("70.000");
    const supplier = await makePartner({ isCustomer: false, isSupplier: true });
    const p = await tx((t) => createPayment(t, actor, paymentSchema.parse({ kind: "TRA_NCC", partnerId: supplier.id, cashAccountId: cash.id, amount: 30_000, date: "2026-09-15", note: "" }), NOW));
    expect((await buildContract(prisma, actor, "PAYMENT", p.id, NOW)).partner?.name).toBe((await prisma.partner.findUniqueOrThrow({ where: { id: supplier.id } })).name);
    const st = await buildContract(prisma, actor, "DEBT_STATEMENT", customer.id, NOW);
    expect(st.lines.length).toBeGreaterThan(0); expect(st.totals.balance).toBeTruthy();
    const v = await prisma.vehicle.create({ data: { plate: "51C-1" } }); const d = await prisma.driver.create({ data: { name: "Lái A" } });
    const tripOrder = await order();
    const trip = await tx((t) => createTrip(t, actor, tripSchema.parse({ date: "2026-09-16", routeId: null, vehicleId: v.id, driverId: d.id, assistantId: null, note: "", orderIds: [tripOrder.id] }), NOW));
    const ts = await buildContract(prisma, actor, "TRIP_SHEET", trip.id, NOW);
    expect(ts.doc).toMatchObject({ vehicle: "51C-1", driver: "Lái A" }); expect(ts.lines[0]).toMatchObject({ customer: "Khách Đạt", address: "Q12" });
    await expect(buildContract(prisma, actor, "UNKNOWN", 1, NOW)).rejects.toMatchObject({ code: "PRINT_UNSUPPORTED" });
    expect(PRINT_DOCS.filter((x) => x.code.startsWith("M") && !x.code.endsWith("b"))).toHaveLength(13);
  });
  it("người thiếu quyền giá không in được hóa đơn/báo giá; không thấy chứng từ của khách người khác", async () => {
    const o = await order();
    const noPrice: Actor = { userId: actor.userId, perms: new Set(["print.use", "order.view", "partner.view_all"]) };
    await tpl();
    await expect(printDocument(prisma, noPrice, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: mockFetch(() => ok("F1")).fetchImpl })).rejects.toMatchObject({ status: 403 });
    await expect(printDocument(prisma, { userId: 1, perms: new Set(["order.view"]) }, "SALE_INVOICE", o.id)).rejects.toMatchObject({ status: 403 }); // thiếu print.use
    const mine: Actor = { userId: actor.userId, perms: new Set(["print.use", "sale_price.view", "order.view"]) }; // không partner.view_all
    await expect(printDocument(prisma, mine, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: mockFetch(() => ok("F1")).fetchImpl })).rejects.toMatchObject({ status: 404 });
  });
});

describe("gọi webhook Apps Script (D-38)", () => {
  it("gửi secret + contract trong BODY; nhận file; lưu print_files; audit/DTO/lỗi không chứa secret hay query của URL", async () => {
    const o = await order(); await tpl();
    const m = mockFetch(() => ok("FILE1"));
    const r = await printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: m.fetchImpl });
    expect(r).toMatchObject({ url: "https://docs.google.com/document/d/FILE1/edit", replaced: false });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toContain("script.google.com"); expect(m.calls[0]!.method).toBe("POST");
    expect(m.calls[0]!.body).toMatchObject({ version: 1, secret: SECRET, action: "create", docType: "SALE_INVOICE", docId: o.id, replaceFileId: null, template: { title: "HÓA ĐƠN BÁN HÀNG", signerName: "Nguyễn Hương", footerNote: "Cảm ơn quý khách" }, company: { name: expect.any(String) } });
    const stored = await prisma.printFile.findMany(); expect(stored).toHaveLength(1);
    const dump = JSON.stringify([await prisma.auditLog.findMany(), stored, r, await getLastPrint(prisma, actor, "SALE_INVOICE", o.id)]);
    expect(dump).not.toContain(SECRET); expect(dump).not.toContain("QUERYKEY"); expect(dump).not.toContain("secretCiphertext");
  });
  it("mẫu tắt cờ hiện thông tin công ty ⇒ company = null", async () => {
    const o = await order(); await tpl({ showCompanyInfo: false });
    const m = mockFetch(() => ok("F")); await printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: m.fetchImpl });
    expect(m.calls[0]!.body!.company).toBeNull();
  });
  it("in lại: gửi replaceFileId của bản cũ và chỉ giữ MỘT dòng; lần in lỗi giữ nguyên bản cũ", async () => {
    const o = await order(); await tpl();
    await printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: mockFetch(() => ok("OLD")).fetchImpl });
    const m = mockFetch(() => ok("NEW"));
    expect((await printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: m.fetchImpl })).replaced).toBe(true);
    expect(m.calls[0]!.body!.replaceFileId).toBe("OLD");
    expect((await prisma.printFile.findMany()).map((f) => f.fileId)).toEqual(["NEW"]);
    const bad = mockFetch(() => new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 200 }));
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: bad.fetchImpl })).rejects.toMatchObject({ code: "PRINT_REMOTE_ERROR" });
    expect((await prisma.printFile.findMany()).map((f) => f.fileId)).toEqual(["NEW"]);
  });
  it("[R] hai người in cùng lúc: còn đúng một bản, bản mồ côi được yêu cầu xoá", async () => {
    const o = await order(); await tpl();
    let k = 0; let arrived = 0; let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    // hàng rào: cả hai lần in đã đọc "chưa có bản cũ" và đã gọi webhook thì mới cho trả về ⇒ cùng tranh ghi print_files
    const m = mockFetch(async (c) => {
      if (c.body?.action === "delete") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      const id = `F${++k}`; if (++arrived === 2) release(); await gate; return ok(id);
    });
    await Promise.all([printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: m.fetchImpl }), printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: m.fetchImpl })]);
    const rows = await prisma.printFile.findMany(); expect(rows).toHaveLength(1);
    const deletes = m.calls.filter((c) => c.body?.action === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.body!.fileId).not.toBe(rows[0]!.fileId);
    expect(["F1", "F2"]).toContain(deletes[0]!.body!.fileId);
  });
  it("timeout 12 s (thu nhỏ khi test), lỗi mạng, lỗi HTTP, không phải JSON, file URL lạ: lỗi rõ ràng, không lộ secret/URL", async () => {
    const o = await order(); await tpl();
    const hang = mockFetch((_c) => new Promise<Response>(() => undefined));
    const abortable = async (_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: abortable, timeoutMs: 40 })).rejects.toMatchObject({ code: "PRINT_TIMEOUT", status: 504 });
    void hang;
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => { throw new Error(`ECONNRESET ${SECRET} ${HOOK}`); }, "PRINT_NETWORK"],
      [() => new Response("no", { status: 500 }), "PRINT_HTTP"],
      [() => new Response("<html>login</html>", { status: 200 }), "PRINT_BAD_RESPONSE"],
      [() => new Response(JSON.stringify({ ok: true, fileId: "X", url: "https://evil.example.com/x" }), { status: 200 }), "PRINT_BAD_RESPONSE"],
      [() => new Response(JSON.stringify({ ok: false, error: `lỗi ${SECRET} tại https://script.google.com/x?k=1` }), { status: 200 }), "PRINT_REMOTE_ERROR"],
    ];
    for (const [h, code] of cases) {
      const err = await printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: mockFetch(h).fetchImpl }).then(() => null, (e: unknown) => e as { code: string; message: string });
      expect(err?.code).toBe(code);
      expect(err!.message).not.toContain(SECRET); expect(err!.message).not.toContain("QUERYKEY"); expect(err!.message).not.toContain("script.google.com");
    }
    expect(await prisma.printFile.count()).toBe(0);
  });
  it("chỉ gọi Google Apps Script: webhook lạ bị chặn (không gọi fetch); chuyển hướng chỉ tới host Google; theo 302 sang script.googleusercontent.com", async () => {
    const o = await order(); const t = await tpl({ webhookUrl: "https://evil.example.com/hook" });
    const none = mockFetch(() => ok("F"));
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: none.fetchImpl })).rejects.toMatchObject({ code: "PRINT_BAD_WEBHOOK" });
    expect(none.calls).toHaveLength(0);
    await prisma.printTemplate.update({ where: { id: t.id }, data: { webhookUrl: HOOK } });
    const evil = mockFetch(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: evil.fetchImpl })).rejects.toMatchObject({ code: "PRINT_BAD_WEBHOOK" });
    const hop = mockFetch((c, i) => (i === 0 ? new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=abc" } }) : (expect(c.method).toBe("GET"), ok("VIAREDIRECT"))));
    expect((await printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: hop.fetchImpl })).url).toContain("VIAREDIRECT");
    expect(hop.calls).toHaveLength(2);
    expect(assertWebhookUrl("https://script.google.com/macros/s/x/exec").hostname).toBe("script.google.com");
    expect(() => assertWebhookUrl("http://script.google.com/x")).toThrow(); expect(isAllowedFileUrl("https://drive.google.com/file/d/1/view")).toBe(true); expect(isAllowedFileUrl("javascript:alert(1)")).toBe(false);
    await expect(callPrintWebhook(HOOK, { secret: SECRET }, { fetchImpl: mockFetch(() => ok("A")).fetchImpl })).resolves.toMatchObject({ fileId: "A" });
  });
  it("chưa bật/thiếu cấu hình mẫu: thông báo cách cấu hình; loại lạ bị chặn", async () => {
    const o = await order();
    const f = mockFetch(() => ok("F")).fetchImpl;
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: f })).rejects.toMatchObject({ code: "PRINT_NO_TEMPLATE" });
    const t = await tpl({ isActive: false });
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: f })).rejects.toMatchObject({ code: "PRINT_NO_TEMPLATE" });
    await prisma.printTemplate.update({ where: { id: t.id }, data: { isActive: true, secretCiphertext: null } });
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: f })).rejects.toMatchObject({ code: "PRINT_TEMPLATE_INCOMPLETE" });
    await prisma.printTemplate.update({ where: { id: t.id }, data: { secretCiphertext: "v1.bad.bad.bad" } });
    await expect(printDocument(prisma, actor, "SALE_INVOICE", o.id, { now: NOW, fetchImpl: f })).rejects.toMatchObject({ code: "PRINT_SECRET_UNREADABLE" });
    await expect(printDocument(prisma, actor, "NOPE", 1)).rejects.toMatchObject({ status: 404 });
  });
});
