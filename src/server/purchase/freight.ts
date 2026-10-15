import { Prisma } from "@prisma/client";
import { DomainError } from "@/server/http/errors";

/** Freight is capitalised into receipt lots. This is the approved D-13 default. */
export const FREIGHT_IN_COST = true;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Allocate freight by line value, preserving the exact two-decimal total.
 * The largest fractional remainders receive the remaining cents; ties keep
 * the document line order so the result is deterministic.
 */
export function allocateFreight(amounts: Prisma.Decimal[], freight: Prisma.Decimal): Prisma.Decimal[] {
  const total = amounts.reduce((sum, amount) => sum.plus(amount), D(0));
  if (freight.isZero()) return amounts.map(() => D(0));
  if (!total.gt(0)) {
    throw new DomainError("Không phân bổ được cước khi tổng tiền hàng bằng 0.", 400);
  }

  const exact = amounts.map((amount) => freight.times(amount).div(total));
  const floored = exact.map((value) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN));
  const cents = freight.minus(floored.reduce((sum, value) => sum.plus(value), D(0))).times(100).toNumber();
  const order = exact
    .map((value, index) => ({ index, fraction: value.minus(floored[index]!) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);

  for (let index = 0; index < cents; index++) {
    const target = order[index % order.length]!.index;
    floored[target] = floored[target]!.plus("0.01");
  }
  return floored;
}
