import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditLogPage from "@/app/(app)/system/audit-log/page";
import AuditDetailPage from "@/app/(app)/system/audit-log/[id]/page";
import { AuditDetail } from "@/app/(app)/system/audit-log/[id]/AuditDetail";
import { AuditTable } from "@/app/(app)/system/audit-log/AuditTable";
import { EmptyState, ExportButton, MultiSelectFilter, PaginationFooter, SearchBox } from "@/components/ui";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { StatCard } from "@/components/ui/StatCard";
import { MAX_EXPORT_ROWS } from "@/server/audit/export";
import { DomainError } from "@/server/http/errors";

const requireActor = vi.fn();
const listAudit = vi.fn();
const auditStats = vi.fn();
const listAuditEntities = vi.fn();
const getAuditEntry = vi.fn();
const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const notFound = vi.fn((): never => { throw new Error("NOT_FOUND"); });
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/server/audit/queries", async (orig) => ({
  ...(await orig<typeof import("@/server/audit/queries")>()),
  listAudit: (...a: unknown[]) => listAudit(...a),
  auditStats: (...a: unknown[]) => auditStats(...a),
  listAuditEntities: (...a: unknown[]) => listAuditEntities(...a),
  getAuditEntry: (...a: unknown[]) => getAuditEntry(...a),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: (...a: unknown[]) => userFindMany(...a), findUnique: (...a: unknown[]) => userFindUnique(...a) } } }));
// Trang chỉ dựng cây phần tử — các thành phần client không cần chạy
vi.mock("@/app/(app)/system/audit-log/AuditTable", () => ({ AuditTable: () => null }));
vi.mock("@/app/(app)/system/audit-log/[id]/AuditDetail", () => ({ AuditDetail: () => null }));

const actor = (...perms: string[]) => ({ userId: 7, perms: new Set(perms) });
const row = { id: 1, userId: 3, action: "order.update", entity: "SaleOrder", entityId: "12", at: new Date("2026-09-30T16:50:00Z") };

beforeEach(() => {
  for (const m of [requireActor, listAudit, auditStats, listAuditEntities, getAuditEntry, userFindMany, userFindUnique, notFound]) m.mockReset();
  auditStats.mockResolvedValue({ users: 2, entities: 3, actions: 4 });
  notFound.mockImplementation((): never => { throw new Error("NOT_FOUND"); });
  userFindMany.mockResolvedValue([{ id: 3, fullName: "Nguyễn Văn Nam" }, { id: 4, fullName: "Trần Thị Lan" }]);
  userFindUnique.mockResolvedValue({ fullName: "Nguyễn Văn Nam" });
  listAuditEntities.mockResolvedValue(["Role", "SaleOrder", "User"]);
});

function findAll(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) out.push(el);
  findAll(el.props?.children as ReactNode, type, out);
  for (const k of ["stats", "filters", "actions", "footer"]) findAll(el.props?.[k] as ReactNode, type, out);
  return out;
}
const page = (sp: Record<string, string> = {}) => AuditLogPage({ searchParams: Promise.resolve(sp) });

describe("/system/audit-log (server)", () => {
  it("cần audit.view: thiếu quyền → requireActor chuyển 403 và KHÔNG đọc dữ liệu", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(page()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("audit.view");
    expect(listAudit).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(auditStats).not.toHaveBeenCalled();
  });

  it("đọc URL bằng parseListParams (user, entity, q, thời gian, trang) rồi gọi listAudit", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row], total: 1 });
    await page({ user: "3,4", entity: "User", q: "lock", timePreset: "today", page: "2", sort: "-action", junk: "1" });
    expect(listAudit.mock.calls[0]![1]).toMatchObject({
      q: "lock", timePreset: "today", page: 2, sort: "-action", filters: { user: ["3", "4"], entity: ["User"] },
    });
    expect(auditStats.mock.calls[0]![1]).toEqual(listAudit.mock.calls[0]![1]);
  });

  it("DTO cho bảng: chỉ id/thời gian ISO/tên người/hành động/đối tượng/mã — không JSON, không ip", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row, { ...row, id: 2, userId: null }, { ...row, id: 3, userId: 99 }], total: 3 });
    const tree = (await page()) as ReactElement<{ children: ReactElement<{ rows: Record<string, unknown>[] }> }>;
    const rows = tree.props.children.props.rows;
    expect(rows[0]).toEqual({ id: 1, at: "2026-09-30T16:50:00.000Z", by: "Nguyễn Văn Nam", action: "order.update", entity: "SaleOrder", entityId: "12" });
    expect(rows[1]!.by).toBe("Hệ thống");
    expect(rows[2]!.by).toBe("#99");
    expect(JSON.stringify(rows)).not.toMatch(/beforeJson|afterJson|unitCost|"ip"/);
  });

  it("chỉ có nút Xuất Excel (href giữ bộ lọc, bỏ trang); KHÔNG có Thêm mới/Sửa/Xóa", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row], total: 1 });
    const tree = await page({ user: "3", entity: "User,Role", q: "lock", timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15", page: "3", pageSize: "50" });
    const exports = findAll(tree, ExportButton);
    expect(exports).toHaveLength(1);
    const href = String(exports[0]!.props.href);
    expect(href.startsWith("/api/audit-log/export?")).toBe(true);
    const qs = new URL(href, "http://x").searchParams;
    expect(Object.fromEntries(qs)).toEqual({ user: "3", entity: "User,Role", q: "lock", timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" });
    expect((tree as ReactElement<{ actions: { props: { children: unknown } } }>).props.actions).toBeTruthy();
    expect(JSON.stringify(tree)).not.toMatch(/Thêm mới|\/new/);
  });

  it("bộ lọc: tìm kiếm, lọc thời gian (10 mốc), người thao tác, đối tượng — mỗi ô có đủ lựa chọn", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row], total: 1 });
    const tree = await page();
    expect(findAll(tree, SearchBox)).toHaveLength(1);
    expect(findAll(tree, QuickTimeFilter)).toHaveLength(1);
    const ms = findAll(tree, MultiSelectFilter).map((m) => m.props);
    expect(ms.map((m) => m.paramKey)).toEqual(["user", "entity"]);
    expect(ms[0]!.options).toEqual([{ value: "3", label: "Nguyễn Văn Nam" }, { value: "4", label: "Trần Thị Lan" }]);
    expect(ms[1]!.options).toEqual([{ value: "Role", label: "Nhóm quyền" }, { value: "SaleOrder", label: "Đơn bán hàng" }, { value: "User", label: "Người dùng" }]);
  });

  it("thống kê lấy tổng kết quả và các nhóm từ server, không đếm dòng của trang", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row], total: 500 });
    const tree = await page({ page: "2" });
    expect(findAll(tree, StatCard).map(el => ({ label: el.props.label, value: el.props.value }))).toEqual([
      { label: "Tổng thao tác", value: 500 }, { label: "Người thao tác", value: 2 },
      { label: "Loại hành động", value: 4 }, { label: "Loại đối tượng", value: 3 },
    ]);
  });

  it("phân trang: tổng/trang/cỡ trang từ server; đổi trang giữ bộ lọc", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row], total: 50000 });
    const tree = await page({ q: "a", page: "4" });
    const [pf] = findAll(tree, PaginationFooter);
    expect(pf!.props).toMatchObject({ total: 50000, page: 4, pageSize: 20 });
    const build = pf!.props.buildHref as (p: { page?: number }) => string;
    expect(build({ page: 5 })).toBe("/system/audit-log?q=a&timePreset=today&page=5");
    expect(build({ page: 1 })).toBe("/system/audit-log?q=a&timePreset=today");
  });

  it("rỗng: 'empty' khi chưa lọc, 'no-result' khi đang lọc", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [], total: 0 });
    expect(findAll(await page({ timePreset: "all" }), EmptyState)[0]!.props.kind).toBe("no-result"); // mặc định Hôm nay = đang lọc theo ngày
    expect(findAll(await page({ q: "zzz" }), EmptyState)[0]!.props.kind).toBe("no-result");
    expect(findAll(await page({ timePreset: "today" }), EmptyState)[0]!.props.kind).toBe("no-result");
    expect(findAll(await page({ user: "3" }), EmptyState)[0]!.props.kind).toBe("no-result");
  });

  it(`báo rõ khi xuất Excel bị giới hạn (> ${MAX_EXPORT_ROWS} dòng); dưới ngưỡng thì không có cảnh báo`, async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    listAudit.mockResolvedValue({ rows: [row], total: MAX_EXPORT_ROWS + 1 });
    expect(JSON.stringify(await page())).toMatch(/chỉ gồm 10.000 dòng mới nhất/);
    listAudit.mockResolvedValue({ rows: [row], total: MAX_EXPORT_ROWS });
    expect(JSON.stringify(await page())).not.toMatch(/chỉ gồm/);
  });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const dbRow = {
  id: 5, userId: 3, action: "product.update", entity: "Product", entityId: "9", ip: "10.0.0.1", at: new Date("2026-09-30T16:50:00Z"),
  beforeJson: { name: "A", unitCost: "90000" }, afterJson: { name: "B", unitCost: "95000" },
};

describe("/system/audit-log/[id] (server)", () => {
  it("cần audit.view: thiếu quyền → 403 và KHÔNG đọc bản ghi", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(AuditDetailPage(params("5"))).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("audit.view");
    expect(getAuditEntry).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5", "5abc", "1e2", "0x10", "99999999999", ""])("id không hợp lệ %j → 404, không truy vấn", async (id) => {
    requireActor.mockResolvedValue(actor("audit.view"));
    await expect(AuditDetailPage(params(id))).rejects.toThrow("NOT_FOUND");
    expect(getAuditEntry).not.toHaveBeenCalled();
  });

  it("không tồn tại → notFound(); lỗi khác không bị nuốt thành 404", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    getAuditEntry.mockRejectedValueOnce(new DomainError("Không tìm thấy dòng nhật ký.", 404));
    await expect(AuditDetailPage(params("5"))).rejects.toThrow("NOT_FOUND");
    getAuditEntry.mockRejectedValueOnce(new Error("db down"));
    await expect(AuditDetailPage(params("5"))).rejects.toThrow("db down");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("REDACTION: người xem thiếu cost.view không nhận unitCost trong props gửi xuống client", async () => {
    requireActor.mockResolvedValue(actor("audit.view"));
    getAuditEntry.mockResolvedValue(dbRow);
    const tree = (await AuditDetailPage(params("5"))) as ReactElement<{ entry: Record<string, unknown> }>;
    expect(tree.type).toBe(AuditDetail);
    const json = JSON.stringify(tree.props);
    expect(json).not.toMatch(/unitCost|90000|95000|beforeJson|afterJson/);
    expect(tree.props.entry).toMatchObject({ id: 5, by: "Nguyễn Văn Nam", action: "product.update", entity: "Product", entityId: "9", ip: "10.0.0.1", hiddenByPermission: true });
  });

  it("người xem có cost.view thấy unitCost (đã định dạng); ẩn danh → 'Hệ thống'", async () => {
    requireActor.mockResolvedValue(actor("audit.view", "cost.view"));
    getAuditEntry.mockResolvedValue({ ...dbRow, userId: null });
    const tree = (await AuditDetailPage(params("5"))) as ReactElement<{ entry: { by: string; changes: { path: string }[] } }>;
    expect(tree.props.entry.changes.map((c) => c.path)).toEqual(["name", "unitCost"]);
    expect(tree.props.entry.by).toBe("Hệ thống");
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
