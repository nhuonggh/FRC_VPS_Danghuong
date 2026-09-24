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

  it("5 vai trò mặc định theo spec 6.6", () => {
    expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual(
      ["Bán hàng", "Giám đốc", "Kế toán", "Thủ kho", "Thủ quỹ"].sort(),
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
