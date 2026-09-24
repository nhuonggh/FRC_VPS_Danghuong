import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "@/app/(app)/system/users/page";
import { UsersTable } from "@/app/(app)/system/users/UsersTable";
import { EmptyState, ListPageLayout, StatCard } from "@/components/ui";

const requireActor = vi.fn();
const listUsers = vi.fn();
const roleFindMany = vi.fn();
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/server/users/queries", () => ({ listUsers: (...a: unknown[]) => listUsers(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { role: { findMany: (...a: unknown[]) => roleFindMany(...a) } } }));
// Trang chỉ dựng cây phần tử — các thành phần client không cần chạy
vi.mock("@/app/(app)/system/users/UsersTable", () => ({ UsersTable: () => null }));

const actor = (...perms: string[]) => ({ userId: 7, perms: new Set(perms) });
const stats = { all: 5, active: 4, locked: 1 };
const row = { id: 1, username: "nam", fullName: "Nam", isLocked: false, mustChangePassword: false, createdAt: new Date(), roles: [] };

beforeEach(() => {
  requireActor.mockReset(); listUsers.mockReset(); roleFindMany.mockReset();
  roleFindMany.mockResolvedValue([{ id: 1, name: "Giám đốc" }, { id: 2, name: "Kế toán" }]);
});

function findAll(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) out.push(el);
  findAll(el.props?.children as ReactNode, type, out);
  // các prop dạng slot (stats/filters/actions/footer)
  for (const k of ["stats", "filters", "actions", "footer"]) findAll(el.props?.[k] as ReactNode, type, out);
  return out;
}
const page = (sp: Record<string, string> = {}) => UsersPage({ searchParams: Promise.resolve(sp) });

describe("/system/users (server)", () => {
  it("chặn ở tầng route: cần user.view (requireActor sẽ chuyển 403)", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(page()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("user.view");
    expect(listUsers).not.toHaveBeenCalled(); // không đọc dữ liệu khi thiếu quyền
  });

  it("đọc tham số qua parseListParams (status, role, q, sort, trang) rồi gọi listUsers", async () => {
    requireActor.mockResolvedValue(actor("user.view"));
    listUsers.mockResolvedValue({ rows: [row], total: 1, stats });
    await page({ status: "locked", role: "1,2", q: "nam", sort: "-fullName", page: "2" });
    const params = listUsers.mock.calls[0]![1];
    expect(params).toMatchObject({ q: "nam", sort: "-fullName", page: 2, filters: { status: ["locked"], role: ["1", "2"] } });
  });

  it("3 thẻ thống kê: số đếm từ server, bấm để lọc; thẻ của bộ lọc đang chọn được đánh dấu", async () => {
    requireActor.mockResolvedValue(actor("user.view"));
    listUsers.mockResolvedValue({ rows: [row], total: 1, stats });
    const tree = await page({ status: "active" });
    const cards = findAll(tree, StatCard).map((c) => c.props);
    expect(cards.map((c) => [c.label, c.value, c.active])).toEqual([
      ["Tổng", 5, false], ["Đang hoạt động", 4, true], ["Đã khóa", 1, false],
    ]);
    expect(cards[0]!.href).toBe("/system/users");
    expect(cards[1]!.href).toBe("/system/users?status=active");
    expect(cards[2]!.href).toBe("/system/users?status=locked");
  });

  it("thẻ thống kê giữ tìm kiếm/nhóm quyền đang chọn nhưng bỏ trang", async () => {
    requireActor.mockResolvedValue(actor("user.view"));
    listUsers.mockResolvedValue({ rows: [row], total: 40, stats });
    const tree = await page({ q: "nam", role: "2", page: "3" });
    const hrefs = findAll(tree, StatCard).map((c) => c.props.href);
    expect(hrefs[2]).toBe("/system/users?q=nam&role=2&status=locked");
  });

  it("nút 'Thêm mới' chỉ có khi có user.manage (ẩn hẳn, không disabled)", async () => {
    listUsers.mockResolvedValue({ rows: [row], total: 1, stats });
    requireActor.mockResolvedValueOnce(actor("user.view"));
    const viewOnly = await page();
    expect((viewOnly as ReactElement<{ actions: unknown }>).props.actions).toBeFalsy();

    requireActor.mockResolvedValueOnce(actor("user.view", "user.manage"));
    const manager = await page();
    const actions = (manager as ReactElement<{ actions: ReactElement<{ href: string }> }>).props.actions;
    expect(actions.props.href).toBe("/system/users/new");
  });

  it("truyền canManage và selfId (userId người xem) xuống bảng", async () => {
    requireActor.mockResolvedValue(actor("user.view", "user.manage"));
    listUsers.mockResolvedValue({ rows: [row], total: 1, stats });
    const tree = await page();
    expect(findAll(tree, UsersTable)[0]!.props).toMatchObject({ canManage: true, selfId: 7 });
  });

  it("3 loại trạng thái rỗng: chưa có dữ liệu / lọc không ra kết quả", async () => {
    requireActor.mockResolvedValue(actor("user.view", "user.manage"));
    listUsers.mockResolvedValue({ rows: [], total: 0, stats: { all: 0, active: 0, locked: 0 } });
    const empty = findAll(await page(), EmptyState)[0]!.props;
    expect(empty).toMatchObject({ kind: "empty", title: "Chưa có người dùng nào" });
    expect(empty.action).toBeTruthy(); // có quyền → gợi ý tạo

    const noResult = findAll(await page({ q: "zzz" }), EmptyState)[0]!.props;
    expect(noResult).toMatchObject({ kind: "no-result" });

    const filteredByStatus = findAll(await page({ status: "locked" }), EmptyState)[0]!.props;
    expect(filteredByStatus).toMatchObject({ kind: "no-result" });
  });

  it("danh sách rỗng không có quyền quản lý → không gợi ý tạo mới", async () => {
    requireActor.mockResolvedValue(actor("user.view"));
    listUsers.mockResolvedValue({ rows: [], total: 0, stats: { all: 0, active: 0, locked: 0 } });
    expect(findAll(await page(), EmptyState)[0]!.props.action).toBeUndefined();
  });

  it("có dữ liệu → hiện bảng, không hiện trạng thái rỗng; chân trang phân trang có mặt", async () => {
    requireActor.mockResolvedValue(actor("user.view"));
    listUsers.mockResolvedValue({ rows: [row], total: 1, stats });
    const tree = await page();
    expect(findAll(tree, EmptyState)).toHaveLength(0);
    expect(findAll(tree, UsersTable)).toHaveLength(1);
    expect((tree as ReactElement<{ footer: unknown }>).props.footer).toBeTruthy();
    expect((tree as ReactElement).type).toBe(ListPageLayout);
  });
});
