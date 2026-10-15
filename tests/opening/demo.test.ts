import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import demo from "@/server/opening/demo-data.json";
import { demoStatus, loadDemoOpening, resetDemoOpening } from "@/server/opening/demo";
import { getOnHand } from "@/server/inventory";
import { listOpening } from "@/server/opening/queries";
import { openingMoneySpec } from "@/server/opening/money";
import { buildXlsx } from "@/server/export/xlsx";
import { commitImport } from "@/server/import/framework";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeProduct } from "../helpers/factories";
import { newWorld, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
let w: World; let boss: Actor; let n = 0;

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  boss = { userId: w.userId, perms: new Set(["data.import", "period.close"]) };
  // Danh mục tối thiểu khớp mã trong dữ liệu demo
  for (const d of demo.debts.slice(0, 3)) await makePartner({ code: d.code.toUpperCase(), isCustomer: true });
  for (const s of demo.stock.slice(0, 2)) await makeProduct({ code: s.code });
  await makeCashAccount({ type: "CASH", name: demo.cash[0]!.name });
});

describe("số demo đầu kỳ", () => {
  it("nạp: gắn cờ isDemo, tồn kho đi qua engine, bỏ qua mã không có trong danh mục; chạy lại không nhân đôi", async () => {
    const r = await loadDemoOpening(prisma, boss);
    expect(r.debt).toBe(3); expect(r.stock).toBe(2); expect(r.cash).toBe(1); expect(r.skipped).toBeGreaterThan(0);
    expect(await prisma.openingDebt.count({ where: { isDemo: true } })).toBe(3);
    const first = demo.stock[0]!; const product = await prisma.product.findUniqueOrThrow({ where: { code: first.code } });
    expect(Number(await getOnHand(prisma, w.periodId, product.id))).toBe(first.qty);
    expect((await demoStatus(prisma)).total).toBe(r.total);
    const again = await loadDemoOpening(prisma, boss);
    expect(again.total).toBe(0); expect(await prisma.openingDebt.count()).toBe(3);
  });

  it("bộ lọc chỉ số demo: số thật không bị lẫn vào; đếm demo/tổng", async () => {
    await loadDemoOpening(prisma, boss);
    const real = await makePartner({ code: "THAT1", isCustomer: true });
    await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: real.id, amount: 1000 } });
    const all = await listOpening(prisma, "debt"); const only = await listOpening(prisma, "debt", { onlyDemo: true });
    expect(all.rows.length).toBe(4); expect(only.rows.length).toBe(3); expect(only.rows.every((x) => x.isDemo)).toBe(true);
    expect(all.demoCount).toBe(3); expect(all.allCount).toBe(4); expect(all.hasDocs).toBe(false);
  });

  it("reset: xoá đúng số demo (kể cả lớp tồn qua engine), giữ số thật; nhập Excel ghi đè một dòng demo ⇒ thành số thật", async () => {
    await loadDemoOpening(prisma, boss);
    const real = await makePartner({ code: "THAT2", isCustomer: true });
    await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: real.id, amount: 5000 } });
    // ghi đè dòng demo đầu tiên bằng số thật
    const target = demo.debts[0]!.code.toUpperCase();
    const buf = await buildXlsx("Mẫu", [{ header: "Mã đối tác", key: "key", text: true }, { header: "Số dư (+ khách nợ, − mình nợ)", key: "amount", text: true }], [{ key: target, amount: "777" }]);
    await commitImport(prisma, boss, openingMoneySpec("debt", { actor: boss, force: true }), buf, { overwrite: true, idempotencyKey: `ov-${++n}` });
    expect((await prisma.openingDebt.findFirstOrThrow({ where: { partner: { code: target } } })).isDemo).toBe(false);

    const res = await resetDemoOpening(prisma, boss);
    expect(res.debt).toBe(2); expect(res.stock).toBe(2); expect(res.cash).toBe(1);
    expect(await prisma.openingDebt.count()).toBe(2); // THAT2 + dòng đã ghi đè
    expect(await prisma.openingStock.count()).toBe(0);
    expect(await prisma.stockLedger.count({ where: { docType: "OPENING" } })).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
    expect((await demoStatus(prisma)).total).toBe(0);
  });

  it("chỉ giám đốc (period.close) nạp/reset được", async () => {
    const staff: Actor = { userId: w.userId, perms: new Set(["data.import"]) };
    await expect(loadDemoOpening(prisma, staff)).rejects.toMatchObject({ status: 403 });
    await expect(resetDemoOpening(prisma, staff)).rejects.toMatchObject({ status: 403 });
  });
});
