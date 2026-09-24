import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/audit-log/export/route";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/audit-log/export${qs}`));

let adminId: number; // Giám đốc: mọi quyền
let staffId: number; // Bán hàng: KHÔNG có audit.view
let auditorId: number; // có audit.view, KHÔNG có cost.view

async function sheet(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
  return wb.worksheets[0]!;
}

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const mk = (username: string, roleId: number) => prisma.user.create({ data: { username, fullName: username, passwordHash: "x", roles: { create: { roleId } } } });
  adminId = (await mk("admin", roles["Giám đốc"]!)).id;
  staffId = (await mk("nv", roles["Bán hàng"]!)).id;
  const auditRole = await prisma.role.create({ data: { name: "Kiểm toán nội bộ" } });
  const perm = await prisma.permission.findUniqueOrThrow({ where: { code: "audit.view" } });
  await prisma.rolePermission.create({ data: { roleId: auditRole.id, permissionId: perm.id } });
  auditorId = (await mk("auditor", auditRole.id)).id;
  await prisma.auditLog.create({
    data: { userId: adminId, action: "product.update", entity: "Product", entityId: "1", beforeJson: { unitCost: "90000", name: "A" }, afterJson: { unitCost: "95000", name: "B" } },
  });
});

describe("GET /api/audit-log/export", () => {
  it("chưa đăng nhập → 401 JSON, không redirect", async () => {
    loginAs(null);
    const r = await get();
    expect(r.status).toBe(401);
    expect(r.headers.get("location")).toBeNull();
    expect((await r.json()).error).toMatch(/hết hạn/);
  });

  it("thiếu audit.view → 403 JSON (Bán hàng), không trả file", async () => {
    loginAs(staffId);
    const r = await get();
    expect(r.status).toBe(403);
    expect(r.headers.get("content-type")).toMatch(/json/);
    expect((await r.json()).error).toMatch(/không có quyền/);
  });

  it("có audit.view → 200, xlsx, no-store, tên file đúng", async () => {
    loginAs(adminId);
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-disposition")).toContain("nhat-ky-thao-tac.xlsx");
    expect(r.headers.get("x-export-truncated")).toBe("0");
    expect(r.headers.get("x-export-rows")).toBe("1");
    expect(r.headers.get("x-export-max-rows")).toBe("10000"); // trần thực tế được báo cho client
  });

  it("redaction theo NGƯỜI XEM: có audit.view mà thiếu cost.view → không thấy unitCost; Giám đốc thấy", async () => {
    loginAs(auditorId);
    const ws1 = await sheet(await get());
    expect(JSON.stringify(ws1.getRow(2).values)).not.toMatch(/unitCost|90000/);
    expect(JSON.stringify(ws1.getRow(2).values)).toContain("name");

    loginAs(adminId);
    const ws2 = await sheet(await get());
    expect(JSON.stringify(ws2.getRow(2).values)).toMatch(/unitCost/);
  });

  it("giữ bộ lọc từ query (người thao tác, đối tượng, thời gian); tham số lạ/rác không gây lỗi", async () => {
    loginAs(adminId);
    await prisma.auditLog.create({ data: { userId: staffId, action: "x.y", entity: "Other", entityId: "77" } });
    const ws = await sheet(await get(`?user=${staffId}&entity=Other&timePreset=thisYear&page=9&pageSize=abc&sort=ip&zzz=1`));
    expect(ws.rowCount).toBe(2); // tiêu đề + 1 dòng
    expect(ws.getRow(2).getCell(5).value).toBe("77");
  });

  it("tài khoản bị khoá → 401 ngay", async () => {
    await prisma.user.update({ where: { id: adminId }, data: { isLocked: true } });
    loginAs(adminId);
    expect((await get()).status).toBe(401);
  });
});
