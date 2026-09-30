import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createRoute } from "@/app/api/trips/route";
import { GET as ordersRoute } from "@/app/api/trips/orders/route";
import { POST as actionRoute } from "@/app/api/trips/[id]/[action]/route";
import { POST as handleRoute } from "@/app/api/trips/stops/[id]/handle/route";
import { hashPassword } from "@/server/auth/password";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeProduct } from "../helpers/factories";
import { buy, engine, T } from "../inventory/helpers";
import { useNoopCostOwners } from "../inventory/helpers";

useNoopCostOwners();
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));
const req = (method: string, body?: unknown, key?: string) => new NextRequest("http://localhost/x", { method, headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const actx = (id: number, action: string) => ({ params: Promise.resolve({ id: String(id), action }) });
let ke: number; let tq: number; let bh: number; let orderId: number; let vehicleId: number; let driverId: number; let cashId: number;
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await hashPassword("Admin12345");
  const mk = async (u: string, role: string) => (await prisma.user.create({ data: { username: u, fullName: u, passwordHash: hash, roles: { create: { roleId: roles[role]! } } } })).id;
  ke = await mk("ketoan", "Kế toán"); tq = await mk("thuquy", "Thủ quỹ"); bh = await mk("banhang", "Bán hàng");
  const period = await prisma.period.findFirstOrThrow({ where: { isOpen: true } });
  const p = await makeProduct({ kind: "THANH_PHAM" });
  await engine({ userId: ke, periodId: period.id } as never)([p.id], (ctx) => buy(ctx, p.id, 100, 10_000, new Date(Date.now() - 3600_000), 1));
  const customer = await makePartner({ isCustomer: true, allowCredit: true });
  const actor = { userId: ke, perms: new Set(["order.create", "sale_price.view", "order.edit_price", "partner.view_all"]) };
  orderId = (await createSaleOrderIdempotent(prisma, actor, "o1", saleOrderSchema.parse({ partnerId: customer.id, date: today, expectedDeliveryDate: today, note: "", lines: [{ productId: p.id, unit: p.baseUnit, qty: 2, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] }))).id;
  vehicleId = (await prisma.vehicle.create({ data: { plate: "51C-1" } })).id; driverId = (await prisma.driver.create({ data: { name: "Lái A" } })).id; cashId = (await makeCashAccount()).id;
});

describe("API chuyến giao theo vai trò mẫu", () => {
  it("kế toán xếp chuyến → nhập kết quả → đối soát; thủ quỹ xác nhận nhận tiền; bán hàng không dùng được", async () => {
    loginAs(bh);
    expect((await createRoute(req("POST", { date: today, routeId: null, vehicleId, driverId, assistantId: null, note: "", orderIds: [orderId] }, "t0"), undefined)).status).toBe(403);
    expect((await ordersRoute(req("GET"), undefined)).status).toBe(403);
    loginAs(null);
    expect((await createRoute(req("POST", {}, "t0"), undefined)).status).toBe(401);
    loginAs(ke);
    const body = { date: today, routeId: null, vehicleId, driverId, assistantId: null, note: "", orderIds: [orderId] };
    const c = await createRoute(req("POST", body, "t1"), undefined); expect(c.status).toBe(200);
    const id = (await c.json()).id as number;
    expect((await (await createRoute(req("POST", body, "t1"), undefined)).json()).id).toBe(id);
    expect(await prisma.trip.count()).toBe(1);
    expect((await createRoute(req("POST", { ...body, orderIds: [] }, "t2"), undefined)).status).toBe(400);
    expect((await actionRoute(req("POST", { orderId, result: "GIAO_DU", cashAmount: 100_000 }, "r1"), actx(id, "result"))).status).toBe(200);
    expect((await actionRoute(req("POST", { orderId, result: "HEN_TRA", debtAmount: 5 }, "r2"), actx(id, "result"))).status).toBe(400);
    expect((await actionRoute(req("POST", { reason: "" }, "s0"), actx(id, "settle"))).status).toBe(200); // khớp: không cần lý do
    expect((await actionRoute(req("POST", { cashAccountId: cashId, transferAccountId: null }, "c0"), actx(id, "confirm"))).status).toBe(403); // kế toán không phải thủ quỹ
    loginAs(tq);
    expect((await actionRoute(req("POST", { cashAccountId: null, transferAccountId: null }, "c1"), actx(id, "confirm"))).status).toBe(400);
    const ok = await actionRoute(req("POST", { cashAccountId: cashId, transferAccountId: null }, "c2"), actx(id, "confirm")); expect(ok.status).toBe(200);
    expect((await actionRoute(req("POST", { cashAccountId: cashId, transferAccountId: null }, "c3"), actx(id, "confirm"))).status).toBe(409);
    expect(await prisma.receipt.count({ where: { tripId: id } })).toBe(1);
    expect((await actionRoute(req("POST", {}, "x"), actx(id, "nope"))).status).toBe(404);
  });
  it("hủy chuyến chưa có kết quả; ghi nhận đã xử lý hàng không giao được", async () => {
    loginAs(ke);
    const c = await createRoute(req("POST", { date: today, routeId: null, vehicleId, driverId, assistantId: null, note: "", orderIds: [orderId] }, "t1"), undefined);
    const id = (await c.json()).id as number;
    expect((await actionRoute(req("POST", { reason: "" }), actx(id, "cancel"))).status).toBe(400);
    expect((await actionRoute(req("POST", { reason: "xe hỏng" }), actx(id, "cancel"))).status).toBe(200);
    const c2 = await createRoute(req("POST", { date: today, routeId: null, vehicleId, driverId, assistantId: null, note: "", orderIds: [orderId] }, "t2"), undefined);
    const id2 = (await c2.json()).id as number;
    await actionRoute(req("POST", { orderId, result: "KHONG_GIAO", note: "vắng" }, "r1"), actx(id2, "result"));
    const stop = await prisma.tripOrder.findFirstOrThrow({ where: { tripId: id2 } });
    expect((await handleRoute(req("POST", { note: "" }), { params: Promise.resolve({ id: String(stop.id) }) })).status).toBe(400);
    expect((await handleRoute(req("POST", { note: "giao lại thứ 6" }), { params: Promise.resolve({ id: String(stop.id) }) })).status).toBe(200);
  });
});
