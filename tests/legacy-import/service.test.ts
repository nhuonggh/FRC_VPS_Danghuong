import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import type { LegacyOrder } from "@/server/legacy-import/parse";
import { commitLegacyOrders, DEFAULT_LEGACY_OPTIONS, partnerKey, previewLegacyOrders, type LegacyOptions } from "@/server/legacy-import/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePartnerGroup, makeProcessingType, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const PERMS = ["order.create", "order.edit", "sale_price.view", "order.edit_price", "deposit.manage", "partner.view_all"];
let w: World; let actor: Actor; let cash: { id: number };
let opts: LegacyOptions;

const order = (over: Partial<LegacyOrder> = {}): LegacyOrder => ({
  code: "ORD_1_20260915_0001", date: "2026-09-15", group: "", customer: "Anh Tưởng", address: "", phones: ["035-7952-332"],
  lines: [{ name: "Hộp mạ kẽm 30*60", kind: "", unit: "md", qty: 5, price: 30_000, amount: 150_000, terms: null }],
  otherFee: 0, discount: 0, total: 150_000, paid: 0, debt: 150_000, note: "", ...over,
});

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  await prisma.product.update({ where: { id: w.p.id }, data: { name: "Hộp mạ kẽm 30*60", searchText: "hop ma kem 30*60" } });
  actor = { userId: w.userId, perms: new Set(PERMS) };
  cash = await makeCashAccount({ type: "CASH", name: "Quỹ tiền mặt" });
  opts = { ...DEFAULT_LEGACY_OPTIONS, cashAccountId: cash.id };
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20_000, T(0), 1));
});

describe("nhập đơn từ phần mềm cũ", () => {
  it("khách và hàng khớp tên ⇒ sẵn sàng; ghi đơn gắn mã đơn cũ; nhập lại không tạo trùng", async () => {
    await makePartner({ name: "Anh Tưởng", searchText: "anh tuong", isCustomer: true });
    const pv = await previewLegacyOrders(prisma, actor, [order()], opts, []);
    expect(pv.orders[0]).toMatchObject({ status: "ready", ourTotal: 150_000 });
    const r1 = await commitLegacyOrders(prisma, actor, [order()], ["ORD_1_20260915_0001"], opts, []);
    expect(r1).toMatchObject({ created: 1, failed: 0 });
    const so = await prisma.saleOrder.findUniqueOrThrow({ where: { legacyCode: "ORD_1_20260915_0001" }, include: { lines: true } });
    expect(so.lines).toHaveLength(1);
    expect(so.note).toContain("ORD_1_20260915_0001");
    const r2 = await commitLegacyOrders(prisma, actor, [order()], ["ORD_1_20260915_0001"], opts, []);
    expect(r2).toMatchObject({ created: 0, failed: 1 });
    expect(await prisma.saleOrder.count()).toBe(1);
    expect((await previewLegacyOrders(prisma, actor, [order()], opts, [])).orders[0]!.status).toBe("exists");
  });

  it("đã thanh toán đủ ⇒ phiếu thu vào quỹ đã chọn; tắt tùy chọn phiếu thu ⇒ chỉ có đơn", async () => {
    await makePartner({ name: "Anh Tưởng", searchText: "anh tuong", isCustomer: true });
    await commitLegacyOrders(prisma, actor, [order({ paid: 150_000, debt: 0 })], ["ORD_1_20260915_0001"], opts, []);
    expect(await prisma.receipt.count({ where: { cashAccountId: cash.id, amount: 150_000 } })).toBe(1);
    await commitLegacyOrders(prisma, actor, [order({ code: "ORD_2", paid: 150_000, debt: 0 })], ["ORD_2"], { ...opts, createReceipts: false }, []);
    expect(await prisma.receipt.count()).toBe(1);
  });

  it("khách chưa có: khách lẻ ⇒ tạo hồ sơ khách lẻ thân quen; nhóm thợ ⇒ phải chọn tay, chọn xong được lưu cho lần sau", async () => {
    await makePartnerGroup("NHÓM BÁN LẺ");
    const retail = await previewLegacyOrders(prisma, actor, [order({ customer: "Chị Lan" })], opts, []);
    expect(retail.orders[0]).toMatchObject({ status: "ready" });
    expect(retail.orders[0]!.partner).toMatch(/Khách lẻ thân quen/);

    const tho = order({ code: "ORD_T", customer: "Anh Thợ Mới", group: "NHÓM THỢ", phones: [] });
    const pv = await previewLegacyOrders(prisma, actor, [tho], opts, []);
    expect(pv.orders[0]).toMatchObject({ status: "needs-input" });
    expect(pv.orders[0]!.needs).toEqual([{ kind: "PARTNER", key: partnerKey(tho), label: "Anh Thợ Mới" }]);

    const target = await makePartner({ name: "Thợ Mới (đã có)", searchText: "tho moi", isCustomer: true });
    const res = [{ kind: "PARTNER" as const, key: partnerKey(tho), targetId: target.id }];
    const r = await commitLegacyOrders(prisma, actor, [tho], ["ORD_T"], opts, res);
    expect(r.created).toBe(1);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { legacyCode: "ORD_T" } })).partnerId).toBe(target.id);
    expect((await previewLegacyOrders(prisma, actor, [{ ...tho, code: "ORD_T2" }], opts, [])).orders[0]!.status).toBe("ready"); // đã nhớ cách ghép
  });

  it("chọn 'bắt chọn tay' ⇒ khách chưa có không tự thành khách lẻ", async () => {
    const pv = await previewLegacyOrders(prisma, actor, [order({ customer: "Chị Lan" })], { ...opts, unknownCustomer: "manual" }, []);
    expect(pv.orders[0]!.status).toBe("needs-input");
  });

  it("hàng không khớp ⇒ cần chọn; kiểu gia công khớp theo tên bỏ dấu câu; dòng m² thành mỗi số hạng một dòng, giá/md = giá/m² × khổ", async () => {
    await makePartner({ name: "Anh Tưởng", searchText: "anh tuong", isCustomer: true });
    const ton = await makeProduct({ name: "Tôn Hoa Sen 0.35", searchText: "ton hoa sen 0.35", baseUnit: "md" });
    const type = await makeProcessingType("Tôn xốp - 11 sóng");
    await engine({ ...w, p: ton })([ton.id], (ctx) => buy(ctx, ton.id, 100, 50_000, T(0), 1));
    const line = { name: "Tôn Hoa Sen 0.35", kind: "Tôn xốp,11 sóng", unit: "m2", qty: 13.392, price: 124_000, amount: 1_660_608, terms: [{ length: 4.5, ratio: 1.08, pieces: 1 }, { length: 7.9, ratio: 1.08, pieces: 1 }] };
    const ok = order({ lines: [line], total: 1_661_000, debt: 1_661_000 });
    const pv = await previewLegacyOrders(prisma, actor, [ok], opts, []);
    expect(pv.orders[0]).toMatchObject({ status: "ready", ourTotal: 1_661_000 });
    const miss = await previewLegacyOrders(prisma, actor, [order({ lines: [{ ...line, name: "Hàng lạ" }] })], opts, []);
    expect(miss.orders[0]).toMatchObject({ status: "needs-input" });
    await commitLegacyOrders(prisma, actor, [ok], [ok.code], opts, []);
    const lines = await prisma.saleOrderLine.findMany({ where: { order: { legacyCode: ok.code } }, orderBy: { id: "asc" } });
    expect(lines.map((l) => [Number(l.qty), Number(l.salePrice), l.processingTypeId])).toEqual([[4.5, 133_920, type.id], [7.9, 133_920, type.id]]);
    expect(lines[0]!.note).toContain("4,5 m × 1,08");
  });

  it("thiếu tồn: mặc định ghi thành đơn treo; chọn chặn ⇒ không ghi gì", async () => {
    await makePartner({ name: "Anh Tưởng", searchText: "anh tuong", isCustomer: true });
    const big = order({ lines: [{ name: "Hộp mạ kẽm 30*60", kind: "", unit: "md", qty: 500, price: 30_000, amount: 15_000_000, terms: null }], total: 15_000_000, debt: 15_000_000 });
    const blocked = await commitLegacyOrders(prisma, actor, [big], [big.code], { ...opts, missingStock: "block" }, []);
    expect(blocked).toMatchObject({ created: 0, failed: 1 });
    expect(await prisma.saleOrder.count()).toBe(0);
    const allowed = await commitLegacyOrders(prisma, actor, [big], [big.code], opts, []);
    expect(allowed.created).toBe(1);
  });
});
