import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  makeCashAccount,
  makePartner,
  makePartnerGroup,
  makePeriod,
  makeProduct,
  makeUser,
} from "../helpers/factories";

describe("factories", () => {
  beforeEach(resetDb);

  it("tạo được mọi thực thể nền với mặc định hợp lệ", async () => {
    const user = await makeUser();
    const period = await makePeriod();
    const product = await makeProduct();
    const partner = await makePartner({ ownerUserId: user.id });
    const cash = await makeCashAccount({ type: "BANK", bankNo: "123" });

    expect(period.status).toBe("OPEN");
    expect(period.isOpen).toBe(true);
    expect(product.baseUnit).toBe("md");
    expect(partner.ownerUserId).toBe(user.id);
    expect(cash.type).toBe("BANK");
    expect(await prisma.partnerGroup.count()).toBe(1);
  });

  it("gọi nhiều lần không đụng ràng buộc unique (code/username/name)", async () => {
    await makeUser();
    await makeUser();
    await makeProduct();
    await makeProduct();
    await makePartner();
    await makePartner();
    await makePartnerGroup();
    await makePartnerGroup();
    expect(await prisma.product.count()).toBe(2);
    expect(await prisma.partner.count()).toBe(2);
  });

  it("makePartner dùng lại groupId truyền vào thay vì tạo nhóm mới", async () => {
    const g = await makePartnerGroup("Đại lý");
    const p = await makePartner({ groupId: g.id });
    expect(p.groupId).toBe(g.id);
    expect(await prisma.partnerGroup.count()).toBe(1);
  });

  it("chỉ cho phép MỘT kỳ đang mở (isOpen unique)", async () => {
    await makePeriod();
    await expect(makePeriod()).rejects.toThrow();
    const closed = await makePeriod({ status: "CLOSED", isOpen: null, closedAt: new Date() });
    expect(closed.isOpen).toBeNull();
  });
});
