import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { createCashClose } from "@/server/cash/close";
import { listCashBook } from "@/server/cash/queries";
import { cashReport } from "@/server/cash/report";
import { paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { createPayment, createReceipt, reviewVoucher } from "@/server/cash/vouchers";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";

const D1 = new Date("2026-09-14T03:00:00Z"), D2 = new Date("2026-09-15T03:00:00Z"), NEXT_MORNING = new Date("2026-09-16T01:00:00Z");
const ACC = ["receipt.manage", "payment.manage", "cash.transaction.create", "cash.transaction.edit_pending", "cashbook.view", "partner.view_all"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let acc: Actor; let tre: Actor; let cash: { id: number }; let customer: { id: number };
const P = () => parseListParams({}, []);

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  acc = { userId: w.userId, perms: new Set(ACC) };
  tre = { userId: (await prisma.user.create({ data: { username: "tq", passwordHash: "x", fullName: "Thủ quỹ" } })).id, perms: new Set([...ACC, "cash.review", "cash.close"]) };
  cash = await makeCashAccount({ name: "Kế toán - quỹ tiền mặt" });
  customer = await makePartner({ isCustomer: true });
  await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: cash.id, amount: 1_000_000 } });
});

const topUp = (date: string, now: Date, amount = 10_000_000) => tx((t) => createReceipt(t, acc, receiptSchema.parse({ type: "BO_SUNG_QUY", partnerId: null, orderId: null, cashAccountId: cash.id, amount, date, note: "Giám đốc đưa" }), now));
const spend = (date: string, now: Date, amount: number) => tx((t) => createPayment(t, acc, paymentSchema.parse({ kind: "KHAC", partnerId: null, cashAccountId: cash.id, amount, date, note: "Chi lặt vặt" }), now));

describe("bổ sung quỹ + báo cáo quỹ", () => {
  it("bổ sung quỹ không gắn đối tác/đơn, không tạo công nợ", async () => {
    expect(receiptSchema.safeParse({ type: "BO_SUNG_QUY", partnerId: customer.id, orderId: null, cashAccountId: cash.id, amount: 1, date: "2026-09-15", note: "" }).success).toBe(false);
    const r = await topUp("2026-09-15", D2);
    expect(await prisma.partnerLedger.count({ where: { docType: "RECEIPT", docId: r.id } })).toBe(0);
  });

  it("sổ quỹ có nội dung, người nộp/nhận, người kiểm tra", async () => {
    const r = await topUp("2026-09-15", D2);
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", r.id));
    const e = (await listCashBook(prisma, acc, "CASH", cash.id, P())).entries[0]!;
    expect(e).toMatchObject({ content: "Bổ sung quỹ — Giám đốc đưa", reviewerName: "Thủ quỹ" });
  });

  it("ngày hôm trước chưa chốt vẫn nhập bổ sung quỹ hôm nay; đầu ngày = cuối ngày trước; chốt lùi sáng hôm sau", async () => {
    await topUp("2026-09-14", D1); await spend("2026-09-14", D1, 3_000_000);
    await topUp("2026-09-15", D2, 5_000_000); // hôm qua chưa chốt nhưng vẫn nhập được
    let rep = await cashReport(prisma, acc, cash.id, P());
    expect(rep.days.map((d) => d.ymd)).toEqual(["2026-09-15", "2026-09-14"]);
    expect(rep.days[1]).toMatchObject({ opening: "1000000", topUp: "10000000", in: "10000000", out: "3000000", closing: "8000000", close: null });
    expect(rep.days[0]).toMatchObject({ opening: "8000000", topUp: "5000000", closing: "13000000" });
    expect(rep.unclosedDays).toBe(2);

    // chốt sáng 16/09 cho số cuối ngày 15/09 ⇒ cả hai ngày trước đó có lần chốt bao phủ
    await tx((t) => createCashClose(t, tre, { cashAccountId: cash.id, closeAt: "2026-09-16T08:00:59.999+07:00", actual: 12_900_000, reason: "Thiếu 100k" }, NEXT_MORNING));
    rep = await cashReport(prisma, acc, cash.id, P());
    expect(rep.days[0]!.close).toMatchObject({ actual: "12900000", diff: "-100000", byName: "Thủ quỹ" });
  });

  it("báo cáo theo người kiểm tra, phiếu chưa kiểm nằm dòng riêng", async () => {
    const a = await topUp("2026-09-14", D1); await spend("2026-09-14", D1, 1_000_000);
    await tx((t) => reviewVoucher(t, tre, "RECEIPT", a.id));
    const rep = await cashReport(prisma, acc, cash.id, P());
    expect(rep.reviewers.find((r) => r.name === "Thủ quỹ")).toMatchObject({ vouchers: 1, in: "10000000", out: "0" });
    expect(rep.reviewers.find((r) => r.reviewerId === null)).toMatchObject({ vouchers: 1, out: "1000000" });
  });

  it("cần cashbook.view", async () => {
    await expect(cashReport(prisma, { userId: 1, perms: new Set() }, cash.id, P())).rejects.toBeTruthy();
  });
});
