import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewUserPage from "@/app/(app)/system/users/new/page";
import { NewUserForm } from "@/app/(app)/system/users/new/NewUserForm";
import UserDetailPage from "@/app/(app)/system/users/[id]/page";
import { UserDetail } from "@/app/(app)/system/users/[id]/UserDetail";
import { DomainError } from "@/server/http/errors";

const requireActor = vi.fn();
const getUser = vi.fn();
const roleFindMany = vi.fn();
const auditFindMany = vi.fn();
const userFindMany = vi.fn();
const notFound = vi.fn((): never => { throw new Error("NOT_FOUND"); });
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/server/users/queries", () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    role: { findMany: (...a: unknown[]) => roleFindMany(...a) },
    auditLog: { findMany: (...a: unknown[]) => auditFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));
vi.mock("@/app/(app)/system/users/new/NewUserForm", () => ({ NewUserForm: () => null }));
vi.mock("@/app/(app)/system/users/[id]/UserDetail", () => ({ UserDetail: () => null }));

const actor = (userId: number, ...perms: string[]) => ({ userId, perms: new Set(perms) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const user = { id: 5, username: "lan", fullName: "Lan", isLocked: false, mustChangePassword: false, createdAt: new Date("2026-09-01T03:00:00Z"), roles: [{ id: 2, name: "Kế toán" }] };

beforeEach(() => {
  for (const m of [requireActor, getUser, roleFindMany, auditFindMany, userFindMany, notFound]) m.mockReset();
  notFound.mockImplementation((): never => { throw new Error("NOT_FOUND"); });
  roleFindMany.mockResolvedValue([{ id: 1, name: "Giám đốc" }, { id: 2, name: "Kế toán" }]);
  auditFindMany.mockResolvedValue([{ id: 1, action: "user.create", at: new Date("2026-09-01T03:00:00Z"), userId: 1 }, { id: 2, action: "user.lock", at: new Date("2026-09-02T03:00:00Z"), userId: null }]);
  userFindMany.mockResolvedValue([{ id: 1, fullName: "Nguyễn Văn Nam" }]);
});

describe("/system/users/new (server)", () => {
  it("cần user.manage (thiếu quyền → requireActor chuyển 403, không đọc nhóm quyền)", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(NewUserPage()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("user.manage");
    expect(roleFindMany).not.toHaveBeenCalled();
  });

  it("có quyền → truyền danh sách nhóm quyền cho form", async () => {
    requireActor.mockResolvedValue(actor(1, "user.manage"));
    const tree = (await NewUserPage()) as ReactElement<{ roles: unknown[] }>;
    expect(tree.type).toBe(NewUserForm);
    expect(tree.props.roles).toHaveLength(2);
  });
});

describe("/system/users/[id] (server)", () => {
  it("cần user.view: thiếu quyền → 403 và KHÔNG đọc dữ liệu người dùng", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(UserDetailPage(params("5"))).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("user.view");
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5", "5abc", ""])("id không hợp lệ %j → 404, không truy vấn", async (id) => {
    requireActor.mockResolvedValue(actor(1, "user.view"));
    await expect(UserDetailPage(params(id))).rejects.toThrow("NOT_FOUND");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("id không tồn tại (DomainError 404) → notFound()", async () => {
    requireActor.mockResolvedValue(actor(1, "user.view"));
    getUser.mockRejectedValueOnce(new DomainError("Không tìm thấy người dùng.", 404));
    await expect(UserDetailPage(params("999"))).rejects.toThrow("NOT_FOUND");
  });

  it("lỗi khác (mất DB) không bị nuốt thành 404", async () => {
    requireActor.mockResolvedValue(actor(1, "user.view"));
    getUser.mockRejectedValueOnce(new Error("db down"));
    await expect(UserDetailPage(params("5"))).rejects.toThrow("db down");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("truyền dữ liệu đã tuần tự hoá (ISO), canManage/isSelf theo người xem, tên người thực hiện nhật ký", async () => {
    requireActor.mockResolvedValue(actor(5, "user.view"));
    getUser.mockResolvedValue(user);
    const tree = (await UserDetailPage(params("5"))) as ReactElement<React.ComponentProps<typeof UserDetail>>;
    expect(tree.type).toBe(UserDetail);
    expect(tree.props).toMatchObject({ canManage: false, isSelf: true });
    expect(tree.props.user.createdAt).toBe("2026-09-01T03:00:00.000Z");
    expect(tree.props.history.map((h) => h.by)).toEqual(["Nguyễn Văn Nam", "Hệ thống"]);
    expect(JSON.stringify(tree.props)).not.toMatch(/passwordHash/);
  });

  it("có user.manage → canManage = true", async () => {
    requireActor.mockResolvedValue(actor(1, "user.view", "user.manage"));
    getUser.mockResolvedValue(user);
    const tree = (await UserDetailPage(params("5"))) as ReactElement<{ canManage: boolean; isSelf: boolean }>;
    expect(tree.props).toMatchObject({ canManage: true, isSelf: false });
  });
});
