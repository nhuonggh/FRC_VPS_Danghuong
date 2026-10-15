import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as closeRoute } from "@/app/api/period/close/route";
import { hashPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));
const req = (body: unknown) => new NextRequest("http://localhost/api/period/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let gd: number; let ke: number; let periodName: string;

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await hashPassword("Admin12345");
  const mk = async (u: string, role: string) => (await prisma.user.create({ data: { username: u, fullName: u, passwordHash: hash, roles: { create: { roleId: roles[role]! } } } })).id;
  gd = await mk("giamdoc", "Giám đốc"); ke = await mk("ketoan", "Kế toán");
  periodName = (await prisma.period.findFirstOrThrow({ where: { isOpen: true } })).name;
});

const body = (over: Record<string, unknown> = {}) => ({ confirmName: periodName, backupAt: new Date(Date.now() - 3600_000).toISOString(), acknowledged: true, ...over });

describe("POST /api/period/close", () => {
  it("chưa đăng nhập → 401; Kế toán (không có period.close) → 403; kỳ vẫn mở", async () => {
    loginAs(null);
    expect((await closeRoute(req(body()), undefined)).status).toBe(401);
    loginAs(ke);
    expect((await closeRoute(req(body()), undefined)).status).toBe(403);
    expect(await prisma.period.count({ where: { isOpen: true } })).toBe(1);
  });

  it("Giám đốc: sai tên → 400 có fields.confirmName; thiếu tick → 400; đúng → 200, kỳ cũ CLOSED và kỳ mới mở; phản hồi no-store", async () => {
    loginAs(gd);
    const wrong = await closeRoute(req(body({ confirmName: "sai" })), undefined);
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).fields.confirmName).toContain(periodName);
    expect((await closeRoute(req(body({ acknowledged: false })), undefined)).status).toBe(400);
    expect(await prisma.period.count()).toBe(1);

    const res = await closeRoute(req(body({ newName: "Kỳ sau" })), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await res.json();
    expect(out.newPeriod.name).toBe("Kỳ sau");
    expect((await prisma.period.findUniqueOrThrow({ where: { id: out.closedPeriodId } })).status).toBe("CLOSED");
    expect(await prisma.period.count({ where: { isOpen: true } })).toBe(1);
  });
});
