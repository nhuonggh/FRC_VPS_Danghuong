import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

import { defaultCapabilities } from "@/server/products/capabilities";
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
    data: { code: `SP${i}`, name: `Sản phẩm ${i}`, searchText: `san pham ${i}`, baseUnit: "md", ...defaultCapabilities(over.kind ?? "HANG"), ...over },
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

export async function makeWarehouse(name = `Kho ${next()}`) {
  return prisma.warehouse.create({ data: { name } });
}

export async function makeProcessingType(name = `Kiểu ${next()}`) {
  return prisma.processingType.create({ data: { name } });
}

export async function makeVehicle(plate = `51C-${next()}`) {
  return prisma.vehicle.create({ data: { plate } });
}

/** BOM + một phiên bản (mặc định ACTIVE, hiệu lực 2026-09-01) với các dòng cho trước. */
export async function makeBomVersion(opts: {
  productId: number;
  processingTypeId: number;
  createdBy: number;
  validFrom?: string; // YYYY-MM-DD
  status?: "DRAFT" | "ACTIVE" | "CANCELLED";
  lines: { materialProductId: number; qtyPerUnit: number | string }[];
}) {
  const bom = await prisma.bom.upsert({
    where: { productId_processingTypeId: { productId: opts.productId, processingTypeId: opts.processingTypeId } },
    update: {},
    create: { productId: opts.productId, processingTypeId: opts.processingTypeId, createdBy: opts.createdBy },
  });
  const versionNo = (await prisma.bomVersion.count({ where: { bomId: bom.id } })) + 1;
  return prisma.bomVersion.create({
    data: {
      bomId: bom.id, versionNo, validFrom: new Date(`${opts.validFrom ?? "2026-09-01"}T00:00:00Z`),
      status: opts.status ?? "ACTIVE", createdBy: opts.createdBy,
      lines: { create: opts.lines },
    },
    include: { lines: true },
  });
}
