import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createPartner, setPartnerActive } from "@/server/partners/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup, makePeriod, makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor; let groupId: number;
const input = (over = {}) => ({ code: "", name: "Nguyễn Văn Đạt", groupId, isCustomer: true, isSupplier: false, ownerUserId: null, debtLimit: 0, allowCredit: false, phone: "0912345678", address: "", note: "", isActive: true, ...over });
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view"]) }; groupId = (await makePartnerGroup("Khách lẻ")).id; });
describe("partner service", () => {
  it("lưu các trường bổ sung (email, TK ngân hàng, người đại diện, thứ tự, chi phí)", async () => {
    const r = await tx((db) => createPartner(db, actor, input({ email: "dat@example.com", bankAccount: "0123 VCB", representative: "Đạt", sortOrder: 5, isExpense: true })));
    expect(await prisma.partner.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ email: "dat@example.com", bankAccount: "0123 VCB", representative: "Đạt", sortOrder: 5, isExpense: true });
  });
  it("trường bổ sung để trống → null, isExpense mặc định false (tương thích form cũ)", async () => {
    const r = await tx((db) => createPartner(db, actor, input()));
    expect(await prisma.partner.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ email: null, bankAccount: null, representative: null, sortOrder: null, isExpense: false });
  });
  it("công nợ đầu kỳ ghi vào số đầu kỳ của kỳ đang mở (cho phép số âm) và audit", async () => {
    const period = await makePeriod({ isOpen: true });
    const r = await tx((db) => createPartner(db, actor, input({ openingDebt: -500000 })));
    const od = await prisma.openingDebt.findUniqueOrThrow({ where: { periodId_partnerId: { periodId: period.id, partnerId: r.id } } });
    expect(od.amount.toString()).toBe("-500000");
    expect(await prisma.auditLog.findFirst({ where: { action: "opening.debt.create", entityId: String(od.id) } })).not.toBeNull();
  });
  it("không có công nợ đầu kỳ (0/bỏ trống) → không tạo dòng opening_debt, kể cả khi chưa có kỳ mở", async () => {
    const r = await tx((db) => createPartner(db, actor, input({ openingDebt: 0 })));
    expect(await prisma.openingDebt.count({ where: { partnerId: r.id } })).toBe(0);
  });
  it("kỳ đang mở đã có chứng từ → từ chối công nợ đầu kỳ và KHÔNG tạo đối tác (giao dịch hoàn tác)", async () => {
    const period = await makePeriod({ isOpen: true });
    const other = await makePartner();
    await prisma.partnerLedger.create({ data: { periodId: period.id, partnerId: other.id, debit: 1000, credit: 0, docType: "DELIVERY", docId: 1, at: new Date(), createdBy: actor.userId } });
    const before = await prisma.partner.count();
    await expect(tx((db) => createPartner(db, actor, input({ name: "Khách mới", openingDebt: 100000 })))).rejects.toMatchObject({ status: 409, code: "OPENING_PERIOD_HAS_DOCS" });
    expect(await prisma.partner.count()).toBe(before);
    expect(await prisma.openingDebt.count()).toBe(0);
    // Không nhập công nợ đầu kỳ thì vẫn tạo bình thường dù kỳ đã có chứng từ
    await expect(tx((db) => createPartner(db, actor, input({ name: "Khách mới" })))).resolves.toBeDefined();
  });
  it("tự sinh mã, chuẩn hoá searchText và gán người tạo khi chưa chọn phụ trách", async () => {
    const result = await tx((db) => createPartner(db, actor, input()));
    const row = await prisma.partner.findUniqueOrThrow({ where: { id: result.id } });
    expect(result.code).toBe("KH000001");
    expect(row).toMatchObject({ ownerUserId: actor.userId, searchText: "kh000001 nguyen van dat 0912345678" });
  });
  it("người có partner.view_all giữ đối tác chưa phân công khi để trống người phụ trách", async () => {
    const manager: Actor = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view", "partner.view_all"]) };
    const result = await tx((db) => createPartner(db, manager, input({ name: "Khách quản lý" })));
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: result.id } })).ownerUserId).toBeNull();
  });
  it("chỉ cho sửa đối tác trong phạm vi và audit thay đổi trạng thái", async () => {
    const created = await tx((db) => createPartner(db, actor, input()));
    await tx((db) => setPartnerActive(db, actor, created.id, { isActive: false }));
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false);
    expect(await prisma.auditLog.findFirst({ where: { action: "partner.set_active", entityId: String(created.id) } })).not.toBeNull();
    const another: Actor = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view"]) };
    await expect(tx((db) => setPartnerActive(db, another, created.id, { isActive: true }))).rejects.toMatchObject({ status: 404 });
  });
});
