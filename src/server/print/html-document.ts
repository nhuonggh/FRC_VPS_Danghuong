import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { assertCan } from "@/lib/permissions/guard";
import { formatCurrency, formatQty } from "@/lib/format";
import { parseDimNote } from "@/lib/length-expr";
import { getCompany, type CompanyDTO } from "@/server/company/queries";
import { getOrder } from "@/server/sales/queries";
import { getPurchase } from "@/server/purchase/queries";
import { getQuote } from "@/server/quotes/queries";
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
type PrintType = string;
/** Ba mẫu gốc có CSS riêng; các phiếu còn lại dùng chung CSS của hóa đơn (cùng phong cách). */
const styleOf = (type: string): keyof typeof styles => (type in styles ? type : type === "TRIP_SHEET" ? "DELIVERY_NOTE" : "SALE_INVOICE") as keyof typeof styles;
const wordsOf = (formatted: string) => moneyInWords(formatted.split(",")[0].replace(/[^\d-]/g, "") || "0");
type Line = Record<string, string>;
export interface HtmlPrintDocument {
  type: PrintType; body: ContractBody; company: CompanyDTO; signer: string; footer: string; qr: string; /** Từ mẫu in (Hệ thống → Công ty): tiêu đề, SĐT in; rỗng = dùng mặc định. */ title?: string; phone?: string;
  lines: Line[]; summary: { label: string; value: string; big?: boolean }[]; words: string; notices: string[];
  /** Địa chỉ giao hàng nhập trên đơn (hóa đơn bán hàng). */
  shipAddress?: string;
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
/** `opts.debt` ghi đè cờ printDebt của đơn (chọn in có/không nợ cũ ngay lúc in). */
export async function buildHtmlPrint(db: PrismaClient, actor: Actor, type: string, id: number, opts: { debt?: boolean; range?: { from: string; to: string } } = {}): Promise<HtmlPrintDocument> {
  assertCan(actor.perms, "print.use");
  if (!hasLocalPrint(type)) throw new DomainError("Loại phiếu này chưa có mẫu HTML.", 404);
  assertCan(actor.perms, printDoc(type)!.perm);
  // Purchase DTO does not apply partner scope itself; enforce it before reading printable data.
  if (type === "PURCHASE_RECEIPT") {
    const accessible = await db.purchase.findFirst({ where: { id, partner: partnerScopeWhere(actor) }, select: { id: true } });
    if (!accessible) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  }
  const [body, company, template] = await Promise.all([
    buildContract(db, actor, type, id, new Date(), opts.range), getCompany(db),
    db.printTemplate.findFirst({ where: { docType: type, isActive: true }, orderBy: { id: "asc" }, select: { signerName: true, footerNote: true, qrImage: true, title: true, phone: true } }),
  ]);
  const result: HtmlPrintDocument = { type: type as PrintType, body, company, signer: template?.signerName ?? "", footer: template?.footerNote ?? "", qr: template?.qrImage ?? "", title: template?.title?.trim() ?? "", phone: template?.phone?.trim() ?? "", lines: body.lines.map((l) => ({ ...l })), summary: [], words: "", notices: [] };
  if (body.doc.status === "ĐÃ HỦY") throw new DomainError("Phiếu đã hủy, không thể in.", 409);
  if (type === "SALE_INVOICE") {
    const order = await getOrder(db, actor, id);
    const raw = await db.saleOrder.findUniqueOrThrow({ where: { id }, select: { periodId: true, printDebt: true } });
    result.lines = combineInvoiceCuts(result.lines, order.lines);
    if (order.shipAddress) result.shipAddress = order.shipAddress;
    if (order.walkInName) body.partner = { ...(body.partner ?? { code: "", name: "", phone: "", address: "" }), name: order.walkInName, phone: order.walkInPhone ?? body.partner?.phone ?? "" };
    const total = D(order.orderTotal ?? 0);
    // Same accounting definition as the order list: opening + ledger strictly before orderDate.
    const old = actor.perms.has("debt.view") && (opts.debt ?? raw.printDebt) ? await debtBefore(db, order.partnerId, raw.periodId, order.orderDate) : null;
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
    // Chưa cấu hình ảnh QR cố định ở mẫu in → tự sinh VietQR từ tài khoản công ty, kèm số tiền còn phải trả + mã đơn.
    const { accountNo, bankName, accountHolder } = company.bank;
    if (!result.qr && accountNo && bankName) {
      const qs = new URLSearchParams({ addInfo: body.docCode, accountName: accountHolder });
      if (remaining.gt(0)) qs.set("amount", remaining.toFixed(0));
      result.qr = `https://img.vietqr.io/image/${encodeURIComponent(bankName)}-${encodeURIComponent(accountNo)}-qr_only.png?${qs}`;
    }
    if (D(order.shippingFee ?? 0).gt(0)) result.notices.push(`Tổng đơn đã bao gồm phí vận chuyển: ${formatCurrency(order.shippingFee)}.`);
    result.signer = order.createdByName ?? ""; // ô "Kế toán bán hàng": tên người lập đơn
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
  } else if (type === "QUOTE") {
    const q = await getQuote(db, actor, id);
    if (body.doc.status === "CANCELLED") throw new DomainError("Báo giá đã hủy, không thể in.", 409);
    result.lines = combineInvoiceCuts(result.lines, q.lines);
    result.summary = [{ label: "Tổng cộng", value: body.totals.total, big: true }];
    result.words = wordsOf(body.totals.total);
  } else if (type === "RECEIPT" || type === "PAYMENT") {
    result.summary = [{ label: "Số tiền", value: body.totals.amount, big: true }];
    result.words = wordsOf(body.totals.amount);
  } else if (type === "TRIP_CASH") {
    const net = body.totals.expense ? body.totals.net : body.totals.cash;
    result.summary = body.totals.expense
      ? [{ label: "Tiền mặt thu từ khách", value: body.totals.cash }, { label: "Lái xe đã ứng chi", value: `-${body.totals.expense}` }, { label: "Tiền mặt lái xe nộp quỹ", value: net, big: true }]
      : [{ label: "Tổng tiền mặt thu từ lái xe", value: body.totals.cash, big: true }];
    result.words = wordsOf(net);
  } else if (type === "TRIP_SHEET") {
    result.notices.push("Lái xe đánh dấu kết quả giao; ghi tiền mặt, chuyển khoản, tiền bớt vào phiếu rồi mang về giao cho kế toán nhập dữ liệu. Tránh nhầm đơn này với đơn khác.");
  } else if (type === "DEBT_STATEMENT") {
    const t = body.totals;
    result.summary = [{ label: "Số dư đầu kỳ", value: t.opening }, { label: "Phát sinh tăng", value: t.debit }, { label: "Phát sinh giảm", value: t.credit }, { label: "Số dư cuối", value: t.balance, big: true }];
    if (t.discountBalance && t.discountBalance !== "0") result.summary.push({ label: "Chiết khấu tích lũy còn lại", value: t.discountBalance });
    result.notices.push("Số dư dương: đối tác còn nợ công ty; số dư âm: công ty còn nợ đối tác. Đề nghị đối chiếu và ký xác nhận.");
  } else if (type === "GOODS_RETURN") {
    const t = body.totals;
    result.summary = [{ label: "Tiền hàng trả", value: t.total }, ...(t.deduction ? [{ label: `Khấu trừ${t.deductionNote ? ` (${t.deductionNote})` : ""}`, value: t.deduction }] : []), { label: "Giá trị trả", value: t.net, big: true }];
    if (t.net) result.words = wordsOf(t.net);
  } else if (type === "DISCOUNT_SETTLEMENT") {
    result.summary = [{ label: "Số tiền tất toán", value: body.totals.amount, big: true }];
    result.words = wordsOf(body.totals.amount);
    if (body.doc.method === "Chuyển vào lãi công ty") result.notices.push("Khoản chiết khấu này không chi cho khách mà được chuyển vào lãi công ty.");
  } else if (type === "SUPPLIER_ORDER") {
    result.summary = [{ label: "Tổng giá trị dự kiến", value: body.totals.total, big: true }];
    result.words = wordsOf(body.totals.total);
  } else if (type === "PURCHASE_RECEIPT") {
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

function product(line: Line, hidePieces = false) {
  const total = (pieces: string | number) => hidePieces ? "" : `<div class="rt">(${e(pieces)} Tấm)</div>`;
  const dim = parseDimNote(line.note);
  const detail = line.cuts ? `<div class="cut"><ul>${line.cuts.split("\n").map((cut) => `<li>${e(cut)}</li>`).join("")}</ul>${total(line.pieces)}<div class="rt">× ${e(line.ratio)}</div></div>${line.note ? `<div class="note">${e(line.note)}</div>` : ""}` : dim ? `<div class="cut"><ul><li>${e(formatQty(String(dim.length)))} m × ${e(dim.pieces)} Tấm</li></ul>${total(dim.pieces)}<div class="rt">× ${e(formatQty(String(dim.ratio)))}</div></div>${dim.user ? `<div class="note">${e(dim.user)}</div>` : ""}` : line.note ? `<div class="note">${e(line.note)}</div>` : "";
  return `<div class="pn"><b>${e(line.name)}</b><span class="tag">${e(line.processing)}</span></div>${detail}`;
}

const TITLES: Record<string, string> = {
  SALE_INVOICE: "PHIẾU GIAO NHẬN HÀNG HÓA", DELIVERY_NOTE: "PHIẾU GIAO NHẬN", PURCHASE_RECEIPT: "PHIẾU NHẬP KHO", QUOTE: "BÁO GIÁ", RECEIPT: "PHIẾU THU", PAYMENT: "PHIẾU CHI", TRIP_CASH: "PHIẾU THU TIỀN LÁI XE",
  DEBT_STATEMENT: "BIÊN BẢN ĐỐI CHIẾU CÔNG NỢ", TRIP_SHEET: "PHIẾU GIAO NHẬN THEO CHUYẾN", PRODUCTION_ORDER: "LỆNH SẢN XUẤT", STOCKTAKE: "PHIẾU KIỂM KHO", GOODS_RETURN: "PHIẾU TRẢ HÀNG",
  DISCOUNT_SETTLEMENT: "PHIẾU TẤT TOÁN CHIẾT KHẤU", SUPPLIER_ORDER: "ĐƠN ĐẶT HÀNG NHÀ CUNG CẤP", LOSS_ADJUST: "PHIẾU HAO HỤT / XUẤT HỦY",
};
const SIGNS: Record<string, string[]> = {
  SALE_INVOICE: ["Khách hàng", "Lái xe giao hàng", "Kế toán bán hàng"], DELIVERY_NOTE: ["Người mua hàng", "Người giao hàng", "Thủ kho", "Nhân viên bán hàng"], PURCHASE_RECEIPT: ["Người giao hàng", "Thủ quỹ", "Người nhập hàng"],
  QUOTE: ["Khách hàng", "Người lập báo giá"], RECEIPT: ["Người lập phiếu", "Người nộp tiền", "Thủ quỹ", "Kế toán"], PAYMENT: ["Người lập phiếu", "Người nhận tiền", "Thủ quỹ", "Kế toán"],
  DEBT_STATEMENT: ["Đối tác xác nhận", "Kế toán", "Giám đốc"], TRIP_SHEET: ["Lái xe", "Phụ xe", "Thủ kho"], PRODUCTION_ORDER: ["Người lập lệnh", "Thợ sản xuất", "Thủ kho"],
  STOCKTAKE: ["Người kiểm kho", "Thủ kho", "Kế toán", "Giám đốc"], GOODS_RETURN: ["Người trả hàng", "Người nhận hàng", "Thủ kho", "Kế toán"],
  DISCOUNT_SETTLEMENT: ["Người lập phiếu", "Khách hàng", "Kế toán", "Giám đốc"], SUPPLIER_ORDER: ["Nhà cung cấp xác nhận", "Người đặt hàng", "Giám đốc"], LOSS_ADJUST: ["Người lập phiếu", "Thủ kho", "Kế toán", "Giám đốc"],
};
/** Đầu và chân hóa đơn bán hàng (nội dung cố định theo yêu cầu của công ty). */
const INVOICE_BUSINESS = ["Các loại tôn theo yêu cầu, Tôn xốp, Sóng vòm, Sóng ngói.", "Thép hộp, Thép hình, Nhôm, Kính, Inox, Cửa cuốn, Cửa xếp, Nhựa sáng ...vv"];
const INVOICE_ADDRESS = "La Văn Cầu - Thượng Cốc - Lạc Sơn - Hòa Bình";
const INVOICE_PHONES = "Kế toán Phượng 0328 919 556 - Nhâm 0326 500 868";
const INVOICE_NOTES = ["Hóa đơn bán hàng có giá trị như giấy nhận nợ đối với khách hàng thanh toán chậm.", "Kiểm tra đối chiếu khi giao nhận hàng, Tôn đã cắt không được trả lại.", "Mọi thắc mắc xin quý khách liên hệ ngay, quá hai ngày sau khi nhận hàng công ty không chịu trách nhiệm."];
const td = (v: string | undefined, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${e(v)}</td>`;
/** Bảng riêng của các phiếu không dùng khung hóa đơn. `group` gom dòng theo khóa, `groupLabel` dựng dòng tiêu đề nhóm. */
interface TableSpec { cols: string[]; widths: number[]; row: (l: Line) => string; group?: (l: Line) => string; groupLabel?: (l: Line) => string }
const TABLES: Record<string, TableSpec> = {
  DEBT_STATEMENT: { cols: ["STT", "Ngày", "Loại chứng từ", "Số chứng từ", "Phát sinh tăng", "Phát sinh giảm", "Số dư"], widths: [6, 12, 24, 16, 14, 14, 14], row: (l) => td(l.no, "c") + td(l.date, "c") + td(l.docLabel) + td(l.docCode) + td(l.debit, "r") + td(l.credit, "r") + td(l.running, "r") },
  // Phiếu lái xe cầm đi giao: mỗi đơn một dòng; cột kết quả/tiền/ghi chú để trống cho lái xe đánh dấu và ghi tay.
  TRIP_SHEET: {
    cols: ["STT", "Đơn hàng", "Khách hàng", "Số tiền đơn hàng", "Kết quả giao", "Tiền mặt", "Chuyển khoản", "Bớt", "Ghi chú"], widths: [4, 10, 18, 11, 10, 13, 13, 9, 12],
    row: (l) => td(l.no, "c") + td(l.order, "ord") + `<td><b>${e(l.customer)}</b>${[l.phone, l.address].filter(Boolean).map((t) => `<span class="note">${e(t)}</span>`).join("")}</td>`
      + `<td class="r">${e(l.orderTotal)}${l.due && l.due !== l.orderTotal ? `<span class="note">Cần thu: ${e(l.due)}</span>` : ""}</td>`
      + `<td>${["Hẹn", "Nợ", "Đã TT"].map((t) => `<div class="cbx"><i class="cb"></i>${t}</div>`).join("")}</td><td></td><td></td><td></td><td></td>`,
  },
  // Bill 80mm: mỗi đơn một dòng (tên khách + mã phiếu thu nhỏ bên dưới), chỉ tiền mặt.
  TRIP_CASH: {
    cols: ["Đơn hàng", "Tiền mặt"], widths: [60, 40],
    row: (l) => `<td><b>${e(l.order)}</b>${[l.customer, l.receipts && `${l.kind === "expense" ? "PC" : "PT"}: ${l.receipts}`, l.over].filter(Boolean).map((t) => `<span class="note">${e(t)}</span>`).join("")}</td>` + td(l.amount, "r"),
  },
  PRODUCTION_ORDER: { cols: ["STT", "Mã", "Tên sản phẩm", "Quy cách", "ĐVT", "Số lượng"], widths: [7, 14, 35, 20, 8, 16], group: (l) => l.section, groupLabel: (l) => l.section, row: (l) => td(l.no, "c") + td(l.code) + td(l.name) + td(l.spec) + td(l.unit, "c") + td(l.qty, "r") },
  LOSS_ADJUST: { cols: ["STT", "Mã", "Tên sản phẩm", "ĐVT", "Số lượng"], widths: [7, 16, 47, 10, 20], row: (l) => td(l.no, "c") + td(l.code) + td(l.name) + td(l.unit, "c") + td(l.qty, "r") },
  STOCKTAKE: { cols: ["STT", "Mã", "Tên sản phẩm", "ĐVT", "Tồn sổ sách", "Thực đếm", "Chênh lệch"], widths: [6, 13, 33, 8, 14, 14, 12], row: (l) => td(l.no, "c") + td(l.code) + td(l.name) + td(l.unit, "c") + td(l.systemQty, "r") + td(l.actualQty, "r") + td(l.diff, "r") },
};
function tableHtml(spec: TableSpec, lines: Line[]): string {
  let last: string | undefined;
  const rows = lines.map((l) => {
    const g = spec.group?.(l);
    const head = spec.group && g !== last ? `<tr class="grp"><td colspan="${spec.cols.length}">${e(spec.groupLabel!(l))}</td></tr>` : "";
    last = g;
    return `${head}<tr>${spec.row(l)}</tr>`;
  }).join("");
  return `<table><colgroup>${spec.widths.map((w) => `<col style="width:${w}%">`).join("")}</colgroup><thead><tr>${spec.cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}
/** Khối thông tin dạng lưới (nhãn xám + giá trị đậm); bỏ ô trống. */
const infoBlock = (items: [string, string | undefined, boolean?][]) => `<div class="cust">${items.filter(([, v]) => v).map(([label, v, full]) => `<div${full ? ' class="full"' : ""}><span>${e(label)}:</span> <b>${e(v)}</b></div>`).join("")}</div>`;

/** `hidePieces`: bỏ dòng tổng số tấm (giữ dòng kích thước) để chụp gửi bên đặt hàng. `debt`: lựa chọn nợ cũ đang áp dụng, giữ khi chuyển chế độ. */
export function renderHtmlPrint(model: HtmlPrintDocument, mono: boolean, auto: boolean, nonce: string, opts: { hidePieces?: boolean; debt?: boolean; paper?: "A4" | "A5" } = {}): string {
  const { body: b, company: c, type } = model;
  const a5 = opts.paper === "A5" && type === "SALE_INVOICE";
  /** Phiếu thu/chi in dạng bill nhỏ (khổ 80mm như máy in siêu thị): không đầu trang công ty. */
  const slip = type === "RECEIPT" || type === "PAYMENT" || type === "TRIP_CASH";
  const invoice = type === "SALE_INVOICE" || type === "QUOTE" || type === "GOODS_RETURN" || type === "SUPPLIER_ORDER", delivery = type === "DELIVERY_NOTE", purchase = type === "PURCHASE_RECEIPT", voucher = type === "RECEIPT" || type === "PAYMENT" || type === "DISCOUNT_SETTLEMENT";
  const plain = delivery || type === "TRIP_SHEET";
  const title = e(model.title ? model.title.toLocaleUpperCase("vi") : type === "LOSS_ADJUST" ? (b.doc.kind === "Xuất hủy" ? "PHIẾU XUẤT HỦY" : "PHIẾU HAO HỤT") : (TITLES[type] ?? "PHIẾU"));
  const bank = [c.bank.accountNo, c.bank.accountHolder, c.bank.bankName, c.bank.branch].filter(Boolean).join(" - ");
  const saleInvoice = type === "SALE_INVOICE";
  const companyInfo = saleInvoice
    ? `<p><b>Chuyên KD và SX:</b></p>${INVOICE_BUSINESS.map((t) => `<p>- ${e(t)}</p>`).join("")}<p><b>Địa chỉ:</b> ${e(c.address || INVOICE_ADDRESS)}</p><p><b>SĐT:</b> ${e(model.phone || INVOICE_PHONES)}</p>${bank ? `<p><b>STK:</b> ${e(bank)}</p>` : ""}`
    : `<p><b>Địa chỉ:</b> ${e(c.address)}</p><p><b>SĐT:</b> ${e(c.phone)}</p>${c.taxCode ? `<p><b>MST:</b> ${e(c.taxCode)}</p>` : ""}${bank ? `<p><b>STK:</b> ${e(bank)}</p>` : ""}`;
  const header = slip ? "" : `<header class="head">${image(c.logo, "logo", "Logo")}<div class="co">${type === "TRIP_SHEET" ? "" : `<h1>${e(c.name)}</h1>`}${!plain ? companyInfo : ""}</div>${type === "SALE_INVOICE" && model.qr ? `<div class="qr"><div class="box">${image(model.qr, "", "QR thanh toán")}</div>Quét để thanh toán</div>` : ""}</header>`;
  const partnerLabel = purchase || type === "SUPPLIER_ORDER" || (type === "GOODS_RETURN" && b.doc.kind === "Trả nhà cung cấp") ? "Nhà cung cấp" : "Khách hàng";
  const partnerBlock = `<div class="cust"><div><span>${partnerLabel}:</span> <b>${e(b.partner?.name)}</b></div><div><span>Điện thoại:</span> <b>${e(b.partner?.phone)}</b></div><div class="full"><span>Địa chỉ:</span> ${e(b.partner?.address)}</div>${model.shipAddress ? `<div class="full"><span>Địa chỉ giao hàng:</span> ${e(model.shipAddress)}</div>` : ""}</div>`;
  const p = b.partner, d = b.doc;
  const info = type === "DISCOUNT_SETTLEMENT" ? infoBlock([["Khách hàng", p?.name], ["Điện thoại", p?.phone], ["Địa chỉ", p?.address, true], ["Hình thức", d.method], ["Phiếu chi liên quan", d.payment]])
    : type === "LOSS_ADJUST" ? infoBlock([["Loại phiếu", d.kind], ["Người lập", d.createdBy]])
    : voucher ? infoBlock([[type === "RECEIPT" ? "Người nộp tiền" : "Người nhận tiền", p?.name], ["Điện thoại", p?.phone], ["Địa chỉ", p?.address, true], [type === "PAYMENT" ? "Nội dung / loại chi phí" : "Nội dung", d.type, true], ["Vào quỹ / ngân hàng", d.account], ["Theo đơn hàng", d.order], ["Người lập", d.createdBy]])
    : type === "DEBT_STATEMENT" ? infoBlock([["Đối tác", p?.name], ["Điện thoại", p?.phone], ["Địa chỉ", p?.address, true], ["Kỳ đối chiếu", d.period, true]])
    : type === "TRIP_CASH" ? infoBlock([["Lái xe", d.driver], ["Biển số xe", d.vehicle], ["Người thao tác", d.operator]])
    : type === "TRIP_SHEET" ? infoBlock([["Biển số xe", d.vehicle], ["Lái xe", d.driver], ["Phụ xe", d.assistant], ["Tuyến", d.route], ["Số điểm giao", b.totals.stops]])
    : type === "PRODUCTION_ORDER" ? infoBlock([["Người lập", d.createdBy]])
    : type === "STOCKTAKE" ? infoBlock([["Người lập", d.createdBy], ["Trạng thái", d.statusLabel]])
    : partnerBlock;
  const cols = invoice ? ["STT", "Tên sản phẩm", "Số lượng", "Đơn giá", "Thành tiền"] : delivery ? ["STT", "Hàng hóa", "Số lượng", "Lượng xuất"] : ["STT", "Tên sản phẩm", "Mã cuộn", "Khối lượng", "Ghi chú", "Tổng số lượng", "Đơn vị tính", "Đơn giá", "Tổng tiền"];
  const widths = invoice ? (saleInvoice ? [5, 55, 12, 13, 15] : [7, 45, 16, 15, 17]) : delivery ? [7, 55, 20, 18] : [5, 29, 7, 6, 6, 10, 6, 14, 17];
  const rows = model.lines.map((line, i) => `<tr><td class="c">${i + 1}</td><td>${product(line, opts.hidePieces)}</td>${invoice ? `<td class="r">${e(line.qty)} ${e(line.unit)}</td><td class="r">${e(line.price)}</td><td class="r">${e(line.amount)}</td>` : delivery ? `<td class="r">${e(line.qty)} ${e(line.unit)}</td><td class="r">${e(line.issued)}</td>` : `<td>${parseDimNote(line.note) ? "" : e(line.rollInfo)}</td><td></td><td></td><td class="r">${e(line.qty)}</td><td class="c">${e(line.unit)}</td><td class="r">${e(line.price)}</td><td class="r">${e(line.amount)}</td>`}</tr>`).join("");
  const sum = delivery ? "" : `<tr class="sum"><td colspan="${cols.length - 1}" class="c">${invoice ? "Tổng" : "Tổng tiền hàng"}</td><td class="r">${e(b.totals.total)}</td></tr>`;
  const table = voucher ? "" : TABLES[type] ? tableHtml(TABLES[type], model.lines) : `<table><colgroup>${widths.map((width) => `<col style="width:${width}%">`).join("")}</colgroup><thead><tr>${cols.map((col) => `<th scope="col">${col}</th>`).join("")}</tr></thead><tbody>${rows}${sum}</tbody></table>`;
  const signs = SIGNS[type] ?? [];
  const href = (o: { mode?: string; hidePieces?: boolean; debt?: boolean; auto?: boolean; paper?: "A4" | "A5" }) => {
    const q = new URLSearchParams({ mode: o.mode ?? (mono ? "mono" : "color") });
    if ((o.paper ?? (a5 ? "A5" : "A4")) === "A5") q.set("paper", "A5");
    if (o.hidePieces ?? opts.hidePieces) q.set("hidePieces", "1");
    const debt = o.debt ?? opts.debt;
    if (debt !== undefined) q.set("debt", debt ? "1" : "0");
    if (o.auto) q.set("auto", "1");
    return `?${q}`;
  };
  const showDebt = model.summary.some((s) => s.label === "Nợ cũ");
  // Hóa đơn bán hàng: xem trước rộng, nút in dính đáy màn hình; các phiếu khác giữ thanh công cụ cũ.
  const toolbar = saleInvoice
    ? `<nav class="toolbar bar" aria-label="Công cụ in"><a href="${e(href({ hidePieces: !opts.hidePieces }))}" role="checkbox" aria-checked="${!!opts.hidePieces}">${opts.hidePieces ? "☑" : "☐"} Ẩn tổng số tấm</a><a href="${e(href({ debt: !showDebt }))}" role="checkbox" aria-checked="${showDebt}">${showDebt ? "☑" : "☐"} Hiện nợ cũ</a><a href="${e(href({ mode: mono ? "color" : "mono" }))}">${mono ? "Bản màu" : "Bản đen trắng"}</a><a href="${e(href({ paper: a5 ? "A4" : "A5" }))}" role="checkbox" aria-checked="${a5}">${a5 ? "☑" : "☐"} Khổ A5</a><a href="${e(href({ debt: false, auto: true }))}">In đơn hàng không có công nợ cũ</a><a class="pri" href="${e(href({ debt: true, auto: true }))}">In đơn hàng</a></nav>`
    : `<nav class="toolbar" aria-label="Công cụ in"><button id="print-now" type="button" class="pri">In / Lưu PDF</button><a href="?mode=${mono ? "color" : "mono"}">${mono ? "Bản màu" : "Bản đen trắng"}</a><span>${slip ? "Khổ 80mm (máy in bill)" : "A4"} · Tỷ lệ 100% · Tắt đầu trang/chân trang trình duyệt</span></nav>`;
  const numLabel = type === "DEBT_STATEMENT" ? "Mã đối tác" : type === "TRIP_CASH" ? "Chuyến" : "Số";
  const dateLabel = type === "TRIP_CASH" ? "Thời gian thu" : "Ngày";
  const orderMeta = delivery || (type === "GOODS_RETURN" && b.doc.orderCode) ? `<div><span>Mã đơn hàng:</span> <b>${e(b.doc.orderCode)}</b></div>` : "";
  const script = `const ready=async()=>{await Promise.allSettled([400,600,700].map(w=>document.fonts.load(w+' 13px "Be Vietnam Pro"')));await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r})));};const pn=document.getElementById('print-now');if(pn)pn.onclick=async()=>{await ready();window.print()};${auto ? "ready().then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>window.print())));" : ""}`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - ${e(b.docCode)}</title><style>${fontFaces}\n${styles[styleOf(type)][mono ? "mono" : "color"]}
  /* Print override preserves the supplied paper design, independently of app theme. */
  :root{--tool-bg:var(--soft);--tool-fg:var(--ink);--tool-border:var(--line);--tool-space:12px;--tool-radius:6px}
  .toolbar{display:flex;flex-wrap:wrap;gap:var(--tool-space);align-items:center;max-width:210mm;margin:0 auto var(--tool-space);padding:var(--tool-space);background:var(--tool-bg);color:var(--tool-fg);border-radius:var(--tool-radius)}
  .toolbar button,.toolbar a{min-height:44px;padding:8px 12px;border:1px solid var(--tool-border);border-radius:var(--tool-radius);background:var(--tool-bg);color:var(--tool-fg);font:inherit;text-decoration:none;cursor:pointer}
  .toolbar :focus-visible{outline:2px solid currentColor;outline-offset:2px}.toolbar span{font-size:11px}
  .page{height:auto}.head img.logo{height:80px;object-fit:contain}${mono ? ".head img{filter:grayscale(1)}" : ""}.pn{flex-wrap:wrap}.tag{white-space:normal}.note{white-space:pre-line}.co,.pn b,td{overflow-wrap:anywhere}.sign,.terms,.words{break-inside:avoid}.words{margin-top:8px}.cust{break-inside:avoid}.qr{width:128px;font-size:10.5px}.qr .box{width:128px;height:128px;border:0}.qr img{display:block}.cbx{white-space:nowrap;font-size:11px;line-height:1.7}.cb{display:inline-block;width:10px;height:10px;border:1px solid var(--ink);margin-right:5px;vertical-align:-1px}td .note{display:block}thead{display:table-header-group}table{table-layout:fixed}${purchase ? "table{font-size:10.5px}td,th{padding:5px}.cut{font-size:10px;flex-wrap:wrap;gap:2px}" : ""}td{font-variant-numeric:tabular-nums}td.r{white-space:nowrap;overflow-wrap:normal}td.ord{white-space:nowrap;overflow-wrap:normal;font-size:11px}
  tr.grp td{background:var(--soft);font-weight:600;font-size:12px}
  @media screen and (max-width:800px){body{padding:8px}.toolbar{position:sticky;left:0}.page{margin:0}}
  ${saleInvoice ? ".toolbar a.pri{font-weight:600;border-color:var(--ink)}@media screen{.page{width:auto;max-width:1600px;min-height:0;margin:0 auto 72px}.toolbar{position:fixed;left:0;right:0;bottom:0;max-width:none;margin:0;justify-content:flex-end;border-radius:0;box-shadow:0 -2px 10px rgba(0,0,0,.15);z-index:10}}" : ""}
  ${saleInvoice ? "" : ".toolbar .pri{font-weight:600;border-color:var(--ink)}@media screen{.page{margin-bottom:72px}.toolbar{position:fixed;left:0;right:0;bottom:0;max-width:none;margin:0;justify-content:flex-end;border-radius:0;box-shadow:0 -2px 10px rgba(0,0,0,.15);z-index:10}}"}
  @page{size:${slip ? "80mm auto" : a5 ? "A5" : "A4"};margin:${slip ? "2mm" : a5 ? "8mm 8mm 7mm" : "12mm 12mm 10mm"}}
  ${slip ? ".page{width:80mm;min-height:0;padding:3mm;border-top:0}.titlebar{display:block;text-align:center;margin:0 0 6px}.titlebar h2{border-left:0;padding:0;font-size:15px}.meta{text-align:center;font-size:11px}.cust{display:block;font-size:11px;padding:4px 0;background:none;border-top:1px dashed var(--ink);border-bottom:1px dashed var(--ink);border-radius:0;margin-bottom:6px}.cust div{padding:1px 0}.tot{width:auto;font-size:12px;margin:6px 0 2px}.tot .big{font-size:15px}.words{text-align:center;font-size:11px;margin-bottom:8px}" + (type === "TRIP_CASH" ? "table{font-size:11px}th,td{padding:3px 4px}.note{font-size:10px}" : "") + ".sign{flex-wrap:wrap}.sign div{flex:1 1 45%;min-height:54px;font-size:11px}.sign small{font-size:9px}.sign em{margin-top:20px}.terms{font-size:9.5px;margin-top:8px}@media print{.page{width:auto;padding:0}}" : ""}
  ${a5 ? "@media print{body{font-size:11px}.head{gap:8px;padding-bottom:6px}.head img.logo{height:48px}.co h1{font-size:15px}.co{font-size:10px}.titlebar{margin:8px 0 6px}.titlebar h2{font-size:15px}.meta{font-size:11px}.cust{font-size:11px;padding:5px 8px;margin-bottom:8px}table{font-size:10.5px}th,td{padding:4px 5px}.cut{font-size:10px}.qr,.qr .box{width:84px}.qr .box{height:84px}.qr{font-size:9px}.tot{width:230px;font-size:11px}.tot .big{font-size:13px}.sign div{min-height:64px}.sign em{margin-top:28px}.terms{font-size:9.5px;margin-top:8px}}" : ""}
  @media print{.toolbar{display:none!important}html,body{width:auto;margin:0;padding:0}.page{width:auto;min-height:0;padding:0;box-shadow:none}.head{break-inside:avoid}tr{break-inside:avoid}th{print-color-adjust:exact}}
  </style></head><body>${toolbar}<main class="page">${header}<div class="titlebar"><h2>${title}</h2><div class="meta"><div><span>${numLabel}:</span> <b>${e(b.docCode)}</b></div><div><span>${dateLabel}:</span> <b>${e(b.doc.date)}</b></div>${orderMeta}</div></div>${info}${table}<div class="tot">${model.summary.map((s) => `<div${s.big ? ' class="big"' : ""}><span>${e(s.label)}:</span><b>${e(s.value)}</b></div>`).join("")}</div>${model.words ? `<p class="words">${e(model.words)}</p>` : ""}${b.doc.note ? `<p class="note">Ghi chú: ${e(b.doc.note)}</p>` : ""}<div class="sign">${signs.map((s, i) => `<div><b>${s}</b><small>(Ký, ghi rõ họ tên)</small>${i === signs.length - 1 && !plain ? `<em>${e(model.signer)}</em>` : ""}</div>`).join("")}</div>${saleInvoice ? `<div class="terms"><b>Lưu ý:</b><br>${(model.footer.trim() ? model.footer.split("\n").map((t) => t.trim()).filter(Boolean) : INVOICE_NOTES).map((t) => `- ${e(t.replace(/^-\s*/, ""))}`).join("<br>")}</div>` : model.footer ? `<div class="terms">${e(model.footer).replace(/\n/g, "<br>")}</div>` : ""}${model.notices.length ? `<div class="terms">${model.notices.map(e).join("<br>")}</div>` : ""}</main><script nonce="${e(nonce)}">${script}</script></body></html>`;
}
