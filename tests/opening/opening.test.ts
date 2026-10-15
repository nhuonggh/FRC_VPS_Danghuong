import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { partnerBalance, discountBalance } from "@/server/debt/balance";
import { buildXlsx } from "@/server/export/xlsx";
import { commitImport, previewImport } from "@/server/import/framework";
import type { ImportSpec } from "@/server/import/types";
import { getOnHand } from "@/server/inventory";
import { openingMoneySpec, openingMoneyColumns, type OpeningMoneyKind } from "@/server/opening/money";
import { listOpening } from "@/server/opening/queries";
import { openingStockSpec } from "@/server/opening/stock";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, sell, T, useNoopCostOwners, type World } from "../inventory/helpers";
import { assertChainExact } from "../inventory/reference";

useNoopCostOwners();
let w: World; let seq = 0;
const staff: Actor = { userId: 0, perms: new Set(["data.import"]) };
const boss = (): Actor => ({ userId: staff.userId, perms: new Set(["data.import", "period.close"]) });
const stockCols = [{ header: "Mã", key: "code", text: true }, { header: "Số lượng", key: "qty", text: true }, { header: "Giá vốn / đơn vị gốc", key: "unitCost", text: true }];
const sheet = async (cols: { header: string; key: string; text?: boolean }[], rows: Record<string, string>[]) => buildXlsx("Mẫu", cols.map((c) => ({ ...c, text: true })), rows);
const stockFile = (rows: { code: string; qty: string; unitCost: string }[]) => sheet(stockCols, rows);
const moneyFile = (kind: OpeningMoneyKind, rows: { key: string; amount: string }[]) => sheet(openingMoneyColumns(kind).map((c) => ({ header: c.header, key: c.key })), rows);
const run = <T, C>(spec: ImportSpec<T, C>, buf: Buffer, overwrite = false, key = `k-${++seq}`) => commitImport(prisma, staff, spec, buf, { overwrite, idempotencyKey: key });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  staff.userId = w.userId;
});

describe("K1/K4 — tồn đầu kỳ qua engine", () => {
  it("nhập xong: lớp OPENING đúng số lượng/giá vốn, tồn = Σ lớp, bán ngay dùng đúng giá vốn lô, engine ≡ oracle", async () => {
    const a = await makeProduct({ code: "TON1" }); const b = await makeProduct({ code: "TON2" });
    const buf = await stockFile([{ code: "TON1", qty: "1.250,5", unitCost: "18.500" }, { code: "ton2", qty: "10", unitCost: "7.250,5" }]);
    const spec = openingStockSpec("stock", { actor: staff, force: false });
    expect((await previewImport(prisma, spec, buf, { overwrite: false })).counts.create).toBe(2);
    const r = await run(spec, buf);
    expect(r.created).toBe(2);
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("1250.5");
    const layers = await prisma.costLayer.findMany({ where: { productId: b.id } });
    expect(layers).toHaveLength(1); expect(layers[0]!.unitCost.toString()).toBe("7250.5");
    const led = await prisma.stockLedger.findMany({ where: { docType: "OPENING" } });
    expect(led).toHaveLength(2);
    expect((await prisma.openingStock.count())).toBe(2);
    await engine(w)([a.id], (ctx) => sell(ctx, a.id, 100, T(10), 1));
    const sale = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } });
    expect(sale.unitCostOut.toString()).toBe("18500");
    await assertChainExact(w, a.id); await assertChainExact(w, b.id);
    const list = await listOpening(prisma, "stock");
    expect(list.rows).toHaveLength(2); expect(list.hasDocs).toBe(true);
  });

  it("chạy lại không nhân đôi: cùng khoá = phát lại; khoá mới không ghi đè = bỏ qua; ghi đè = thay lô, không thêm dòng sổ", async () => {
    const a = await makeProduct({ code: "TON1" });
    const spec = () => openingStockSpec("stock", { actor: staff, force: false });
    await run(spec(), await stockFile([{ code: "TON1", qty: "5", unitCost: "100" }]), false, "same");
    const replay = await run(spec(), await stockFile([{ code: "TON1", qty: "5", unitCost: "100" }]), false, "same");
    expect(replay.created).toBe(1); expect(await prisma.openingStock.count()).toBe(1);
    const again = await run(spec(), await stockFile([{ code: "TON1", qty: "9", unitCost: "200" }]));
    expect(again.created).toBe(0); expect(again.skippedExisting).toBe(1);
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("5");
    const over = await run(spec(), await stockFile([{ code: "TON1", qty: "9", unitCost: "200" }]), true);
    expect(over.updated).toBe(1);
    expect(await prisma.stockLedger.count({ where: { docType: "OPENING" } })).toBe(1);
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("9");
    expect((await prisma.costLayer.findMany({ where: { productId: a.id } }))[0]!.unitCost.toString()).toBe("200");
    await assertChainExact(w, a.id);
  });

  it("từ chối mã lạ, NVL nhập nhầm màn hàng hóa (và ngược lại), số lượng ≤ 0, giá vốn sai; K4 chỉ nhận NVL", async () => {
    await makeProduct({ code: "HH1" }); await makeProduct({ code: "NVL1", kind: "NVL" });
    const buf = await stockFile([{ code: "KHONGCO", qty: "1", unitCost: "1" }, { code: "NVL1", qty: "1", unitCost: "1" }, { code: "HH1", qty: "0", unitCost: "1" }, { code: "HH1", qty: "1", unitCost: "abc" }]);
    const pv = await previewImport(prisma, openingStockSpec("stock", { actor: staff, force: false }), buf, { overwrite: false });
    expect(pv.counts.error).toBe(4);
    const mat = await previewImport(prisma, openingStockSpec("material", { actor: staff, force: false }), await stockFile([{ code: "NVL1", qty: "2", unitCost: "5" }, { code: "HH1", qty: "2", unitCost: "5" }]), { overwrite: false });
    expect(mat.counts.create).toBe(1); expect(mat.counts.error).toBe(1);
  });

  it("chặn khi kỳ đã có chứng từ; ép qua chỉ khi có period.close", async () => {
    const a = await makeProduct({ code: "TON1" });
    await engine(w)([a.id], (ctx) => buy(ctx, a.id, 5, 10, T(0), 1));
    const buf = await stockFile([{ code: "TON1", qty: "1", unitCost: "1" }]);
    await expect(previewImport(prisma, openingStockSpec("stock", { actor: staff, force: false }), buf, { overwrite: false })).rejects.toMatchObject({ code: "OPENING_PERIOD_HAS_DOCS" });
    await expect(previewImport(prisma, openingStockSpec("stock", { actor: staff, force: true }), buf, { overwrite: false })).rejects.toMatchObject({ status: 403 });
    const ok = await previewImport(prisma, openingStockSpec("stock", { actor: boss(), force: true }), buf, { overwrite: false });
    expect(ok.counts.create).toBe(1);
  });
});

describe("K2/K3/chiết khấu — số dư đầu kỳ", () => {
  it("công nợ: khách dương, NCC âm; số dư đọc = đầu kỳ; ghi đè cập nhật, chạy lại không nhân đôi", async () => {
    const c = await makePartner({ code: "KH900", isCustomer: true }); const s = await makePartner({ code: "NCC900", isCustomer: false, isSupplier: true });
    const spec = () => openingMoneySpec("debt", { actor: staff, force: false });
    const buf = await moneyFile("debt", [{ key: "kh900", amount: "12.500.000" }, { key: "NCC900", amount: "-3.000.000" }, { key: "KH900X", amount: "1" }]);
    const r = await run(spec(), buf); expect(r.created).toBe(2); expect(r.failed).toBe(1);
    expect((await partnerBalance(prisma, c.id)).balance.toString()).toBe("12500000");
    expect((await partnerBalance(prisma, s.id)).balance.toString()).toBe("-3000000");
    const skip = await run(spec(), await moneyFile("debt", [{ key: "KH900", amount: "1" }])); expect(skip.skippedExisting).toBe(1);
    const over = await run(spec(), await moneyFile("debt", [{ key: "KH900", amount: "7.000.000" }]), true); expect(over.updated).toBe(1);
    expect((await partnerBalance(prisma, c.id)).balance.toString()).toBe("7000000");
    expect(await prisma.openingDebt.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "opening.debt" } } })).toBe(3);
  });

  it("chiết khấu: chỉ khách, không âm, 0 bị bỏ qua; số dư chiết khấu = đầu kỳ", async () => {
    const c = await makePartner({ code: "KH901", isCustomer: true }); const s = await makePartner({ code: "NCC901", isCustomer: false, isSupplier: true });
    await makePartner({ code: "KH902", isCustomer: true });
    const pv = await previewImport(prisma, openingMoneySpec("discount", { actor: staff, force: false }), await moneyFile("discount", [{ key: "KH901", amount: "1.200.000" }, { key: "NCC901", amount: "5" }, { key: "KH902", amount: "-1" }, { key: "KH902", amount: "0" }]), { overwrite: false });
    expect(pv.counts.create).toBe(1); expect(pv.counts.error).toBe(2); expect(pv.counts["skip-reason"]).toBe(1);
    await run(openingMoneySpec("discount", { actor: staff, force: false }), await moneyFile("discount", [{ key: "KH901", amount: "1.200.000" }]));
    expect((await discountBalance(prisma, c.id)).toString()).toBe("1200000");
    expect((await discountBalance(prisma, s.id)).toString()).toBe("0");
  });

  it("quỹ: khớp theo tên (không phân biệt hoa thường/dấu), quỹ tắt bị từ chối, số dư vào opening_cash", async () => {
    const a = await makeCashAccount({ name: "Tiền mặt" }); await makeCashAccount({ name: "Quỹ cũ", isActive: false });
    const spec = () => openingMoneySpec("cash", { actor: staff, force: false });
    const r = await run(spec(), await moneyFile("cash", [{ key: "tien mat", amount: "50.000.000" }, { key: "Quỹ cũ", amount: "1" }, { key: "Không có", amount: "1" }]));
    expect(r.created).toBe(1); expect(r.failed).toBe(2);
    expect((await prisma.openingCash.findFirstOrThrow({ where: { cashAccountId: a.id } })).amount.equals(new Prisma.Decimal(50_000_000))).toBe(true);
    expect((await listOpening(prisma, "cash")).total).toBe("50000000");
  });

  it("kỳ đã có công nợ/quỹ ghi sổ thì chặn", async () => {
    const c = await makePartner({ code: "KH950", isCustomer: true });
    await prisma.partnerLedger.create({ data: { periodId: w.periodId, partnerId: c.id, docType: "DELIVERY", docId: 1, debit: 1, credit: 0, createdBy: w.userId, at: new Date("2026-09-01T00:00:00Z") } });
    await expect(previewImport(prisma, openingMoneySpec("debt", { actor: staff, force: false }), await moneyFile("debt", [{ key: "KH950", amount: "1" }]), { overwrite: false })).rejects.toMatchObject({ code: "OPENING_PERIOD_HAS_DOCS" });
  });
});
