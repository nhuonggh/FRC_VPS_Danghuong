import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_DEFAULTS, SENSITIVE_FIELDS, resolveRolePermissions } from "@/lib/permissions/catalog";

const codes = new Set<string>(PERMISSIONS.map((p) => p.code));

describe("danh mục quyền", () => {
  it("mã quyền là duy nhất và có nhãn tiếng Việt", () => {
    expect(codes.size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(p.label.length).toBeGreaterThan(0);
  });

  it("có partner.view và partner.view_all", () => {
    expect(codes.has("partner.view")).toBe(true);
    expect(codes.has("partner.view_all")).toBe(true);
  });

  it("6 vai trò mặc định theo spec 6.6", () => {
    expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual(
      ["Bán hàng", "Giám đốc", "Kế toán", "Kế toán trưởng", "Thủ kho", "Thủ quỹ"].sort(),
    );
  });

  it("Giám đốc có mọi quyền, gồm kết sổ", () => {
    const perms = resolveRolePermissions("Giám đốc");
    expect(perms.size).toBe(PERMISSIONS.length);
    expect(perms.has("period.close")).toBe(true);
  });

  it("Kế toán: có giá vốn, KHÔNG kết sổ, KHÔNG tạo tài khoản", () => {
    const p = resolveRolePermissions("Kế toán");
    expect(p.has("cost.view")).toBe(true);
    expect(p.has("period.close")).toBe(false);
    expect(p.has("user.manage")).toBe(false);
    expect(p.has("role.manage")).toBe(false);
  });

  it("Kế toán trưởng = Kế toán + xem lãi/lỗ (profit.view); Kế toán viên không xem lãi/lỗ", () => {
    const kt = resolveRolePermissions("Kế toán"), ktt = resolveRolePermissions("Kế toán trưởng");
    expect(kt.has("profit.view")).toBe(false);
    expect(ktt.has("profit.view")).toBe(true);
    expect([...ktt].filter((c) => c !== "profit.view").sort()).toEqual([...kt].sort());
  });

  it("Thủ kho: KHÔNG thấy giá nhập, giá bán, lãi, giá vốn", () => {
    const p = resolveRolePermissions("Thủ kho");
    for (const c of ["purchase_price.view", "sale_price.view", "profit.view", "cost.view"]) {
      expect(p.has(c), c).toBe(false);
    }
    expect(p.has("stock.view")).toBe(true);
  });

  it("Thủ quỹ: KHÔNG thấy giá nhập, lãi", () => {
    const p = resolveRolePermissions("Thủ quỹ");
    expect(p.has("purchase_price.view")).toBe(false);
    expect(p.has("profit.view")).toBe(false);
    expect(p.has("receipt.manage")).toBe(true);
  });

  it("Bán hàng: KHÔNG thấy giá vốn/lãi và KHÔNG có partner.view_all (chỉ khách của mình)", () => {
    const p = resolveRolePermissions("Bán hàng");
    expect(p.has("cost.view")).toBe(false);
    expect(p.has("profit.view")).toBe(false);
    expect(p.has("partner.view_all")).toBe(false);
    expect(p.has("order.create")).toBe(true);
  });

  it("mọi mã trong ROLE_DEFAULTS tồn tại trong PERMISSIONS", () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      for (const c of resolveRolePermissions(role)) expect(codes.has(c), `${role}:${c}`).toBe(true);
    }
  });

  it("mọi quyền trong SENSITIVE_FIELDS tồn tại trong PERMISSIONS", () => {
    for (const [field, code] of Object.entries(SENSITIVE_FIELDS)) expect(codes.has(code), field).toBe(true);
  });

  it("vai trò lạ → lỗi (không ngầm cấp quyền)", () => {
    expect(() => resolveRolePermissions("Không tồn tại")).toThrow(/ROLE_DEFAULTS/);
  });
});

describe("SENSITIVE_FIELDS phủ đủ các quyền xem dữ liệu nhạy cảm", () => {
  it("mỗi quyền *.view đánh dấu sensitive có ít nhất 1 field trong SENSITIVE_FIELDS", () => {
    const viewSensitive = PERMISSIONS.filter((p) => p.code.endsWith(".view") && "sensitive" in p && p.sensitive);
    expect(viewSensitive.map((p) => p.code).sort()).toEqual(
      ["cost.view", "order.analysis.view", "profit.view", "purchase_price.view", "sale.cost_hint.view", "sale_price.view"],
    );
    const mapped = new Set(Object.values(SENSITIVE_FIELDS));
    for (const p of viewSensitive) expect(mapped.has(p.code), p.code).toBe(true);
  });

  it("các tên field hiển nhiên được ánh xạ đúng quyền", () => {
    expect(SENSITIVE_FIELDS.salePrice).toBe("sale_price.view");
    expect(SENSITIVE_FIELDS.lastSalePrice).toBe("sale_price.view");
    for (const f of ["unitCost", "costPrice", "stockValue"]) expect(SENSITIVE_FIELDS[f], f).toBe("cost.view");
    for (const f of ["margin", "grossProfit"]) expect(SENSITIVE_FIELDS[f], f).toBe("profit.view");
  });

  it("KHÔNG ánh xạ tên chung chung (price, amount...) — không bảo vệ được theo tên", () => {
    for (const f of ["price", "unitPrice", "amount", "total"]) expect(SENSITIVE_FIELDS[f], f).toBeUndefined();
  });
});
