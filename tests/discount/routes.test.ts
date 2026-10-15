import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as settleRoute } from "@/app/api/discount/settlements/route";
import { POST as actionRoute } from "@/app/api/discount/settlements/[id]/[action]/route";
import { hashPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));
const req = (method: string, body?: unknown, key?: string) => new NextRequest("http://localhost/x", { method, headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const actx = (id: number, action: string) => ({ params: Promise.resolve({ id: String(id), action }) });
let ke: number; let tq: number; let customer: { id: number }; let cash: { id: number };
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await hashPassword("Admin12345");
  const mk = async (u: string, role: string) => (await prisma.user.create({ data: { username: u, fullName: u, passwordHash: hash, roles: { create: { roleId: roles[role]! } } } })).id;
  ke = await mk("ketoan", "Kế toán"); tq = await mk("thuquy", "Thủ quỹ");
  customer = await makePartner({ isCustomer: true }); cash = await makeCashAccount();
  const period = await prisma.period.findFirstOrThrow({ where: { isOpen: true } });
  await prisma.openingDiscount.create({ data: { periodId: period.id, partnerId: customer.id, amount: 500_000 } });
});

describe("API tất toán chiết khấu theo vai trò mẫu", () => {
  it("kế toán tất toán (2 lần cùng khoá = 1 phiếu), hủy được khi chưa hậu kiểm; hậu kiểm dùng discount.reconcile; thủ quỹ không tất toán", async () => {
    const body = { partnerId: customer.id, method: "CASH", amount: 200_000, cashAccountId: cash.id, date: today, note: "" };
    loginAs(tq);
    expect((await settleRoute(req("POST", body, "s0"), undefined)).status).toBe(403);
    loginAs(ke);
    const a = await settleRoute(req("POST", body, "s1"), undefined); expect(a.status).toBe(200);
    const id = (await a.json()).id as number;
    expect((await (await settleRoute(req("POST", body, "s1"), undefined)).json()).id).toBe(id);
    expect(await prisma.discountSettlement.count()).toBe(1);
    expect((await settleRoute(req("POST", { ...body, amount: 999_999 }, "s2"), undefined)).status).toBe(409);
    expect((await settleRoute(req("POST", { ...body, method: "CASH", cashAccountId: null }, "s3"), undefined)).status).toBe(400);
    expect((await actionRoute(req("POST", undefined, "r1"), actx(id, "reconcile"))).status).toBe(200); // Kế toán mặc định có discount.reconcile
    expect((await actionRoute(req("POST", { reason: "x" }, "c1"), actx(id, "cancel"))).status).toBe(409); // đã hậu kiểm
    expect((await actionRoute(req("POST", undefined, "r2"), actx(id, "nope"))).status).toBe(404);
    loginAs(null);
    expect((await settleRoute(req("POST", body, "s4"), undefined)).status).toBe(401);
  });
});
