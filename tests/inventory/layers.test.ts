import { beforeEach, describe, expect, it } from "vitest";
import { restoreLayerRemaining } from "@/server/inventory/layers";
import { prisma, resetDb } from "../helpers/db";
import { newWorld } from "./helpers";

beforeEach(resetDb);

async function layerWithConsumptions(consumed: string[], qtyIn = "3") {
  const w = await newWorld();
  const at = new Date("2026-09-01T00:00:00Z");
  const led = await prisma.stockLedger.create({
    data: { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn, at, createdBy: w.userId },
  });
  const layer = await prisma.costLayer.create({
    data: { periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: led.id, qtyIn, qtyRemaining: qtyIn, unitCost: 1, at },
  });
  for (const [i, q] of consumed.entries()) {
    const out = await prisma.stockLedger.create({
      data: { periodId: w.periodId, productId: w.p.id, docType: "SALE", docId: 10 + i, docLineId: 10 + i, qtyOut: q, at, createdBy: w.userId },
    });
    await prisma.costConsumption.create({ data: { layerId: layer.id, ledgerId: out.id, docType: "SALE", docLineId: 10 + i, qty: q, unitCost: 1 } });
  }
  return { w, layer };
}

describe("restoreLayerRemaining", () => {
  it("qty_remaining = qty_in − Σ consumption còn lại (giữ 3 chữ số thập phân, không lệch dấu phẩy động)", async () => {
    const { layer } = await layerWithConsumptions(["1.001", "0.002"]);
    await restoreLayerRemaining(prisma, [layer.id]);
    expect((await prisma.costLayer.findUniqueOrThrow({ where: { id: layer.id } })).qtyRemaining.toString()).toBe("1.997");
  });

  it("không còn consumption → về đủ qty_in; id trùng lặp / danh sách rỗng đều an toàn", async () => {
    const { layer } = await layerWithConsumptions([], "7.5");
    await prisma.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: 0 } });
    await restoreLayerRemaining(prisma, []);
    expect((await prisma.costLayer.findUniqueOrThrow({ where: { id: layer.id } })).qtyRemaining.toString()).toBe("0");
    await restoreLayerRemaining(prisma, [layer.id, layer.id]);
    expect((await prisma.costLayer.findUniqueOrThrow({ where: { id: layer.id } })).qtyRemaining.toString()).toBe("7.5");
  });

  it("chỉ đụng đúng các lớp được chỉ định", async () => {
    const { w, layer } = await layerWithConsumptions(["1"]);
    const led2 = await prisma.stockLedger.create({
      data: { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE", docId: 2, docLineId: 2, qtyIn: 5, at: new Date("2026-09-02T00:00:00Z"), createdBy: w.userId },
    });
    const other = await prisma.costLayer.create({
      data: { periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: 2, sourceLineId: 2, ledgerId: led2.id, qtyIn: 5, qtyRemaining: 4, unitCost: 1, at: led2.at },
    });
    await restoreLayerRemaining(prisma, [layer.id]);
    expect((await prisma.costLayer.findUniqueOrThrow({ where: { id: layer.id } })).qtyRemaining.toString()).toBe("2");
    expect((await prisma.costLayer.findUniqueOrThrow({ where: { id: other.id } })).qtyRemaining.toString()).toBe("4");
  });
});
