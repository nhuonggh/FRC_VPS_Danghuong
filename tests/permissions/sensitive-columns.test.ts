import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { SENSITIVE_FIELDS } from "@/lib/permissions/catalog";

const models = ["Purchase", "PurchaseLine", "StockAdjustmentLine"];
const nonSensitive = /^(qty|qtyBase|factorUsed)$/;
describe("D-16: cột giá/tiền chứng từ nhập đã đăng ký redaction", () => {
  for (const name of models) it(name, () => {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === name)!;
    const money = model.fields.filter((field) => field.type === "Decimal" && !nonSensitive.test(field.name)).map((field) => field.name);
    expect(money.length).toBeGreaterThan(0); money.forEach((field) => expect(SENSITIVE_FIELDS[field], `${name}.${field}`).toBeDefined());
  });
  it("giá nhập và giá vốn cần đúng quyền", () => {
    ["purchasePrice", "purchaseAmount", "purchaseTotal", "freightCost", "allocatedFreight"].forEach((field) => expect(SENSITIVE_FIELDS[field]).toBe("purchase_price.view"));
    ["unitCost", "openingValue", "inValue", "outValue", "closingValue"].forEach((field) => expect(SENSITIVE_FIELDS[field]).toBe("cost.view"));
  });
});
