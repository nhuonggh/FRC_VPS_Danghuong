import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RolesPage from "@/app/(app)/system/roles/page";
import { RolesTable } from "@/app/(app)/system/roles/RolesTable";
import NewRolePage from "@/app/(app)/system/roles/new/page";
import { NewRoleForm } from "@/app/(app)/system/roles/new/NewRoleForm";
import RoleDetailPage from "@/app/(app)/system/roles/[id]/page";
import { RoleDetail } from "@/app/(app)/system/roles/[id]/RoleDetail";
import { EmptyState, PaginationFooter } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { DomainError } from "@/server/http/errors";

const requireActor = vi.fn();
const listRoles = vi.fn();
const getRole = vi.fn();
const notFound = vi.fn((): never => { throw new Error("NOT_FOUND"); });
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/server/roles/queries", () => ({ listRoles: (...a: unknown[]) => listRoles(...a), getRole: (...a: unknown[]) => getRole(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/app/(app)/system/roles/RolesTable", () => ({ RolesTable: () => null }));
vi.mock("@/app/(app)/system/roles/new/NewRoleForm", () => ({ NewRoleForm: () => null }));
vi.mock("@/app/(app)/system/roles/[id]/RoleDetail", () => ({ RoleDetail: () => null }));

const actor = (...perms: string[]) => ({ userId: 1, perms: new Set(perms) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const role = (id: number) => ({ id, name: `Nhóm ${id}`, description: null, isSystem: false, userCount: 0, permissionCount: 0 });

function findAll(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) out.push(el);
  findAll(el.props?.children as ReactNode, type, out);
  for (const k of ["stats", "filters", "actions", "footer"]) findAll(el.props?.[k] as ReactNode, type, out);
  return out;
}

beforeEach(() => {
  for (const m of [requireActor, listRoles, getRole, notFound]) m.mockReset();
  notFound.mockImplementation((): never => { throw new Error("NOT_FOUND"); });
});

describe("/system/roles (server)", () => {
  it("cần role.manage: thiếu quyền → 403 và KHÔNG đọc dữ liệu", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(RolesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("role.manage");
    expect(listRoles).not.toHaveBeenCalled();
  });

  it("phân trang theo page/pageSize; canViewUsers theo user.view của người xem", async () => {
    requireActor.mockResolvedValue(actor("role.manage", "user.view"));
    listRoles.mockResolvedValue(Array.from({ length: 30 }, (_, i) => role(i + 1)));
    const tree = await RolesPage({ searchParams: Promise.resolve({ page: "2", pageSize: "20" }) });
    const table = findAll(tree, RolesTable)[0]!;
    expect((table.props.rows as { id: number }[]).map((r) => r.id)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(table.props.canViewUsers).toBe(true);
    expect(findAll(tree, PaginationFooter)[0]!.props).toMatchObject({ total: 30, page: 2, pageSize: 20 });
  });

  it("chỉ có role.manage (không user.view) → canViewUsers = false", async () => {
    requireActor.mockResolvedValue(actor("role.manage"));
    listRoles.mockResolvedValue([role(1)]);
    const tree = await RolesPage({ searchParams: Promise.resolve({}) });
    expect(findAll(tree, RolesTable)[0]!.props.canViewUsers).toBe(false);
  });

  it("không có nhóm nào → trạng thái rỗng, không dựng bảng", async () => {
    requireActor.mockResolvedValue(actor("role.manage"));
    listRoles.mockResolvedValue([]);
    const tree = await RolesPage({ searchParams: Promise.resolve({}) });
    expect(findAll(tree, EmptyState)).toHaveLength(1);
    expect(findAll(tree, RolesTable)).toHaveLength(0);
  });
});

describe("/system/roles/new (server)", () => {
  it("cần role.manage", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(NewRolePage()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("role.manage");
  });

  it("có quyền → hiện form", async () => {
    requireActor.mockResolvedValue(actor("role.manage"));
    expect(((await NewRolePage()) as ReactElement).type).toBe(NewRoleForm);
  });
});

describe("/system/roles/[id] (server)", () => {
  const detail = { id: 4, name: "Bán hàng", description: null, isSystem: false, permissionCodes: ["order.view"], users: [] };

  it("cần role.manage: thiếu quyền → 403 và KHÔNG đọc nhóm", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(RoleDetailPage(params("4"))).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("role.manage");
    expect(getRole).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5", "5abc", "", "1e2", "99999999999"])("id không hợp lệ %j → 404, không truy vấn", async (id) => {
    requireActor.mockResolvedValue(actor("role.manage"));
    await expect(RoleDetailPage(params(id))).rejects.toThrow("NOT_FOUND");
    expect(getRole).not.toHaveBeenCalled();
  });

  it("nhóm không tồn tại (DomainError 404) → notFound(); lỗi khác không bị nuốt", async () => {
    requireActor.mockResolvedValue(actor("role.manage"));
    getRole.mockRejectedValueOnce(new DomainError("Không tìm thấy nhóm quyền.", 404));
    await expect(RoleDetailPage(params("999"))).rejects.toThrow("NOT_FOUND");
    getRole.mockRejectedValueOnce(new Error("db down"));
    await expect(RoleDetailPage(params("4"))).rejects.toThrow("db down");
  });

  it("truyền danh mục quyền (kèm cờ nhạy cảm), quyền của người sửa và canViewUsers", async () => {
    requireActor.mockResolvedValue(actor("role.manage", "order.view"));
    getRole.mockResolvedValue(detail);
    const tree = (await RoleDetailPage(params("4"))) as ReactElement<React.ComponentProps<typeof RoleDetail>>;
    expect(tree.type).toBe(RoleDetail);
    expect(tree.props.catalog).toHaveLength(PERMISSIONS.length);
    expect(tree.props.catalog.find((c) => c.code === "cost.view")).toMatchObject({ group: "Dữ liệu nhạy cảm", sensitive: true });
    expect(tree.props.catalog.find((c) => c.code === "order.view")?.sensitive).toBeFalsy();
    expect([...tree.props.actorPerms].sort()).toEqual(["order.view", "role.manage"]);
    expect(tree.props.canViewUsers).toBe(false);
  });

  it("có user.view → canViewUsers = true", async () => {
    requireActor.mockResolvedValue(actor("role.manage", "user.view"));
    getRole.mockResolvedValue(detail);
    const tree = (await RoleDetailPage(params("4"))) as ReactElement<{ canViewUsers: boolean }>;
    expect(tree.props.canViewUsers).toBe(true);
  });
});
