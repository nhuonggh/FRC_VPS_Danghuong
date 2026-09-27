import type { Prisma } from "@prisma/client";

export const formatDocCode = (prefix: string, id: number) => `${prefix}${String(id).padStart(6, "0")}`;

/** Uses the table's own sequence so the visible code is stable and unique. */
export async function nextDocId(tx: Prisma.TransactionClient, table: "purchases" | "stock_adjustments"): Promise<number> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence(${table}, 'id'))::int AS id`;
  return rows[0]!.id;
}
