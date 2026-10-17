import { describe, expect, it } from "vitest";
import { resolveRolePermissions } from "@/lib/permissions/catalog";
import { redactOrderData, orderDisclosurePermissions } from "@/lib/permissions/order-analysis";
describe("sales analysis disclosure", () => {
  const input = { code: "DH001", orderTotal: "300000", lines: [{ productName: "Tôn", qty: "10", unit: "m", salePrice: "30000", discountNow: "0", discountAccum: "0", lineAmount: "300000", unitCostFifo: "10000", lineProfit: "200000", bomVersionId: 1, bomVersionLabel: "v1", issues: [{ qtyBase: "20", materialCost: "100000" }] }], costReference: { primary: { perBase: "10000" } } };
  it("default accountants retain purchase capabilities but do not receive order analysis", () => {
    const perms = resolveRolePermissions("Kế toán");
    expect(perms.has("purchase.create")).toBe(true);
    expect(perms.has("purchase_price.view")).toBe(true);
    expect(perms.has("order.analysis.view")).toBe(false);
    expect(resolveRolePermissions("Giám đốc").has("order.analysis.view")).toBe(true);
    const redacted = redactOrderData(input, perms);
    expect(redacted.orderTotal).toBe("300000");
    expect(redacted.lines[0]).toMatchObject({ productName: "Tôn", qty: "10", salePrice: "30000", lineAmount: "300000" });
    expect(JSON.stringify(redacted)).not.toMatch(/unitCostFifo|lineProfit|bomVersion|issues|materialCost|costReference/);
    expect(perms.has("cost.view")).toBe(true);
    expect(orderDisclosurePermissions(perms).has("cost.view")).toBe(false);
  });
  it("admin receives full data and additional price permissions remain enforced", () => {
    expect(redactOrderData(input, resolveRolePermissions("Giám đốc"))).toEqual(input);
    const scoped = redactOrderData(input, new Set(["order.analysis.view", "sale_price.view"]));
    expect(scoped.lines[0]).not.toHaveProperty("unitCostFifo");
    expect(scoped.lines[0]).not.toHaveProperty("lineProfit");
  });
});
