import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { getUser, listUsers } from "@/server/users/queries";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
});

async function addUser(username: string, fullName: string, role: string, isLocked = false) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  return makeUser({ username, fullName, isLocked, roles: { create: { roleId: r.id } } });
}

describe("listUsers", () => {
  it("tìm không dấu theo họ tên/tên đăng nhập", async () => {
    await addUser("nam", "Nguyễn Văn Nam", "Bán hàng");
    await addUser("huong", "Đặng Hương", "Kế toán");
    expect((await listUsers(prisma, parseListParams({ q: "nguyen" }))).rows.map((r) => r.username)).toEqual(["nam"]);
    expect((await listUsers(prisma, parseListParams({ q: "DANG HUONG" }))).rows.map((r) => r.username)).toEqual(["huong"]);
  });

  it("lọc trạng thái + vai trò; stat KHÔNG phụ thuộc bộ lọc trạng thái đang chọn", async () => {
    await addUser("a", "A", "Bán hàng");
    await addUser("b", "B", "Bán hàng", true);
    await addUser("c", "C", "Kế toán");
    const locked = await listUsers(prisma, parseListParams({ status: "locked" }, ["status", "role"]));
    expect(locked.rows.map((r) => r.username)).toEqual(["b"]);
    expect(locked.total).toBe(1);
    expect(locked.stats).toEqual({ all: 3, active: 2, locked: 1 }); // đếm trên toàn bộ, không theo status
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Kế toán" } });
    const acc = await listUsers(prisma, parseListParams({ role: String(role.id) }, ["status", "role"]));
    expect(acc.rows.map((r) => r.username)).toEqual(["c"]);
  });

  it("phân trang + sắp xếp chỉ theo cột cho phép; không lộ passwordHash", async () => {
    for (let i = 0; i < 25; i++) await addUser(`u${String(i).padStart(2, "0")}`, `Người ${i}`, "Bán hàng");
    const p1 = await listUsers(prisma, parseListParams({ sort: "username" }));
    expect(p1.rows).toHaveLength(20);
    expect(p1.total).toBe(25);
    expect(p1.rows[0]!.username).toBe("u00");
    const p2 = await listUsers(prisma, parseListParams({ sort: "username", page: "2" }));
    expect(p2.rows).toHaveLength(5);
    expect(JSON.stringify(p1.rows)).not.toContain("passwordHash");
    const desc = await listUsers(prisma, parseListParams({ sort: "-username" }));
    expect(desc.rows[0]!.username).toBe("u24");
    const evil = await listUsers(prisma, parseListParams({ sort: "passwordHash" }));
    expect(evil.rows).toHaveLength(20); // rơi về sort mặc định, không lỗi
    expect(JSON.stringify(evil.rows)).not.toContain("passwordHash");
  });
});

describe("getUser", () => {
  it("trả vai trò, không lộ passwordHash; không có → 404", async () => {
    const u = await addUser("nam", "Nam", "Bán hàng");
    const got = await getUser(prisma, u.id);
    expect(got.roles.map((r) => r.name)).toEqual(["Bán hàng"]);
    expect(JSON.stringify(got)).not.toContain("passwordHash");
    await expect(getUser(prisma, 999999)).rejects.toMatchObject({ status: 404 });
  });
});
