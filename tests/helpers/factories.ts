import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

let n = 0;
const next = () => ++n;

export async function makeUser(over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.user.create({
    data: { username: `user${i}`, passwordHash: "x", fullName: `Người dùng ${i}`, ...over },
  });
}

export async function makePeriod(over: Partial<Prisma.PeriodUncheckedCreateInput> = {}) {
  return prisma.period.create({
    data: { name: `Kỳ ${next()}`, status: "OPEN", isOpen: true, ...over },
  });
}

export async function makeProduct(over: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.product.create({
    data: { code: `SP${i}`, name: `Sản phẩm ${i}`, searchText: `san pham ${i}`, baseUnit: "md", ...over },
  });
}

export async function makePartnerGroup(name = `Nhóm ${next()}`) {
  return prisma.partnerGroup.create({ data: { name } });
}

export async function makePartner(over: Partial<Prisma.PartnerUncheckedCreateInput> = {}) {
  const i = next();
  const groupId = over.groupId ?? (await makePartnerGroup()).id;
  return prisma.partner.create({
    data: { code: `KH${i}`, name: `Khách ${i}`, searchText: `khach ${i}`, ...over, groupId },
  });
}

export async function makeCashAccount(over: Partial<Prisma.CashAccountUncheckedCreateInput> = {}) {
  return prisma.cashAccount.create({
    data: { type: "CASH", name: `Quỹ ${next()}`, ...over },
  });
}
