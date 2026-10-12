import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { areaRatiosOf, type AreaLineInput } from "@/server/processing/area-ratio";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

const D = (v: string) => new Prisma.Decimal(v);
beforeEach(resetDb);

describe("areaRatiosOf — tỷ lệ m²/md để hiển thị dòng theo m²", () => {
  it("chỉ dòng AREA ở đơn vị gốc mới có tỷ lệ; ưu tiên ghi chú dòng → tỷ lệ riêng SP×kiểu → mặc định kiểu → 1", async () => {

    const product = await makeProduct({ baseUnit: "md" });
    const area = await prisma.processingType.create({ data: { name: "AREA-1", ratio: D("1.08"), priceBasis: "AREA" } });
    const length = await prisma.processingType.create({ data: { name: "LEN-1", ratio: D("1.08") } });
    await prisma.productProcessingRatio.create({ data: { productId: product.id, processingTypeId: area.id, ratio: D("1.12"), updatedBy: (await makeUser()).id } });
    const line = (over: Partial<AreaLineInput>): AreaLineInput => ({ productId: product.id, unit: "md", baseUnit: "md", note: null, processingTypeId: area.id, type: { priceBasis: "AREA", ratio: D("1.08") }, ...over });
    const out = await areaRatiosOf(prisma, [
      line({}),                                                            // tỷ lệ riêng của SP
      line({ note: "7,1 m × 1,2 × 7 = 59,64 m²" }),                       // ghi chú dòng thắng
      line({ productId: product.id + 999 }),                               // không có riêng → mặc định kiểu
      line({ processingTypeId: length.id, type: { priceBasis: "LENGTH", ratio: D("1.08") } }), // mét dài
      line({ unit: "cuộn" }),                                              // không phải đơn vị gốc
      line({ processingTypeId: null, type: null }),                        // không có kiểu gia công
      line({ productId: product.id + 999, type: { priceBasis: "AREA", ratio: null } }), // không tỷ lệ → 1
    ]);
    expect(out).toEqual([1.12, 1.2, 1.08, null, null, null, 1]);
  });
});
