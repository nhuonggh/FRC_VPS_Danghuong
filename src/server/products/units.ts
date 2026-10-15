import { Prisma } from "@prisma/client";
import { DomainError } from "@/server/http/errors";

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** D-12: factor = số đơn vị nhập trên một đơn vị gốc; qty gốc = qty / factor. */
export function convertToBase(qty: Prisma.Decimal.Value, factor: Prisma.Decimal.Value) {
  const f = decimal(factor);
  if (!f.isFinite() || !f.gt(0)) throw new DomainError("Hệ số quy đổi phải lớn hơn 0.", 400);
  const q = decimal(qty);
  if (!q.isFinite() || q.lt(0)) throw new DomainError("Số lượng không được âm.", 400);
  return q.div(f).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

export function resolveFactor(product: { baseUnit: string; units: { unit: string; factor: Prisma.Decimal }[] }, unit: string) {
  if (unit === product.baseUnit) return decimal(1);
  const found = product.units.find((item) => item.unit === unit);
  if (!found) throw new DomainError(`Sản phẩm chưa khai báo đơn vị "${unit}".`, 400);
  return found.factor;
}
