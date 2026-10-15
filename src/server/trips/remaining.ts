import { Prisma } from "@prisma/client";

/** returnLines must contain only active returns of UNDELIVERED goods. */
export function remainingToDeliver(line: { qty: Prisma.Decimal; deliveryLines: { qty: Prisma.Decimal }[]; returnLines?: { qty: Prisma.Decimal }[] }) {
  const delivered = line.deliveryLines.reduce((s, d) => s.plus(d.qty), new Prisma.Decimal(0));
  const returned = (line.returnLines ?? []).reduce((s, d) => s.plus(d.qty), new Prisma.Decimal(0));
  return Prisma.Decimal.max(0, line.qty.minus(delivered).minus(returned));
}
