import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as decideRoute } from "@/app/api/cash/adjustments/[id]/route";
import { GET as exportRoute } from "@/app/api/cash/book/export/route";
import { POST as closeRoute } from "@/app/api/cash/closes/route";
import { DELETE as voidCloseRoute } from "@/app/api/cash/closes/[id]/route";
import { GET as partnersRoute } from "@/app/api/cash/partners/route";
import { POST as createRoute } from "@/app/api/vouchers/[kind]/route";
import { PATCH as editRoute } from "@/app/api/vouchers/[kind]/[id]/route";
import { POST as actionRoute } from "@/app/api/vouchers/[kind]/[id]/[action]/route";
import { POST as expensePOST } from "@/app/api/expenses/route";
import { PATCH as expensePATCH } from "@/app/api/expenses/[id]/route";
import { GET as expenseExport } from "@/app/api/expenses/export/route";
import { hashPassword } from "@/server/auth/password";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner } from "../helpers/factories";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
const session = vi.mocked(getServerSession);
const loginAs = (id: number | null) => session.mockResolvedValue(id === null ? null : ({ user: { id } } as never));
const req = (url: string, method: string, body?: unknown, key?: string) => new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const kctx = (kind: string) => ({ params: Promise.resolve({ kind }) });
const vctx = (kind: string, id: number, action = "") => ({ params: Promise.resolve({ kind, id: String(id), action }) });
let ke: number; let tq: number; let bh: number; let customer: { id: number }; let cash: { id: number };
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const body = (over = {}) => ({ type: "THU_NO", partnerId: customer.id, orderId: null, cashAccountId: cash.id, amount: 300_000, date: today, note: "", ...over });

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  session.mockReset();
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const hash = await hashPassword("Admin12345");
  const mk = async (username: string, role: string) => (await prisma.user.create({ data: { username, fullName: username, passwordHash: hash, roles: { create: { roleId: roles[role]! } } } })).id;
  ke = await mk("ketoan", "Kế toán"); tq = await mk("thuquy", "Thủ quỹ"); bh = await mk("banhang", "Bán hàng");
  customer = await makePartner({ isCustomer: true }); cash = await makeCashAccount();
});

describe("API phiếu thu/chi theo vai trò mẫu (seed)", () => {
  it("kế toán lập (bấm 2 lần cùng khoá = 1 phiếu), không tự kiểm tra được; thủ quỹ kiểm; sau đó kế toán không sửa trực tiếp; điều chỉnh qua duyệt", async () => {
    loginAs(ke);
    const a = await createRoute(req("/api/vouchers/receipts", "POST", body(), "k1"), kctx("receipts")); expect(a.status).toBe(200);
    const id = (await a.json()).id as number;
    const dup = await createRoute(req("/api/vouchers/receipts", "POST", body(), "k1"), kctx("receipts")); expect((await dup.json()).id).toBe(id);
    expect(await prisma.receipt.count()).toBe(1);
    expect((await actionRoute(req("/x", "POST", undefined, "r1"), vctx("receipts", id, "review"))).status).toBe(403);
    expect((await createRoute(req("/x", "POST", body()), kctx("receipts"))).status).toBe(400); // thiếu Idempotency-Key
    expect((await editRoute(req("/x", "PATCH", body({ amount: 200_000 })), vctx("receipts", id))).status).toBe(200);
    loginAs(tq);
    expect((await actionRoute(req("/x", "POST", undefined, "r2"), vctx("receipts", id, "review"))).status).toBe(200);
    expect((await actionRoute(req("/x", "POST", undefined, "r3"), vctx("receipts", id, "review"))).status).toBe(409);
    loginAs(ke);
    expect((await editRoute(req("/x", "PATCH", body({ amount: 1 })), vctx("receipts", id))).status).toBe(409);
    expect((await actionRoute(req("/x", "POST", { reason: "x" }), vctx("receipts", id, "cancel"))).status).toBe(409);
    const adj = await actionRoute(req("/x", "POST", { kind: "VOID", reason: "nhầm khách" }, "a1"), vctx("receipts", id, "adjust")); expect(adj.status).toBe(200);
    const adjId = (await adj.json()).id as number;
    expect((await decideRoute(req("/x", "POST", { approve: true, note: "" }, "d0"), { params: Promise.resolve({ id: String(adjId) }) })).status).toBe(403);
    loginAs(tq);
    expect((await decideRoute(req("/x", "POST", { approve: true, note: "" }, "d1"), { params: Promise.resolve({ id: String(adjId) }) })).status).toBe(200);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id } })).isCancelled).toBe(true);
    expect(await prisma.cashLedger.count()).toBe(2);
  });

  it("bán hàng không lập/không xem phiếu; chưa đăng nhập 401; loại phiếu sai 404; dữ liệu sai 400", async () => {
    loginAs(bh);
    expect((await createRoute(req("/x", "POST", body(), "k"), kctx("receipts"))).status).toBe(403);
    expect((await partnersRoute(req("/api/cash/partners?q=a", "GET"), undefined)).status).toBe(403);
    expect((await exportRoute(req("/api/cash/book/export", "GET") as never)).status).toBe(403);
    loginAs(null);
    expect((await createRoute(req("/x", "POST", body(), "k"), kctx("receipts"))).status).toBe(401);
    loginAs(ke);
    expect((await createRoute(req("/x", "POST", body(), "k"), kctx("nope"))).status).toBe(404);
    expect((await createRoute(req("/x", "POST", body({ amount: -5 }), "k"), kctx("receipts"))).status).toBe(400);
    expect((await createRoute(req("/x", "POST", { kind: "KHAC", partnerId: customer.id, cashAccountId: cash.id, amount: 5, date: today, note: "" }, "k2"), kctx("payments"))).status).toBe(400);
  });

  it("tìm đối tác cho form; xuất sổ quỹ ra Excel; chốt quỹ cần quyền, kế toán bị chặn; hủy chốt cần cash.close.reopen (chỉ giám đốc)", async () => {
    loginAs(ke);
    const found = await partnersRoute(req(`/api/cash/partners?role=customer&q=${encodeURIComponent(customer.id === 0 ? "" : "")}`, "GET"), undefined);
    expect(found.status).toBe(200); expect((await found.json()).length).toBeGreaterThan(0);
    expect((await exportRoute(req("/api/cash/book/export?type=CASH", "GET") as never)).headers.get("content-type")).toContain("spreadsheet");
    const closeBody = { cashAccountId: cash.id, closeAt: new Date().toISOString(), actual: 0, reason: "" };
    expect((await closeRoute(req("/x", "POST", closeBody, "c0"), undefined)).status).toBe(403);
    loginAs(tq);
    const c = await closeRoute(req("/x", "POST", closeBody, "c1"), undefined); expect(c.status).toBe(200);
    const cid = (await c.json()).id as number;
    expect((await voidCloseRoute(req("/x", "DELETE", { reason: "nhầm" }, "c2"), { params: Promise.resolve({ id: String(cid) }) })).status).toBe(403);
  });

  it("chi phí: kế toán lập/sửa/xuất; thủ quỹ (không có expense.manage) bị chặn; hủy qua phiếu chi bằng quyền chi phí", async () => {
    const type = await prisma.expenseType.create({ data: { name: "Điện" } });
    const eb = (over = {}) => ({ expenseTypeId: type.id, cashAccountId: cash.id, amount: 800_000, date: today, note: "Điện", ...over });
    loginAs(tq);
    expect((await expensePOST(req("/x", "POST", eb(), "e0"), undefined)).status).toBe(403);
    loginAs(ke);
    const c = await expensePOST(req("/x", "POST", eb(), "e1"), undefined); expect(c.status).toBe(200);
    const created = await c.json() as { id: number; paymentId: number };
    expect((await expensePATCH(req("/x", "PATCH", eb({ amount: 900_000 })), { params: Promise.resolve({ id: String(created.id) }) })).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: created.paymentId } })).amount.toString()).toBe("900000");
    expect((await expenseExport(req("/api/expenses/export", "GET"))).headers.get("content-type")).toContain("spreadsheet");
    expect((await actionRoute(req("/x", "POST", { reason: "nhầm" }), vctx("payments", created.paymentId, "cancel"))).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: created.paymentId } })).isCancelled).toBe(true);
    expect(await prisma.cashLedger.count()).toBe(0);
    loginAs(bh);
    expect((await expenseExport(req("/api/expenses/export", "GET"))).status).toBe(403);
  });
});
