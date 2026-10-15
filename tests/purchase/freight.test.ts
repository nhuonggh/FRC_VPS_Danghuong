import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { allocateFreight } from "@/server/purchase/freight";

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

describe("allocateFreight", () => {
  it("allocates exact cents deterministically", () => {
    const result = allocateFreight([D(1), D(1), D(1)], D(100));
    expect(result.map((value) => value.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(result.reduce((total, value) => total.plus(value), D(0)).toString()).toBe("100");
  });

  it("does not allocate zero freight and rejects a zero allocation basis", () => {
    expect(allocateFreight([D(0), D(0)], D(0)).map((value) => value.toString())).toEqual(["0", "0"]);
    expect(() => allocateFreight([D(0)], D(1))).toThrow("Không phân bổ được cước khi tổng tiền hàng bằng 0.");
  });
});
