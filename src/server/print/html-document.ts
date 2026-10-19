import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { assertCan } from "@/lib/permissions/guard";
import { formatCurrency, formatQty } from "@/lib/format";
import { parseDimNote } from "@/lib/length-expr";
import { getCompany, type CompanyDTO } from "@/server/company/queries";
import { getOrder } from "@/server/sales/queries";
import { getPurchase } from "@/server/purchase/queries";
import { DomainError } from "@/server/http/errors";
import { hasLocalPrint } from "@/lib/local-print";
import { buildContract } from "./contracts";
import { printDoc, type ContractBody } from "./types";
import { moneyInWords } from "./money-words";
import styles from "./html-styles.json";
import fontFaces from "./html-fonts.json";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const e = escapeHtml;
const image = (url: string, cls: string, alt: string) => /^(https:\/\/|\/(?!\/))/.test(url) ? `<img class="${cls}" src="${e(url)}" alt="${e(alt)}">` : "";
type PrintType = keyof typeof styles;
type Line = Record<string, string>;
export interface HtmlPrintDocument {
  type: PrintType; body: ContractBody; company: CompanyDTO; signer: string; footer: string; qr: string;
  lines: Line[]; summary: { label: string; value: string; big?: boolean }[]; words: string; notices: string[];
}

/** Adjacent cuts of the same product/price become the cut list shown in the supplied invoice. */
export function combineInvoiceCuts(lines: Line[], source: { qty: string; lineAmount?: string; note: string | null; salePrice?: string }[]): Line[] {
  const out: Line[] = [];
  let previousKey = "";
  let qty = D(0), amount = D(0), pieces = 0;
  lines.forEach((line, i) => {
    const raw = source[i], dim = parseDimNote(raw.note);
    if (!dim) { out.push(line); previousKey = ""; return; }
    const key = JSON.stringify([line.code, line.name, line.processing, line.unit, raw.salePrice, dim.ratio, dim.user]);
    const cut = `${formatQty(String(dim.length))} m × ${formatQty(String(dim.pieces))} Tấm`;
    if (key !== previousKey) {
      out.push({ ...line, note: dim.user, cuts: "", pieces: "", ratio: formatQty(String(dim.ratio)) });
      qty = D(0); amount = D(0); pieces = 0;
    }
    qty = qty.plus(D(raw.qty).times(line.unit === "m²" ? dim.ratio : 1));
    amount = amount.plus(raw.lineAmount ?? 0); pieces += dim.pieces;
    const row = out[out.length - 1];
    row.cuts = [row.cuts, cut].filter(Boolean).join("\n");
    row.pieces = formatQty(String(pieces)); row.qty = formatQty(qty.toString()); row.amount = formatCurrency(amount.toString());
    previousKey = key;
  });
  return out;
}

async function debtBefore(db: PrismaClient, partnerId: number, periodId: number, at: Date) {
  const [opening, rows] = await Promise.all([
    db.openingDebt.findFirst({ where: { partnerId, periodId }, select: { amount: true } }),
    db.partnerLedger.aggregate({ where: { partnerId, periodId, at: { lt: at } }, _sum: { debit: true, credit: true } }),
  ]);
  return D(opening?.amount ?? 0).plus(rows._sum.debit ?? 0).minus(rows._sum.credit ?? 0);
}

/** Only exposes the presentation fields. Costs, profit and secrets never enter the HTML. */
export async function buildHtmlPrint(db: PrismaClient, actor: Actor, type: string, id: number): Promise<HtmlPrintDocument> {
  assertCan(actor.perms, "print.use");
  if (!hasLocalPrint(type)) throw new DomainError("Loại phiếu này chưa có mẫu HTML.", 404);
  assertCan(actor.perms, printDoc(type)!.perm);
  // Purchase DTO does not apply partner scope itself; enforce it before reading printable data.
  if (type === "PURCHASE_RECEIPT") {
    const accessible = await db.purchase.findFirst({ where: { id, partner: partnerScopeWhere(actor) }, select: { id: true } });
    if (!accessible) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  }
  const [body, company, template] = await Promise.all([
    buildContract(db, actor, type, id), getCompany(db),
    db.printTemplate.findFirst({ where: { docType: type, isActive: true }, orderBy: { id: "asc" }, select: { signerName: true, footerNote: true, qrImage: true } }),
  ]);
  const result: HtmlPrintDocument = { type: type as PrintType, body, company, signer: template?.signerName ?? "", footer: template?.footerNote ?? "", qr: template?.qrImage ?? "", lines: body.lines.map((l) => ({ ...l })), summary: [], words: "", notices: [] };
  if (body.doc.status === "ĐÃ HỦY") throw new DomainError("Phiếu đã hủy, không thể in.", 409);
  if (type === "SALE_INVOICE") {
    const order = await getOrder(db, actor, id);
    const raw = await db.saleOrder.findUniqueOrThrow({ where: { id }, select: { periodId: true } });
    result.lines = combineInvoiceCuts(result.lines, order.lines);
    if (order.walkInName) body.partner = { ...(body.partner ?? { code: "", name: "", phone: "", address: "" }), name: order.walkInName, phone: order.walkInPhone ?? body.partner?.phone ?? "" };
    const total = D(order.orderTotal ?? 0);
    // Same accounting definition as the order list: opening + ledger strictly before orderDate.
    const old = actor.perms.has("debt.view") ? await debtBefore(db, order.partnerId, raw.periodId, order.orderDate) : null;
    const { orderPaid } = await import("@/server/deposits/status");
    const paid = await orderPaid(db, id);
    const remaining = total.plus(old ?? 0).minus(paid);
    result.summary = [
      { label: "Tổng đơn", value: formatCurrency(total.toString()) },
      ...(old !== null ? [{ label: "Nợ cũ", value: formatCurrency(old.toString()) }, { label: "Tổng cộng", value: formatCurrency(total.plus(old).toString()) }] : []),
      { label: "Đã thu", value: formatCurrency(paid.toString()) },
      { label: old === null ? "Còn phải trả của đơn" : "Còn phải trả", value: formatCurrency(remaining.toString()), big: true },
    ];
    result.words = moneyInWords(remaining.toFixed(0));
    if (D(order.shippingFee ?? 0).gt(0)) result.notices.push(`Tổng đơn đã bao gồm phí vận chuyển: ${formatCurrency(order.shippingFee)}.`);
    if (old !== null) result.notices.push("Nợ cũ tính ngay trước thời điểm lập đơn; đã thu là tiền gắn với đơn này.");
  } else if (type === "DELIVERY_NOTE") {
    const note = await db.deliveryNote.findFirstOrThrow({ where: { id, order: { partner: partnerScopeWhere(actor) } }, include: { lines: { orderBy: { id: "asc" }, include: { orderLine: { select: { note: true, qty: true } } } } } });
    result.lines = result.lines.map((line, i) => {
      const source = note.lines[i];
      const dim = parseDimNote(source.orderLine.note);
      const full = source.qty.equals(source.orderLine.qty);
      // ASSUMPTION: a partial delivery has no per-cut allocation. Never print the full order's cut list as delivered.
      return { ...line, note: dim && !full ? dim.user : source.orderLine.note ?? "", qty: dim ? formatQty(source.qty.times(dim.ratio).toString()) : line.qty, unit: dim ? "m²" : line.unit, issued: dim && full ? `${formatQty(String(dim.pieces))} Tấm` : `${formatQty(source.qty.toString())} ${line.unit}` };
    });
    if (note.lines.some((l) => parseDimNote(l.orderLine.note) && !l.qty.equals(l.orderLine.qty))) result.notices.push("Dòng giao một phần hiển thị lượng thực giao theo đơn vị lưu; chưa có phân bổ số tấm theo từng kích thước.");
  } else {
    const purchase = await getPurchase(db, actor, id);
    result.lines = result.lines.map((line, i) => ({ ...line, note: purchase.lines[i].rollInfo ?? "" }));
    result.summary = [
      { label: "Tổng khối lượng", value: "—" },
      { label: "Phí khác (cước nhập)", value: formatCurrency(purchase.freightCost ?? "0") },
      { label: "Chiết khấu", value: "—" },
      { label: "Tổng tiền hóa đơn", value: formatCurrency(purchase.purchaseTotal ?? "0"), big: true },
    ];
    if (actor.perms.has("debt.view")) {
      const old = (await debtBefore(db, purchase.partnerId, purchase.periodId, purchase.at)).negated();
      result.summary.push({ label: "Nợ cũ NCC", value: formatCurrency(old.toString()) });
    }
    // Payment has no purchaseId. Do not assign supplier-wide payments to this particular receipt.
    result.summary.push({ label: "Thanh toán", value: "—" }, { label: "Tổng phải trả", value: "—" });
    result.words = moneyInWords(D(purchase.purchaseTotal ?? 0).toFixed(0));
    result.notices.push("Chưa phân bổ thanh toán theo phiếu nhập; tổng phải trả để trống. Tiền bằng chữ là tổng tiền hàng. Cước nhập được theo dõi riêng.");
  }
  return result;
}

function product(line: Line) {
  const dim = parseDimNote(line.note);
  const detail = line.cuts ? `<div class="cut"><ul>${line.cuts.split("\n").map((cut) => `<li>${e(cut)}</li>`).join("")}</ul><div class="rt">(${e(line.pieces)} Tấm)</div><div class="rt">× ${e(line.ratio)}</div></div>${line.note ? `<div class="note">${e(line.note)}</div>` : ""}` : dim ? `<div class="cut"><ul><li>${e(formatQty(String(dim.length)))} m × ${e(dim.pieces)} Tấm</li></ul><div class="rt">(${e(dim.pieces)} Tấm)</div><div class="rt">× ${e(formatQty(String(dim.ratio)))}</div></div>${dim.user ? `<div class="note">${e(dim.user)}</div>` : ""}` : line.note ? `<div class="note">${e(line.note)}</div>` : "";
  return `<div class="pn"><b>${e(line.name)}</b><span class="tag">${e(line.processing)}</span></div>${detail}`;
}

export function renderHtmlPrint(model: HtmlPrintDocument, mono: boolean, auto: boolean, nonce: string): string {
  const { body: b, company: c, type } = model;
  const invoice = type === "SALE_INVOICE", delivery = type === "DELIVERY_NOTE";
  const title = invoice ? "HÓA ĐƠN GIAO NHẬN HÀNG HÓA" : delivery ? "PHIẾU GIAO NHẬN" : "PHIẾU NHẬP KHO";
  const bank = [c.bank.accountNo, c.bank.accountHolder, c.bank.bankName, c.bank.branch].filter(Boolean).join(" - ");
  const header = `<header class="head">${image(c.logo, "logo", "Logo")}<div class="co"><h1>${e(c.name)}</h1>${!delivery ? `<p><b>Địa chỉ:</b> ${e(c.address)}</p><p><b>SĐT:</b> ${e(c.phone)}</p>${c.taxCode ? `<p><b>MST:</b> ${e(c.taxCode)}</p>` : ""}${bank ? `<p><b>STK:</b> ${e(bank)}</p>` : ""}` : ""}</div>${invoice && model.qr ? `<div class="qr"><div class="box">${image(model.qr, "", "QR thanh toán")}</div>Quét để thanh toán</div>` : ""}</header>`;
  const partner = `<div class="cust"><div><span>${type === "PURCHASE_RECEIPT" ? "Nhà cung cấp" : "Khách hàng"}:</span> <b>${e(b.partner?.name)}</b></div><div><span>Điện thoại:</span> <b>${e(b.partner?.phone)}</b></div><div class="full"><span>Địa chỉ:</span> ${e(b.partner?.address)}</div></div>`;
  const cols = invoice ? ["STT", "Tên sản phẩm", "Số lượng", "Đơn giá", "Thành tiền"] : delivery ? ["STT", "Hàng hóa", "Số lượng", "Lượng xuất"] : ["STT", "Tên sản phẩm", "Mã cuộn", "Khối lượng", "Ghi chú", "Tổng số lượng", "Đơn vị tính", "Đơn giá", "Tổng tiền"];
  const widths = invoice ? [7, 45, 16, 15, 17] : delivery ? [7, 55, 20, 18] : [5, 29, 7, 6, 6, 10, 6, 14, 17];
  const rows = model.lines.map((line, i) => `<tr><td class="c">${i + 1}</td><td>${product(line)}</td>${invoice ? `<td class="r">${e(line.qty)} ${e(line.unit)}</td><td class="r">${e(line.price)}</td><td class="r">${e(line.amount)}</td>` : delivery ? `<td class="r">${e(line.qty)} ${e(line.unit)}</td><td class="r">${e(line.issued)}</td>` : `<td>${parseDimNote(line.note) ? "" : e(line.rollInfo)}</td><td></td><td></td><td class="r">${e(line.qty)}</td><td class="c">${e(line.unit)}</td><td class="r">${e(line.price)}</td><td class="r">${e(line.amount)}</td>`}</tr>`).join("");
  const sum = delivery ? "" : `<tr class="sum"><td colspan="${cols.length - 1}" class="c">${invoice ? "Tổng" : "Tổng tiền hàng"}</td><td class="r">${e(b.totals.total)}</td></tr>`;
  const signs = invoice ? ["Khách hàng", "Lái xe giao hàng", "Kế toán bán hàng"] : delivery ? ["Người mua hàng", "Người giao hàng", "Thủ kho", "Nhân viên bán hàng"] : ["Người giao hàng", "Thủ quỹ", "Người nhập hàng"];
  const script = `const ready=async()=>{await Promise.allSettled([400,600,700].map(w=>document.fonts.load(w+' 13px "Be Vietnam Pro"')));await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r})));};document.getElementById('print-now').onclick=async()=>{await ready();window.print()};${auto ? "ready().then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>window.print())));" : ""}`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} - ${e(b.docCode)}</title><style>${fontFaces}\n${styles[type][mono ? "mono" : "color"]}
  /* Print override preserves the supplied paper design, independently of app theme. */
  :root{--tool-bg:var(--soft);--tool-fg:var(--ink);--tool-border:var(--line);--tool-space:12px;--tool-radius:6px}
  .toolbar{display:flex;flex-wrap:wrap;gap:var(--tool-space);align-items:center;max-width:210mm;margin:0 auto var(--tool-space);padding:var(--tool-space);background:var(--tool-bg);color:var(--tool-fg);border-radius:var(--tool-radius)}
  .toolbar button,.toolbar a{min-height:44px;padding:8px 12px;border:1px solid var(--tool-border);border-radius:var(--tool-radius);background:var(--tool-bg);color:var(--tool-fg);font:inherit;text-decoration:none;cursor:pointer}
  .toolbar :focus-visible{outline:2px solid currentColor;outline-offset:2px}.toolbar span{font-size:11px}
  .page{height:auto}.head img.logo{height:80px;object-fit:contain}${mono ? ".head img{filter:grayscale(1)}" : ""}.pn{flex-wrap:wrap}.tag{white-space:normal}.note{white-space:pre-line}.co,.pn b,td{overflow-wrap:anywhere}.sign,.terms,.words{break-inside:avoid}.words{margin-top:8px}.cust{break-inside:avoid}.qr img{display:block}thead{display:table-header-group}table{table-layout:fixed}${!invoice && !delivery ? "table{font-size:10.5px}td,th{padding:5px}.cut{font-size:10px;flex-wrap:wrap;gap:2px}" : ""}td{font-variant-numeric:tabular-nums}td.r{white-space:nowrap;overflow-wrap:normal}
  @media screen and (max-width:800px){body{padding:8px}.toolbar{position:sticky;left:0}.page{margin:0}}
  @page{size:A4;margin:12mm 12mm 10mm}
  @media print{.toolbar{display:none!important}html,body{width:auto;margin:0;padding:0}.page{width:auto;min-height:0;padding:0;box-shadow:none}.head{break-inside:avoid}tr{break-inside:avoid}th{print-color-adjust:exact}}
  </style></head><body><nav class="toolbar" aria-label="Công cụ in"><button id="print-now" type="button">In / Lưu PDF</button><a href="?mode=${mono ? "color" : "mono"}">${mono ? "Bản màu" : "Bản đen trắng"}</a><span>A4 · Tỷ lệ 100% · Tắt đầu trang/chân trang trình duyệt</span></nav><main class="page">${header}<div class="titlebar"><h2>${title}</h2><div class="meta"><div><span>Số:</span> <b>${e(b.docCode)}</b></div><div><span>Ngày:</span> <b>${e(b.doc.date)}</b></div>${delivery ? `<div><span>Mã đơn hàng:</span> <b>${e(b.doc.orderCode)}</b></div>` : ""}</div></div>${partner}<table><colgroup>${widths.map((width) => `<col style="width:${width}%">`).join("")}</colgroup><thead><tr>${cols.map((col) => `<th scope="col">${col}</th>`).join("")}</tr></thead><tbody>${rows}${sum}</tbody></table><div class="tot">${model.summary.map((s) => `<div${s.big ? ' class="big"' : ""}><span>${e(s.label)}:</span><b>${e(s.value)}</b></div>`).join("")}</div>${model.words ? `<p class="words">${e(model.words)}</p>` : ""}${b.doc.note ? `<p class="note">Ghi chú: ${e(b.doc.note)}</p>` : ""}<div class="sign">${signs.map((s, i) => `<div><b>${s}</b><small>(Ký, ghi rõ họ tên)</small>${i === signs.length - 1 && !delivery ? `<em>${e(model.signer)}</em>` : ""}</div>`).join("")}</div>${model.footer ? `<div class="terms">${e(model.footer).replace(/\n/g, "<br>")}</div>` : ""}${model.notices.length ? `<div class="terms">${model.notices.map(e).join("<br>")}</div>` : ""}</main><script nonce="${e(nonce)}">${script}</script></body></html>`;
}
