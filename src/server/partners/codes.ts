import type { Prisma } from "@prisma/client";

/** Khoá tư vấn tuần tự hoá việc cấp mã giữa các transaction đồng thời. */
const PARTNER_CODE_LOCK = 7_710_002;

export type PartnerKind = "customer" | "supplier";
export const CODE_PREFIX: Record<PartnerKind, string> = { customer: "KH", supplier: "NCC" };
const format = (prefix: string, n: number) => `${prefix}${String(n).padStart(6, "0")}`;

/** Gọi trong transaction ghi đối tác; chỉ tính mã đúng dạng KH/NCC + số. */
export async function nextPartnerCodes(db: Prisma.TransactionClient, kind: PartnerKind, count: number): Promise<string[]> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${PARTNER_CODE_LOCK})`;
  const prefix = CODE_PREFIX[kind];
  const pattern = `^${prefix}([0-9]{1,9})$`;
  const rows = await db.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("code" FROM ${pattern}::text) AS INTEGER)) AS n FROM partners`;
  const max = rows[0]?.n ?? 0;
  return Array.from({ length: count }, (_, i) => format(prefix, max + 1 + i));
}
