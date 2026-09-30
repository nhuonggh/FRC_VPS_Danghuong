import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { partnerBalance } from "@/server/debt/balance";
import { debtAdjustmentSchema, debtTransferSchema } from "@/server/debt/schemas";
import { cancelDebtAdjustment, cancelDebtTransfer, createDebtAdjustment, createDebtAdjustmentIdempotent, createDebtTransfer } from "@/server/debt/service";
import { DEBT_FILTER_KEYS, getDebtDetail, listAdjustments, listDebts, listTransfers } from "@/server/debt/queries";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let a: { id: number }; let b: { id: number };
const list = (q: Record<string, string | string[]> = {}, act = actor) => listDebts(prisma, act, parseListParams(q, DEBT_FILTER_KEYS));
const led = (partnerId: number, o: { debit?: number; credit?: number }, docType = "DELIVERY", docId = 900, at = NOW) =>
  prisma.partnerLedger.create({ data: { periodId: w.periodId, partnerId, debit: o.debit ?? 0, credit: o.credit ?? 0, docType, docId, at, createdBy: w.userId } });
const bal = async (id: number) => (await partnerBalance(prisma, id)).balance.toString();
const adj = (o: Record<string, unknown> = {}) => debtAdjustmentSchema.parse({ partnerId: a.id, reason: "HANG_LOI", direction: "DECREASE", amount: 100_000, date: "2026-09-15", note: "Tôn móp", ...o });
const discount = (partnerId: number, amountIn: number) => prisma.discountLedger.create({ data: { periodId: w.periodId, partnerId, amountIn, docType: "SALE", docId: 1, at: NOW, createdBy: w.userId } });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["debt.view", "debt.adjust", "partner.view_all"]) };
  a = await makePartner({ isCustomer: true });
  b = await makePartner({ isCustomer: true });
});

describe("kiến trúc: cửa duy nhất ghi partner_ledger", () => {
  it("không module nào ngoài debt/ledger.ts gọi partnerLedger.create/update/delete…", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !p.endsWith("src/server/debt/ledger.ts") && /partnerLedger\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
});

describe("số dư và chi tiết (62, 63)", () => {
  it("số dư = đầu kỳ + Σ(debit − credit); chi tiết có số dư chạy, đối chiếu khớp, mới nhất trước", async () => {
    await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: a.id, amount: 1_000_000 } });
    await led(a.id, { debit: 500_000 }, "DELIVERY", 901, new Date("2026-09-10T03:00:00Z"));
    await led(a.id, { credit: 200_000 }, "RECEIPT", 902, new Date("2026-09-12T03:00:00Z"));
    expect(await bal(a.id)).toBe("1300000");
    expect((await partnerBalance(prisma, a.id, new Date("2026-09-11T00:00:00Z"))).balance.toString()).toBe("1500000"); // đến hết 11/09
    const d = await getDebtDetail(prisma, actor, a.id, parseListParams({}, []));
    expect(d).toMatchObject({ opening: "1000000", debit: "500000", credit: "200000", balance: "1300000", reconciled: true, total: 2 });
    expect(d.entries.map((e) => [e.docType, e.running])).toEqual([["RECEIPT", "1300000"], ["DELIVERY", "1500000"]]);
  });

  it("danh sách: bỏ số dư 0, xếp hạng nợ nhiều nhất trước, lọc kind/state, tổng phải thu/phải trả", async () => {
    const s = await makePartner({ isCustomer: false, isSupplier: true });
    await led(a.id, { debit: 300_000 }); await led(b.id, { debit: 900_000 }, "DELIVERY", 901); await led(s.id, { credit: 400_000 }, "PURCHASE", 902);
    const all = await list();
    expect(all.rows.map((r) => r.partnerId)).toEqual([b.id, a.id, s.id]);
    expect(all.summary).toMatchObject({ receivable: "1200000", payable: "400000", partners: 3 });
    expect((await list({ kind: "supplier" })).rows.map((r) => r.partnerId)).toEqual([s.id]);
    expect((await list({ state: "credit" })).rows.map((r) => r.partnerId)).toEqual([s.id]);
    expect((await list({ state: "owing" })).rows).toHaveLength(2);
    expect((await list({ sort: "code" })).rows[0]!.partnerId).toBe(a.id);
  });

  it("phạm vi 'khách của mình' và đối tác đã gộp không hiện", async () => {
    await led(a.id, { debit: 1 }); await prisma.partner.update({ where: { id: a.id }, data: { ownerUserId: w.userId } });
    await led(b.id, { debit: 2 }, "DELIVERY", 901);
    const narrow: Actor = { userId: w.userId, perms: new Set(["debt.view"]) };
    expect((await list({}, narrow)).rows.map((r) => r.partnerId)).toEqual([a.id]);
    await expect(getDebtDetail(prisma, narrow, b.id, parseListParams({}, []))).rejects.toMatchObject({ status: 404 });
  });

  it("hiệu năng: 1.000 đối tác có công nợ đọc ≤ 3 s", async () => {
    const g = await makePartnerGroup();
    await prisma.partner.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ code: `KHP${i}`, name: `Khách ${i}`, searchText: `khach ${i}`, groupId: g.id })) });
    const ids = (await prisma.partner.findMany({ where: { code: { startsWith: "KHP" } }, select: { id: true } })).map((p) => p.id);
    await prisma.partnerLedger.createMany({ data: ids.flatMap((id, i) => [1, 2, 3].map((k) => ({ periodId: w.periodId, partnerId: id, debit: 1000 * (i + k), docType: "DELIVERY", docId: 5000 + i * 3 + k, at: NOW, createdBy: w.userId }))) });
    const t0 = Date.now();
    const r = await listDebts(prisma, actor, parseListParams({ pageSize: "100" }, DEBT_FILTER_KEYS));
    expect(r.total).toBe(1000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("điều chỉnh công nợ (64)", () => {
  it("giảm nợ ⇒ credit, tăng ⇒ debit; hủy trả về như cũ; ghi chú bắt buộc; hủy 2 lần bị chặn", async () => {
    await led(a.id, { debit: 500_000 });
    const r = await tx((t) => createDebtAdjustment(t, actor, adj(), NOW));
    expect(r.code).toMatch(/^DC\d{6}$/);
    expect(await bal(a.id)).toBe("400000");
    await tx((t) => createDebtAdjustment(t, actor, adj({ direction: "INCREASE", amount: 30_000 }), NOW));
    expect(await bal(a.id)).toBe("430000");
    await tx((t) => cancelDebtAdjustment(t, actor, r.id, "Nhầm", NOW));
    expect(await bal(a.id)).toBe("530000");
    await expect(tx((t) => cancelDebtAdjustment(t, actor, r.id, "x", NOW))).rejects.toMatchObject({ status: 409 });
    expect(debtAdjustmentSchema.safeParse({ ...adj(), note: " " }).success).toBe(false);
    expect((await listAdjustments(prisma, actor, parseListParams({}, []))).rows).toHaveLength(2);
  });

  it("CHIET_KHAU: trừ nợ bằng số dư chiết khấu, không vượt số dư; hủy trả lại chiết khấu (dòng điều chỉnh)", async () => {
    await led(a.id, { debit: 500_000 }); await discount(a.id, 150_000);
    await expect(tx((t) => createDebtAdjustment(t, actor, adj({ reason: "CHIET_KHAU", amount: 200_000 }), NOW))).rejects.toMatchObject({ status: 400 });
    const r = await tx((t) => createDebtAdjustment(t, actor, adj({ reason: "CHIET_KHAU", amount: 100_000 }), NOW));
    expect(await bal(a.id)).toBe("400000");
    expect((await getDebtDetail(prisma, actor, a.id, parseListParams({}, []))).discountBalance).toBe("50000");
    expect((await prisma.discountLedger.findFirstOrThrow({ where: { docType: "DEBT_ADJ", docId: r.id } })).settleMethod).toBe("OFFSET");
    await tx((t) => cancelDebtAdjustment(t, actor, r.id, "Nhầm", NOW));
    expect((await getDebtDetail(prisma, actor, a.id, parseListParams({}, []))).discountBalance).toBe("150000");
    expect(debtAdjustmentSchema.safeParse({ partnerId: a.id, reason: "CHIET_KHAU", direction: "INCREASE", amount: 1, date: "2026-09-15", note: "x" }).success).toBe(false);
  });

  it("thiếu quyền debt.adjust bị chặn; retry cùng khoá không ghi hai lần", async () => {
    const view: Actor = { userId: w.userId, perms: new Set(["debt.view", "partner.view_all"]) };
    await expect(createDebtAdjustmentIdempotent(prisma, view, "k", adj(), NOW)).rejects.toThrow();
    const x = await createDebtAdjustmentIdempotent(prisma, actor, "same", adj(), NOW);
    const y = await createDebtAdjustmentIdempotent(prisma, actor, "same", adj(), NOW);
    expect(y.id).toBe(x.id);
    expect(await prisma.debtAdjustment.count()).toBe(1);
  });
});

describe("gộp / chuyển công nợ (65)", () => {
  const xfer = (o: Record<string, unknown>) => debtTransferSchema.parse({ kind: "TRANSFER", fromPartnerId: a.id, toPartnerId: b.id, amount: 100_000, date: "2026-09-15", note: "", ...o });

  it("chuyển một phần: hai vế cân (tổng số dư không đổi); hủy trả về như cũ", async () => {
    await led(a.id, { debit: 500_000 }); await led(b.id, { debit: 50_000 }, "DELIVERY", 901);
    const r = await tx((t) => createDebtTransfer(t, actor, xfer({}), NOW));
    expect(r.code).toMatch(/^CN\d{6}$/);
    expect([await bal(a.id), await bal(b.id)]).toEqual(["400000", "150000"]);
    await tx((t) => cancelDebtTransfer(t, actor, r.id, "Nhầm", NOW));
    expect([await bal(a.id), await bal(b.id)]).toEqual(["500000", "50000"]);
    expect((await listTransfers(prisma, actor, parseListParams({}, []))).rows[0]).toMatchObject({ kind: "TRANSFER", isCancelled: true });
  });

  it("gộp mã: chuyển toàn bộ số dư (kể cả đầu kỳ) + chiết khấu, đánh dấu đã gộp; đối tác đã gộp không thao tác được; hủy gộp khôi phục", async () => {
    await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: a.id, amount: 200_000 } });
    await led(a.id, { debit: 300_000 }); await discount(a.id, 40_000);
    const r = await tx((t) => createDebtTransfer(t, actor, xfer({ kind: "MERGE", amount: undefined }), NOW));
    expect([await bal(a.id), await bal(b.id)]).toEqual(["0", "500000"]);
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: a.id } }))).toMatchObject({ mergedIntoId: b.id, isActive: false });
    expect((await getDebtDetail(prisma, actor, b.id, parseListParams({}, []))).discountBalance).toBe("40000");
    await expect(tx((t) => createDebtAdjustment(t, actor, adj(), NOW))).rejects.toMatchObject({ status: 409 });
    await expect(tx((t) => createDebtTransfer(t, actor, xfer({ fromPartnerId: b.id, toPartnerId: a.id }), NOW))).rejects.toMatchObject({ status: 409 });
    expect((await list()).rows.map((x) => x.partnerId)).toEqual([b.id]); // mã đã gộp ẩn khỏi tổng hợp
    await tx((t) => cancelDebtTransfer(t, actor, r.id, "Gộp nhầm", NOW));
    expect([await bal(a.id), await bal(b.id)]).toEqual(["500000", "0"]);
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: a.id } }))).toMatchObject({ mergedIntoId: null, isActive: true });
    expect((await getDebtDetail(prisma, actor, a.id, parseListParams({}, []))).discountBalance).toBe("40000");
  });

  it("gộp mã đang ÂM (mình nợ): số dư âm chuyển sang mã giữ lại", async () => {
    await led(a.id, { credit: 70_000 });
    await tx((t) => createDebtTransfer(t, actor, xfer({ kind: "MERGE" }), NOW));
    expect([await bal(a.id), await bal(b.id)]).toEqual(["0", "-70000"]);
  });

  it("kiểm tra: cùng đối tác, vai trò không bao được, đối tác nhận ngừng hoạt động, thiếu quyền", async () => {
    expect(debtTransferSchema.safeParse({ kind: "TRANSFER", fromPartnerId: a.id, toPartnerId: a.id, amount: 1, date: "2026-09-15", note: "" }).success).toBe(false);
    const s = await makePartner({ isCustomer: false, isSupplier: true });
    await expect(tx((t) => createDebtTransfer(t, actor, xfer({ kind: "MERGE", fromPartnerId: a.id, toPartnerId: s.id }), NOW))).rejects.toMatchObject({ status: 400 });
    await prisma.partner.update({ where: { id: b.id }, data: { isActive: false } });
    await expect(tx((t) => createDebtTransfer(t, actor, xfer({}), NOW))).rejects.toMatchObject({ status: 400 });
    await expect(tx((t) => createDebtTransfer(t, { userId: w.userId, perms: new Set(["debt.view"]) }, xfer({}), NOW))).rejects.toThrow();
  });
});
