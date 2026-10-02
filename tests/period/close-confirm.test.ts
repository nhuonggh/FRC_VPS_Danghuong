import { beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { postCashLedger } from "@/server/cash/ledger";
import { BACKUP_MAX_AGE_MS, confirmClose, previewClose } from "@/server/closing/service";
import { postPartnerLedger } from "@/server/debt/ledger";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const NOW = new Date("2026-10-01T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
let w: World; let actor: Actor; let periodName: string;
const ok = (over: Record<string, unknown> = {}) => ({ confirmName: periodName, backupAt: hoursAgo(2), acknowledged: true as const, ...over }) as Parameters<typeof confirmClose>[2];

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: ALL };
  periodName = w.period.name;
  const customer = await makePartner({ isCustomer: true }), cash = await makeCashAccount();
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
  await prisma.$transaction(async (t) => {
    const base = { periodId: w.periodId, createdBy: w.userId, at: T(5) };
    await postPartnerLedger(t, { ...base, partnerId: customer.id, side: "debit", amount: 900, docType: "DELIVERY", docId: 1 });
    await postCashLedger(t, { ...base, cashAccountId: cash.id, side: "in", amount: 250, docType: "RECEIPT", docId: 1 });
  });
});

const stillOpen = async () => expect((await prisma.period.findUniqueOrThrow({ where: { id: w.periodId } })).isOpen).toBe(true);

describe("xác nhận 2 bước", () => {
  it("tên kỳ gõ lại sai → 400 theo field, kỳ vẫn mở", async () => {
    await expect(confirmClose(prisma, actor, ok({ confirmName: periodName + " x" }), NOW)).rejects.toMatchObject({ status: 400, fields: { confirmName: expect.stringContaining(periodName) } });
    await stillOpen();
  });

  it("sao lưu quá 24 giờ / ở tương lai / sai định dạng → từ chối; sát mốc 24 giờ vẫn được", async () => {
    await expect(confirmClose(prisma, actor, ok({ backupAt: hoursAgo(25) }), NOW)).rejects.toMatchObject({ status: 400, fields: { backupAt: expect.stringContaining("24 giờ") } });
    await expect(confirmClose(prisma, actor, ok({ backupAt: new Date(NOW.getTime() + 3600_000).toISOString() }), NOW)).rejects.toMatchObject({ fields: { backupAt: expect.stringContaining("tương lai") } });
    await expect(confirmClose(prisma, actor, ok({ backupAt: "không phải ngày" }), NOW)).rejects.toThrow();
    await stillOpen();
    await expect(confirmClose(prisma, actor, ok({ backupAt: new Date(NOW.getTime() - BACKUP_MAX_AGE_MS + 1000).toISOString() }), NOW)).resolves.toBeDefined();
  });

  it("thiếu tick xác nhận → từ chối; thiếu quyền → 403", async () => {
    await expect(confirmClose(prisma, actor, ok({ acknowledged: false }), NOW)).rejects.toThrow();
    await expect(confirmClose(prisma, { userId: w.userId, perms: new Set(["order.view"]) }, ok(), NOW)).rejects.toMatchObject({ status: 403 });
    await stillOpen();
  });

  it("đủ điều kiện → kết sổ; nhật ký ghi tên xác nhận + giờ sao lưu; bấm lần 2 không tạo kỳ thứ ba", async () => {
    const backupAt = hoursAgo(3);
    const out = await confirmClose(prisma, actor, ok({ backupAt, newName: "Kỳ T10" }), NOW);
    expect(out.newPeriod.name).toBe("Kỳ T10");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "period.close" } });
    expect(audit.afterJson).toMatchObject({ confirmedName: periodName, backupAt, newPeriodName: "Kỳ T10" });
    // kỳ đang mở nay là "Kỳ T10" nên gõ lại tên kỳ cũ bị từ chối; không có kỳ nào bị đóng thêm
    await expect(confirmClose(prisma, actor, ok(), NOW)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.period.count()).toBe(2);
  });

  it("còn mục chặn → từ chối CLOSE_BLOCKED dù xác nhận đúng", async () => {
    await prisma.stocktake.create({ data: { periodId: w.periodId, code: "KK-1", at: NOW, createdBy: w.userId } });
    await expect(confirmClose(prisma, actor, ok(), NOW)).rejects.toMatchObject({ status: 409, code: "CLOSE_BLOCKED" });
    await stillOpen();
  });
});

describe("xem trước (bước 1)", () => {
  it("số xem trước = số thật được chuyển sang kỳ mới", async () => {
    const pv = await previewClose(prisma, actor);
    expect(pv).toMatchObject({ period: { name: periodName }, blockerCount: 0 });
    expect(pv.preview.stock).toMatchObject({ lots: 1, products: 1, qty: "10", value: "1000.00" });
    expect(pv.preview.receivable).toEqual({ partners: 1, total: "900.00" });
    expect(pv.preview.cash).toHaveLength(1);
    expect(pv.preview.cash[0]!.balance).toBe("250.00");
    const out = await confirmClose(prisma, actor, ok(), NOW);
    expect(out.carried).toMatchObject({ stockLots: 1, stockQty: "10", stockValue: "1000.00", debtPartners: 1, cashAccounts: 1 });
  });

  it("thiếu quyền → 403; xem trước không đổi gì", async () => {
    await expect(previewClose(prisma, { userId: w.userId, perms: new Set() })).rejects.toMatchObject({ status: 403 });
    await stillOpen();
    expect(await prisma.period.count()).toBe(1);
  });
});
