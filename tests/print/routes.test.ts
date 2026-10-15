import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/print/[docType]/[docId]/route";
import { hashPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));
const req = (method: string) => new NextRequest("http://localhost/x", { method });
const ctx = (docType: string, docId: string) => ({ params: Promise.resolve({ docType, docId }) });
let ke: number; let bh: number; let nv: number;

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await hashPassword("Admin12345");
  const mk = async (u: string, role: string) => (await prisma.user.create({ data: { username: u, fullName: u, passwordHash: hash, roles: { create: { roleId: roles[role]! } } } })).id;
  ke = await mk("ketoan", "Kế toán"); bh = await mk("banhang", "Bán hàng"); nv = await mk("thukho", "Thủ kho");
});

describe("API in chứng từ", () => {
  it("chưa đăng nhập 401; id/loại sai 400/404; chưa có mẫu 409 với hướng dẫn cấu hình; thủ kho không in hóa đơn (thiếu quyền giá) 403", async () => {
    loginAs(null);
    expect((await POST(req("POST"), ctx("SALE_INVOICE", "1"))).status).toBe(401);
    loginAs(ke);
    expect((await POST(req("POST"), ctx("SALE_INVOICE", "abc"))).status).toBe(400);
    expect((await POST(req("POST"), ctx("NOPE", "1"))).status).toBe(404);
    const r = await POST(req("POST"), ctx("sale_invoice", "1")); expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("Công ty & mẫu in");
    expect((await POST(req("POST"), ctx("PRODUCTION_ORDER", "1"))).status).toBe(409);
    loginAs(nv);
    expect((await POST(req("POST"), ctx("SALE_INVOICE", "1"))).status).toBe(403);
    loginAs(bh);
    const g = await GET(req("GET"), ctx("SALE_INVOICE", "1")); expect(g.status).toBe(200); expect((await g.json()).last).toBeNull();
  });
});
