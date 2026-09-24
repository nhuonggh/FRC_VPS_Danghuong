import { beforeEach, describe, expect, it } from "vitest";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makeUser } from "../helpers/factories";

beforeEach(resetDb);

describe("phạm vi dữ liệu khách hàng", () => {
  it("không có partner.view_all → chỉ thấy khách của mình (áp ở tầng query)", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makePartner({ code: "A1", ownerUserId: a.id });
    await makePartner({ code: "A2", ownerUserId: a.id });
    await makePartner({ code: "B1", ownerUserId: b.id });
    await makePartner({ code: "X1" }); // chưa có người phụ trách

    const own = await prisma.partner.findMany({
      where: partnerScopeWhere({ userId: a.id, perms: new Set(["order.view"]) }),
    });
    expect(own.map((p) => p.code).sort()).toEqual(["A1", "A2"]);
  });

  it("có partner.view_all → thấy tất cả", async () => {
    const a = await makeUser();
    await makePartner({ code: "A1", ownerUserId: a.id });
    await makePartner({ code: "X1" });
    const all = await prisma.partner.findMany({
      where: partnerScopeWhere({ userId: a.id, perms: new Set(["partner.view_all"]) }),
    });
    expect(all).toHaveLength(2);
  });

  it("tập quyền rỗng → vẫn bị giới hạn theo người phụ trách (mặc định hẹp)", () => {
    expect(partnerScopeWhere({ userId: 5, perms: new Set<string>() })).toEqual({ ownerUserId: 5 });
  });
});
