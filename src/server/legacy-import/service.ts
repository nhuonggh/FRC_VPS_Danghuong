import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { can } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { termNote, termQty, pricePerMd } from "@/lib/length-expr";
import { normalizePhone } from "@/lib/phone";
import { normalizeSearch } from "@/lib/search";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { createCheckoutSaleOrderIdempotent, type CheckoutInput } from "@/server/sales/checkout";
import { goodsTotalOf } from "@/server/sales/queries";
import type { SaleOrderInput } from "@/server/sales/schemas";
import type { LegacyLine, LegacyOrder } from "./parse";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const r3 = (v: number) => Number(v.toFixed(3));

export const legacyOptionsSchema = z.object({
  /** Quỹ nhận tiền cho số đã thanh toán trên đơn cũ. */
  cashAccountId: z.number().int().positive().nullable(),
  /** Tạo phiếu thu cho số đã thanh toán. */
  createReceipts: z.boolean(),
  /** Giao luôn (xuất kho ngay); false = đơn chưa giao. */
  deliver: z.boolean(),
  /** Khách chưa có trong hệ thống: tạo khách lẻ thân quen theo SĐT, hay bắt chọn tay. */
  unknownCustomer: z.enum(["retail", "manual"]),
  /** Đơn thiếu tồn: cho ghi thành đơn treo, hay chặn không ghi. */
  missingStock: z.enum(["allow", "block"]),
});
export type LegacyOptions = z.infer<typeof legacyOptionsSchema>;
export const DEFAULT_LEGACY_OPTIONS: LegacyOptions = { cashAccountId: null, createReceipts: true, deliver: false, unknownCustomer: "retail", missingStock: "allow" };

export const resolutionSchema = z.object({ kind: z.enum(["PRODUCT", "PARTNER", "PROCESSING"]), key: z.string().min(1).max(300), targetId: z.number().int().min(0) });
export type Resolution = z.infer<typeof resolutionSchema>;

export interface Need { kind: Resolution["kind"]; key: string; label: string }
export interface PreviewLine { name: string; kind: string; unit: string; qty: number; price: number; product: string | null; processing: string | null; issue: string | null }
export type OrderStatus = "ready" | "needs-input" | "exists" | "error";
export interface PreviewOrder {
  code: string; date: string; customer: string; group: string; phones: string[];
  /** Cách gắn khách: tên khách trong hệ thống, hoặc khách lẻ thân quen, hoặc null (chưa có). */
  partner: string | null;
  status: OrderStatus; issues: string[]; needs: Need[]; lines: PreviewLine[];
  legacyTotal: number; ourTotal: number | null; paid: number; debt: number;
}
export interface LegacyPreview {
  orders: PreviewOrder[];
  counts: Record<OrderStatus, number>;
}

type ProductRow = { id: number; code: string; name: string; baseUnit: string; units: { unit: string; factor: Prisma.Decimal }[] };
interface Ctx {
  productsByName: Map<string, ProductRow[]>;
  productsById: Map<number, ProductRow>;
  types: { id: number; name: string; ratio: number | null }[];
  customers: { id: number; code: string; name: string; norm: string; phones: Set<string> }[];
  aliases: Map<string, number>;
  ratios: Map<string, number>;
  walkInGroupOk: (group: string) => boolean;
}

const aliasKey = (kind: string, key: string) => `${kind}:${key}`;
const productKey = (name: string) => normalizeSearch(name);
const typeKey = (kind: string) => normalizeSearch(kind);
const typeLoose = (s: string) => normalizeSearch(s).replace(/[^a-z0-9]+/g, " ").trim();
export const partnerKey = (o: Pick<LegacyOrder, "customer" | "phones">) => `${normalizeSearch(o.customer)}|${normalizePhone(o.phones[0])}`;

async function loadCtx(db: PrismaClient | Prisma.TransactionClient, actor: Actor, resolutions: readonly Resolution[]): Promise<Ctx> {
  const [products, types, partners, aliases, ratios] = await Promise.all([
    db.product.findMany({ where: { isActive: true, canSell: true }, select: { id: true, code: true, name: true, baseUnit: true, units: { select: { unit: true, factor: true } } } }),
    db.processingType.findMany({ where: { isActive: true }, select: { id: true, name: true, ratio: true } }),
    db.partner.findMany({ where: { isCustomer: true, isActive: true, mergedIntoId: null, isRegularRetail: false, ...partnerScopeWhere(actor) }, select: { id: true, code: true, name: true, phone: true } }),
    db.legacyAlias.findMany(),
    db.productProcessingRatio.findMany({ where: { ratio: { not: null } }, select: { productId: true, processingTypeId: true, ratio: true } }),
  ]);
  const productsByName = new Map<string, ProductRow[]>();
  for (const p of products) { const k = productKey(p.name); productsByName.set(k, [...(productsByName.get(k) ?? []), p]); }
  const map = new Map(aliases.map((a) => [aliasKey(a.kind, a.legacyKey), a.targetId]));
  for (const r of resolutions) map.set(aliasKey(r.kind, r.key), r.targetId);
  return {
    productsByName, productsById: new Map(products.map((p) => [p.id, p])),
    types: types.map((t) => ({ id: t.id, name: t.name, ratio: t.ratio === null ? null : Number(t.ratio) })),
    customers: partners.map((p) => ({ id: p.id, code: p.code, name: p.name, norm: normalizeSearch(p.name), phones: new Set((p.phone ?? "").split(/[-–]\s+|\s+-\s+|[,;/]/).map(normalizePhone).filter(Boolean)) })),
    aliases: map,
    ratios: new Map(ratios.map((r) => [`${r.productId}:${r.processingTypeId}`, Number(r.ratio)])),
    walkInGroupOk: (g) => !g || normalizeSearch(g) === "nhom ban le",
  };
}

function matchProduct(ctx: Ctx, name: string): { product: ProductRow | null; why: string | null } {
  const key = productKey(name);
  const aliased = ctx.aliases.get(aliasKey("PRODUCT", key));
  if (aliased !== undefined) { const p = ctx.productsById.get(aliased); return p ? { product: p, why: null } : { product: null, why: "Sản phẩm đã chọn không còn bán được." }; }
  const found = ctx.productsByName.get(key) ?? [];
  if (found.length === 1) return { product: found[0]!, why: null };
  return { product: null, why: found.length > 1 ? `Có ${found.length} sản phẩm trùng tên "${name}".` : `Không thấy sản phẩm "${name}".` };
}

/** undefined = chưa ghép được; null = không kiểu gia công. */
function matchType(ctx: Ctx, kind: string): { type: { id: number; name: string; ratio: number | null } | null | undefined } {
  if (!kind) return { type: null };
  const aliased = ctx.aliases.get(aliasKey("PROCESSING", typeKey(kind)));
  if (aliased !== undefined) return { type: aliased === 0 ? null : ctx.types.find((t) => t.id === aliased) ?? undefined };
  const exact = ctx.types.filter((t) => normalizeSearch(t.name) === normalizeSearch(kind));
  if (exact.length === 1) return { type: exact[0]! };
  const loose = ctx.types.filter((t) => typeLoose(t.name) === typeLoose(kind));
  return { type: loose.length === 1 ? loose[0]! : undefined };
}

type PartnerMatch = { kind: "partner"; id: number; label: string } | { kind: "retail" } | { kind: "none"; why: string };
function matchPartner(ctx: Ctx, o: LegacyOrder, opts: LegacyOptions): PartnerMatch {
  const aliased = ctx.aliases.get(aliasKey("PARTNER", partnerKey(o)));
  if (aliased !== undefined) { const c = ctx.customers.find((x) => x.id === aliased); return c ? { kind: "partner", id: c.id, label: `${c.code} · ${c.name}` } : { kind: "none", why: "Khách đã chọn không còn dùng được." }; }
  const phones = o.phones.map(normalizePhone).filter(Boolean);
  const byName = ctx.customers.filter((c) => c.norm === normalizeSearch(o.customer));
  const pick = byName.length > 1 ? byName.filter((c) => phones.some((p) => c.phones.has(p))) : byName;
  if (pick.length === 1) return { kind: "partner", id: pick[0]!.id, label: `${pick[0]!.code} · ${pick[0]!.name}` };
  if (byName.length === 0) {
    const byPhone = phones.length ? ctx.customers.filter((c) => phones.some((p) => c.phones.has(p))) : [];
    if (byPhone.length === 1) return { kind: "partner", id: byPhone[0]!.id, label: `${byPhone[0]!.code} · ${byPhone[0]!.name}` };
  }
  if (!byName.length && opts.unknownCustomer === "retail" && ctx.walkInGroupOk(o.group)) return { kind: "retail" };
  return { kind: "none", why: byName.length > 1 ? `Có ${byName.length} khách trùng tên "${o.customer}".` : `Chưa có khách "${o.customer}"${o.group ? ` (${o.group})` : ""}.` };
}

interface Built { input: SaleOrderInput; checkout: CheckoutInput; ourTotal: number }
interface Evaluated { preview: PreviewOrder; built: Built | null }

/** Dựng đơn của hệ thống từ một đơn cũ + tùy chọn; không ghi gì. */
function evaluate(ctx: Ctx, o: LegacyOrder, opts: LegacyOptions): Evaluated {
  const issues: string[] = [];
  const needs: Need[] = [];
  const addNeed = (n: Need) => { if (!needs.some((x) => x.kind === n.kind && x.key === n.key)) needs.push(n); };
  const lines: SaleOrderInput["lines"] = [];
  const view: PreviewLine[] = [];

  const partner = matchPartner(ctx, o, opts);
  if (partner.kind === "none") { issues.push(partner.why); addNeed({ kind: "PARTNER", key: partnerKey(o), label: `${o.customer}${o.phones[0] ? ` · ${o.phones[0]}` : ""}` }); }
  if (!o.date) issues.push("Ngày đơn không hợp lệ.");

  for (const l of o.lines) {
    const pv: PreviewLine = { name: l.name, kind: l.kind, unit: l.unit, qty: l.qty, price: l.price, product: null, processing: null, issue: null };
    view.push(pv);
    const { product, why } = matchProduct(ctx, l.name);
    const { type } = matchType(ctx, l.kind);
    if (!product) { pv.issue = why; addNeed({ kind: "PRODUCT", key: productKey(l.name), label: l.name }); }
    else pv.product = `${product.code} · ${product.name}`;
    if (type === undefined) { pv.issue = pv.issue ?? `Chưa ghép kiểu gia công "${l.kind}".`; addNeed({ kind: "PROCESSING", key: typeKey(l.kind), label: l.kind }); }
    else pv.processing = type?.name ?? null;
    if (!product || type === undefined) continue;
    const built = buildLines(ctx, product, type, l);
    if ("error" in built) { pv.issue = built.error; continue; }
    lines.push(...built.lines);
  }
  if (view.some((v) => v.issue)) issues.push(...view.filter((v) => v.issue).map((v) => `${v.name}: ${v.issue}`));

  const blocked = needs.length > 0 || view.some((v) => v.issue) || !o.date;
  const base: PreviewOrder = {
    code: o.code, date: o.date, customer: o.customer, group: o.group, phones: o.phones,
    partner: partner.kind === "partner" ? partner.label : partner.kind === "retail" ? "Khách lẻ thân quen (tạo theo SĐT/tên)" : null,
    status: needs.length ? "needs-input" : blocked ? "error" : "ready", issues: [...new Set(issues)], needs, lines: view,
    legacyTotal: o.total, ourTotal: null, paid: o.paid, debt: o.debt,
  };
  if (blocked || partner.kind === "none") return { preview: base, built: null };

  const goods = goodsTotalOf(lines.map((l) => ({ qty: D(l.qty), salePrice: D(l.salePrice), discountNow: D(0) })), { roundAmounts: false, roundTotal: true, roundNearest: true });
  const ourTotal = Math.max(0, goods.minus(o.discount || 0).plus(o.otherFee || 0).toNumber());
  base.ourTotal = ourTotal;

  const fullyPaid = o.paid > 0 && o.paid >= o.total - 1;
  const pay = fullyPaid ? ourTotal : Math.min(o.paid, ourTotal);
  const checkout: CheckoutInput = {};
  if (partner.kind === "retail") checkout.walkIn = { name: o.customer, phone: o.phones[0] ?? "" };
  if (opts.deliver) checkout.pickupNow = true;
  if (opts.createReceipts && pay > 0) {
    if (!opts.cashAccountId) { base.status = "error"; base.issues.push("Đơn có tiền đã thanh toán nhưng chưa chọn quỹ nhận tiền."); return { preview: base, built: null }; }
    checkout.payments = [{ amount: pay, cashAccountId: opts.cashAccountId, note: `Nhập từ phần mềm cũ (${o.code})` }];
  }
  const note = [`Nhập từ phần mềm cũ: ${o.code}`, o.address && `Địa chỉ: ${o.address}`, o.note].filter(Boolean).join(" · ").slice(0, 500);
  const input: SaleOrderInput = {
    partnerId: partner.kind === "partner" ? partner.id : 1, date: o.date, expectedDeliveryDate: o.date, note, lines,
    ...(o.otherFee > 0 ? { shippingFee: o.otherFee } : {}), ...(o.discount > 0 ? { orderDiscount: o.discount } : {}),
    shipAddress: o.address.replace(/^-+>\s*/, "").slice(0, 250), paymentMethod: "NONE",
  };
  return { preview: base, built: { input, checkout, ourTotal } };
}

function findUnit(p: ProductRow, unit: string): string | null {
  const want = normalizeSearch(unit);
  return [p.baseUnit, ...p.units.map((u) => u.unit)].find((u) => normalizeSearch(u) === want) ?? null;
}

function buildLines(ctx: Ctx, p: ProductRow, type: { id: number; ratio: number | null } | null, l: LegacyLine): { lines: SaleOrderInput["lines"] } | { error: string } {
  const typeId = type?.id ?? null;
  const common = { discountNow: 0, discountAccum: 0, processingTypeId: typeId };
  if (l.terms) {
    // Bán theo kích thước: mỗi số hạng một dòng, SL theo md (đơn vị gốc) — đúng như màn "Nhập nhanh theo kích thước"
    if (!typeId) return { error: "Dòng bán theo m² nhưng không có kiểu gia công." };
    return { lines: l.terms.map((t) => ({ productId: p.id, unit: p.baseUnit, qty: termQty(t), salePrice: pricePerMd(l.price, t.ratio), note: termNote(t, t.ratio), ...common })) };
  }
  if (["m2", "m²"].includes(l.unit.toLowerCase()) && !findUnit(p, l.unit)) {
    const ratio = (typeId && ctx.ratios.get(`${p.id}:${typeId}`)) || type?.ratio || 0;
    if (!(ratio > 0)) return { error: "Bán theo m² nhưng chưa có tỷ lệ m²/md của sản phẩm × kiểu gia công." };
    const qty = r3(l.qty / ratio);
    if (!(qty > 0)) return { error: "Số lượng quá nhỏ." };
    return { lines: [{ productId: p.id, unit: p.baseUnit, qty, salePrice: pricePerMd(l.price, ratio), note: `${l.qty} m² ÷ ${String(ratio).replace(".", ",")}`.slice(0, 200), ...common }] };
  }
  const unit = findUnit(p, l.unit);
  if (!unit) return { error: `Sản phẩm chưa có đơn vị "${l.unit}" (có: ${[p.baseUnit, ...p.units.map((u) => u.unit)].join(", ")}).` };
  if (Number(l.qty.toFixed(3)) !== l.qty || Number(l.price.toFixed(2)) !== l.price) return { error: "Số lượng hoặc đơn giá quá nhiều chữ số thập phân." };
  return { lines: [{ productId: p.id, unit, qty: l.qty, salePrice: l.price, ...common }] };
}

async function existingCodes(db: PrismaClient | Prisma.TransactionClient, codes: string[]) {
  const rows = await db.saleOrder.findMany({ where: { legacyCode: { in: codes } }, select: { legacyCode: true, code: true } });
  return new Map(rows.map((r) => [r.legacyCode!, r.code]));
}

export async function previewLegacyOrders(prisma: PrismaClient, actor: Actor, orders: LegacyOrder[], opts: LegacyOptions, resolutions: Resolution[]): Promise<LegacyPreview> {
  const ctx = await loadCtx(prisma, actor, resolutions);
  const done = await existingCodes(prisma, orders.map((o) => o.code));
  const out: PreviewOrder[] = orders.map((o) => {
    const dup = done.get(o.code);
    if (dup) return { code: o.code, date: o.date, customer: o.customer, group: o.group, phones: o.phones, partner: null, status: "exists" as const, issues: [`Đã nhập trước đó (đơn ${dup}).`], needs: [], lines: [], legacyTotal: o.total, ourTotal: null, paid: o.paid, debt: o.debt };
    return evaluate(ctx, o, opts).preview;
  });
  const counts: Record<OrderStatus, number> = { ready: 0, "needs-input": 0, exists: 0, error: 0 };
  out.forEach((o) => counts[o.status]++);
  return { orders: out, counts };
}

export interface CommitRow { code: string; ok: boolean; orderCode?: string; error?: string }

/** Ghi các đơn đã chọn, MỖI ĐƠN MỘT GIAO DỊCH (đơn lỗi không kéo theo đơn khác). Chạy lại không tạo trùng (mã đơn cũ là khóa). */
export async function commitLegacyOrders(prisma: PrismaClient, actor: Actor, orders: LegacyOrder[], selected: string[], opts: LegacyOptions, resolutions: Resolution[]): Promise<{ rows: CommitRow[]; created: number; failed: number }> {
  if (!can(actor.perms, "order.create") || !can(actor.perms, "sale_price.view")) throw new DomainError("Bạn không có quyền lập đơn bán.", 403);
  if (opts.createReceipts && !can(actor.perms, "deposit.manage")) throw new DomainError("Bạn không có quyền tạo phiếu thu (deposit.manage). Hãy tắt tùy chọn tạo phiếu thu.", 403);
  if (opts.deliver && !can(actor.perms, "order.edit")) throw new DomainError("Bạn không có quyền giao hàng (order.edit). Hãy tắt tùy chọn giao luôn.", 403);
  const pick = new Set(selected);
  const todo = orders.filter((o) => pick.has(o.code));
  if (!todo.length) throw new DomainError("Chưa chọn đơn nào để nhập.", 400);
  await saveResolutions(prisma, actor, resolutions);
  const ctx = await loadCtx(prisma, actor, resolutions);
  const done = await existingCodes(prisma, todo.map((o) => o.code));
  const rows: CommitRow[] = [];
  for (const o of todo) {
    const dup = done.get(o.code);
    if (dup) { rows.push({ code: o.code, ok: false, orderCode: dup, error: "Đã nhập trước đó." }); continue; }
    const ev = evaluate(ctx, o, opts);
    if (!ev.built) { rows.push({ code: o.code, ok: false, error: ev.preview.issues[0] ?? "Đơn chưa đủ thông tin để nhập." }); continue; }
    try {
      const res = await createCheckoutSaleOrderIdempotent(prisma, actor, `legacy-${o.code}`, ev.built.input, ev.built.checkout, new Date(), { legacyCode: o.code, blockProvisional: opts.missingStock === "block" });
      rows.push({ code: o.code, ok: true, orderCode: res.code });
    } catch (e) {
      rows.push({ code: o.code, ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định." });
    }
  }
  const created = rows.filter((r) => r.ok).length;
  await writeAudit(prisma, { userId: actor.userId, action: "legacy-import.sales", entity: "SaleOrder", after: { requested: todo.length, created, failed: rows.length - created } });
  return { rows, created, failed: rows.length - created };
}

/** Lưu cách ghép người dùng đã chọn để lần nhập sau tự khớp. Đích phải tồn tại (không lưu rác). */
async function saveResolutions(prisma: PrismaClient, actor: Actor, resolutions: readonly Resolution[]) {
  for (const r of resolutions) {
    const ok =
      r.kind === "PROCESSING" ? r.targetId === 0 || !!(await prisma.processingType.findUnique({ where: { id: r.targetId }, select: { id: true } }))
      : r.kind === "PRODUCT" ? r.targetId > 0 && !!(await prisma.product.findUnique({ where: { id: r.targetId }, select: { id: true } }))
      : r.targetId > 0 && !!(await prisma.partner.findFirst({ where: { id: r.targetId, isCustomer: true, ...partnerScopeWhere(actor) }, select: { id: true } }));
    if (!ok) throw new DomainError("Lựa chọn ghép không hợp lệ (đối tượng không tồn tại hoặc ngoài phạm vi của bạn).", 400);
    await prisma.legacyAlias.upsert({ where: { kind_legacyKey: { kind: r.kind, legacyKey: r.key } }, create: { kind: r.kind, legacyKey: r.key, targetId: r.targetId, createdBy: actor.userId }, update: { targetId: r.targetId, createdBy: actor.userId } });
  }
}
