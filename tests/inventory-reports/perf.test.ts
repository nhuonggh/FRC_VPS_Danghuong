import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { onHandList, STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
import { stockCardList } from "@/server/inventory-reports/stock-card";
import { xntList } from "@/server/inventory-reports/xnt";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod, makeUser } from "../helpers/factories";

const STRICT = process.env.PERF_STRICT === "1";
const actor = { userId: 1, perms: new Set(["stock.view", "cost.view"]) };
let periodId = 0;
let userId = 0;

async function timed<T>(label: string, action: () => Promise<T>) {
  const started = performance.now();
  const result = await action();
  const ms = performance.now() - started;
  console.info(`[perf] ${label}: ${ms.toFixed(0)} ms`);
  if (STRICT) expect(ms, label).toBeLessThan(3_000);
  return result;
}

beforeAll(async () => {
  await resetDb();
  const user = await makeUser();
  userId = user.id;
  periodId = (await makePeriod({ openedAt: new Date("2026-01-01T00:00:00.000Z") })).id;
  await prisma.$executeRaw`INSERT INTO products (code, name, "searchText", "baseUnit", "updatedAt") SELECT 'P' || g, 'Sản phẩm ' || g, 'p' || g || ' san pham ' || g, 'md', now() FROM generate_series(1, 1300) g`;
  await prisma.$executeRaw`
    INSERT INTO stock_ledger ("periodId", "productId", "docType", "docId", "docLineId", "qtyIn", "qtyOut", "unitCostOut", "qtyProvisional", at, "createdBy")
    SELECT ${periodId}, p.id, 'PURCHASE'::stock_doc_type, s, s, 100, 0, 0, 0, TIMESTAMPTZ '2026-03-01 00:00:00+00' + (s || ' days')::interval, ${userId}
    FROM products p, generate_series(1, 10) s`;
  await prisma.$executeRaw`
    INSERT INTO cost_layers ("periodId", "productId", "sourceDocType", "sourceDocId", "sourceLineId", "ledgerId", "qtyIn", "qtyRemaining", "unitCost", at)
    SELECT sl."periodId", sl."productId", 'PURCHASE'::stock_doc_type, sl."docId", sl."docLineId", sl.id, 100, 60, 10000, sl.at
    FROM stock_ledger sl WHERE sl."qtyIn" > 0`;
  await prisma.$executeRaw`
    INSERT INTO stock_ledger ("periodId", "productId", "docType", "docId", "docLineId", "qtyIn", "qtyOut", "unitCostOut", "qtyProvisional", at, "createdBy")
    SELECT ${periodId}, p.id, 'SALE'::stock_doc_type, 1000 + s, 1000 + s, 0, 40, 10000, 0, TIMESTAMPTZ '2026-03-15 00:00:00+00' + (s || ' days')::interval, ${userId}
    FROM products p, generate_series(1, 10) s`;
  await prisma.$executeRaw`ANALYZE products`;
  await prisma.$executeRaw`ANALYZE stock_ledger`;
  await prisma.$executeRaw`ANALYZE cost_layers`;
}, 120_000);

afterAll(resetDb);

describe("hiệu năng báo cáo kho — 1.300 mã × 20 dòng sổ", () => {
  it("tồn hiện tại, XNT và thẻ kho không hồi quy", async () => {
    const onHand = await timed("onHandList", () => onHandList(prisma, actor, parseListParams({}, STOCK_FILTER_KEYS)));
    expect(onHand.total).toBe(1300);
    expect(onHand.rows[0]!.onHand).toBe("600");
    const xnt = await timed("xntList", () => xntList(prisma, actor, { from: new Date("2026-01-01T00:00:00.000Z"), to: new Date("2026-04-30T00:00:00.000Z"), page: 1, pageSize: 50 }));
    expect(xnt).toMatchObject({ total: 1300 });
    expect(xnt.totals.inQty).toBe("1300000");
    const product = await prisma.product.findFirstOrThrow({ where: { code: "P1" } });
    const card = await timed("stockCardList", () => stockCardList(prisma, actor, product.id, { page: 1, pageSize: 50 }));
    expect(card.total).toBe(20);
  }, 120_000);
});
