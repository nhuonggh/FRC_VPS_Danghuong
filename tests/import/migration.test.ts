import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { buildXlsx } from "@/server/export/xlsx";
import { buildRejectXlsx, commitImport, previewImport } from "@/server/import/framework";
import type { ImportSpec } from "@/server/import/types";
import { readSheet } from "@/server/import/xlsx-reader";
import { migrationStatus } from "@/server/opening/migration-status";
import { openingStockSpec } from "@/server/opening/stock";
import { partnerImportSpec } from "@/server/partners/import-spec";
import { productImportSpec } from "@/server/products/import-spec";
import { prisma, resetDb } from "../helpers/db";
import { makePartnerGroup } from "../helpers/factories";
import { newWorld } from "../inventory/helpers";

// D8: chuyển dữ liệu — dry-run trước, chạy lại không nhân đôi, số kiểu VN, 5.000 dòng ≤ 30 s.
const LIMIT_MS = 30_000;
let actor: Actor; let seq = 0;
const file = (spec: ImportSpec<never, never> | ImportSpec<any, any>, rows: Record<string, string>[]) => buildXlsx("Dữ liệu", spec.columns.map((c) => ({ header: c.header, key: c.key, text: true })), rows); // eslint-disable-line @typescript-eslint/no-explicit-any
const timed = async <R,>(fn: () => Promise<R>) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };
const commit = (spec: ImportSpec<any, any>, buf: Buffer, overwrite = false, key = `m-${++seq}`) => commitImport(prisma, actor, spec, buf, { overwrite, idempotencyKey: key }); // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(async () => {
  await resetDb();
  const w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["data.import", "partner.manage", "product.manage"]) };
});

describe("khách hàng — 5.000 dòng", () => {
  it("xem trước + ghi ≤ 30 s, chạy lại không nhân đôi, dòng trùng mã trong tệp và nhóm lạ bị loại ra tệp riêng", async () => {
    await makePartnerGroup("Khách lẻ");
    const spec = partnerImportSpec("customer");
    const rows = Array.from({ length: 5000 }, (_, i) => ({ code: `KH${String(i).padStart(5, "0")}`, name: `Khách ${i}`, group: "Khách lẻ", phone: "0912345678", address: "Q12", debtLimit: "12.500.000", allowCredit: "Có", owner: "", note: "" }));
    const buf = await file(spec, rows);
    const pv = await timed(() => previewImport(prisma, spec, buf, { overwrite: false }));
    expect(pv.r.counts.create).toBe(5000); expect(pv.ms).toBeLessThan(LIMIT_MS);
    const first = await timed(() => commit(spec, buf));
    expect(first.r.created).toBe(5000); expect(first.ms).toBeLessThan(LIMIT_MS);
    expect(await prisma.partner.count()).toBe(5000);
    expect((await prisma.partner.findFirstOrThrow({ where: { code: "KH00000" } })).debtLimit.toString()).toBe("12500000");
    const again = await commit(spec, buf);
    expect(again.created).toBe(0); expect(again.skippedExisting).toBe(5000); expect(await prisma.partner.count()).toBe(5000);

    const bad = await file(spec, [{ ...rows[0]!, code: "MOI1" }, { ...rows[0]!, code: "MOI1" }, { ...rows[0]!, code: "MOI2", group: "Nhóm lạ" }, { ...rows[1]!, code: "KH00001" }]);
    const p2 = await previewImport(prisma, spec, bad, { overwrite: false });
    expect(p2.counts).toMatchObject({ create: 1, error: 2, "skip-existing": 1 });
    const rejects = await readSheet(await buildRejectXlsx(prisma, spec, bad, { overwrite: false }), [{ key: "line", header: "Dòng", sample: "" }, { key: "reason", header: "Lý do", sample: "" }]);
    expect(rejects).toHaveLength(3);
  });
});

describe("sản phẩm — 1.300 mã", () => {
  it("số kiểu VN, mã ngừng bán ra tệp riêng, chạy lại không nhân đôi", async () => {
    const spec = productImportSpec();
    const rows = Array.from({ length: 1300 }, (_, i) => ({ code: `SP${String(i).padStart(4, "0")}`, name: `Tôn ${i}`, kind: "Hàng hóa", baseUnit: "md", minStock: "1.234,5", unit: "", factor: "", isCoil: "Không", stopped: i % 10 === 0 ? "Có" : "Không", note: "" }));
    const keys = spec.columns.map((c) => c.key);
    const buf = await buildXlsx("Dữ liệu", spec.columns.map((c) => ({ header: c.header, key: c.key, text: true })), rows.map((r) => Object.fromEntries(keys.map((k) => [k, (r as Record<string, string>)[k] ?? ""]))));
    const r = await timed(() => commit(spec, buf));
    expect(r.r.created).toBe(1170); expect(r.r.skippedReason).toBe(130); expect(r.ms).toBeLessThan(LIMIT_MS);
    expect((await prisma.product.findFirstOrThrow({ where: { code: "SP0001" } })).minStock.toString()).toBe("1234.5");
    // mã ngừng bán không nhập, nằm trong tệp dòng bị loại để khách xác nhận (D-40)
    expect(await prisma.product.count({ where: { code: "SP0000" } })).toBe(0);
    const rej = await readSheet(await buildRejectXlsx(prisma, spec, buf, { overwrite: false }), [{ key: "line", header: "Dòng", sample: "" }]);
    expect(rej).toHaveLength(1300); // 130 ngừng bán + 1.170 đã có (sau khi ghi)
    const again = await commit(spec, buf);
    expect(again.created).toBe(0); expect(await prisma.product.count()).toBe(1171) /* 1.170 + 1 mã của newWorld */;
  });
});

describe("tồn kho đầu kỳ — 1.300 mã qua engine", () => {
  it("ghi ≤ 30 s, mỗi mã một lô, số dư trang tổng hợp đúng", async () => {
    await prisma.product.createMany({ data: Array.from({ length: 1300 }, (_, i) => ({ code: `TK${i}`, name: `Hàng ${i}`, searchText: `tk${i}`, baseUnit: "md" })) });
    const spec = openingStockSpec("stock", { actor, force: false });
    const buf = await file(spec, Array.from({ length: 1300 }, (_, i) => ({ code: `TK${i}`, qty: "10", unitCost: "1.000" })));
    const r = await timed(() => commit(spec, buf));
    expect(r.r.created).toBe(1300); expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(await prisma.costLayer.count()).toBe(1300);
    const st = await migrationStatus(prisma);
    expect(st.steps.find((s) => s.key === "stock")!.count).toBe(1300);
    expect(st.steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(st.hasDocs).toBe(false);
  }, 120_000);
});
