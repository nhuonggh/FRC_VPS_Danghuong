import { beforeEach, describe, expect, it } from "vitest";
import { postIssue } from "@/server/inventory/ports";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, layersOf, newWorld, T } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);

describe("trả NCC: xuất kho theo FIFO như bán (spec 3.4)", () => {
  it("trả 40 cho NCC: ăn lớp cũ nhất; giá vốn xuất là FIFO (công nợ phải trả giảm theo giá thoả thuận do module trả hàng quyết định)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 100, T(0), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 130, T(1), 2));
    await run([w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 40, docType: "RETURN_SUPPLIER", docId: 1, docLineId: 1, at: T(5) }));
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "RETURN_SUPPLIER" } });
    expect(row.unitCostOut.toString()).toBe("107.5"); // (30×100 + 10×130)/40
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["0", "20"]);
    await assertChainExact(w);
  });
});
