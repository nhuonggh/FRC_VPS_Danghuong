import { beforeEach, describe, expect, it } from "vitest";
import { emptyPrefs, setActive, setSidebarCollapsed, togglePin } from "@/lib/workspace";
import { getPreferences, savePreferences } from "@/server/preferences/service";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);

describe("cấu hình giao diện theo tài khoản", () => {
  it("chưa có ⇒ mặc định; lưu rồi đọc lại đúng; lưu lần hai ghi đè (một dòng/tài khoản)", async () => {
    const u = await makeUser(); expect(await getPreferences(prisma, u.id)).toEqual(emptyPrefs());
    const p = setSidebarCollapsed(setActive(togglePin(emptyPrefs(), "sales", "order-list"), "sales", "order-list"), true);
    await savePreferences(prisma, u.id, p); expect(await getPreferences(prisma, u.id)).toEqual(p);
    await savePreferences(prisma, u.id, emptyPrefs()); expect(await getPreferences(prisma, u.id)).toEqual(emptyPrefs());
    expect(await prisma.userPreference.count()).toBe(1);
  });

  it("mỗi tài khoản một cấu hình riêng, không lẫn nhau", async () => {
    const a = await makeUser(); const b = await makeUser();
    await savePreferences(prisma, a.id, togglePin(emptyPrefs(), "sales", "order-list"));
    expect((await getPreferences(prisma, b.id)).modules).toEqual({});
  });

  it("dữ liệu hỏng trong DB ⇒ về mặc định thay vì lỗi; xoá user xoá luôn cấu hình", async () => {
    const u = await makeUser(); await prisma.userPreference.create({ data: { userId: u.id, data: { v: 99, bậy: true } } });
    expect(await getPreferences(prisma, u.id)).toEqual(emptyPrefs());
    await prisma.user.delete({ where: { id: u.id } }); expect(await prisma.userPreference.count()).toBe(0);
  });
});
