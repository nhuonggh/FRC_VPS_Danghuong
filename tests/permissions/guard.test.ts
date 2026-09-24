import { describe, expect, it } from "vitest";
import type { PermissionCode } from "@/lib/permissions/catalog";
import { assertCan, can, ForbiddenError } from "@/lib/permissions/guard";

describe("guard", () => {
  const perms = new Set(["order.view"]);
  it("can()", () => {
    expect(can(perms, "order.view")).toBe(true);
    expect(can(perms, "order.cancel")).toBe(false);
  });
  it("assertCan ném ForbiddenError tiếng Việt", () => {
    expect(() => assertCan(perms, "order.cancel")).toThrow(ForbiddenError);
    expect(() => assertCan(perms, "order.cancel")).toThrow(/không có quyền/);
  });
  it("ForbiddenError mang status 403 và mã quyền bị thiếu", () => {
    try {
      assertCan(perms, "order.cancel");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).status).toBe(403);
      expect((e as ForbiddenError).code).toBe("order.cancel");
    }
  });
  it("mặc định từ chối: tập quyền rỗng và mã lạ đều bị từ chối", () => {
    expect(can(new Set<string>(), "order.view")).toBe(false);
    expect(can(perms, "khong.ton.tai" as PermissionCode)).toBe(false);
  });
});
