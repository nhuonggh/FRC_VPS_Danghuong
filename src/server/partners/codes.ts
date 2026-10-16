import type { Prisma } from "@prisma/client";

/** Khoá tư vấn tuần tự hoá việc cấp mã giữa các transaction đồng thời. */
const PARTNER_CODE_LOCK = 7_710_002;

export type PartnerKind = "customer" | "supplier";
export const CODE_PREFIX: Record<PartnerKind, string> = { customer: "KH", supplier: "NCC" };
/** Tiền tố mã khách lẻ thân quen (KL000001…). */
export const REGULAR_RETAIL_PREFIX = "KL";
const format = (prefix: string, n: number) => `${prefix}${String(n).padStart(6, "0")}`;

/** Gọi trong transaction ghi đối tác; chỉ tính mã đúng dạng tiền tố + số. */
export async function nextPartnerCodesWithPrefix(db: Prisma.TransactionClient, prefix: string, count: number): Promise<string[]> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${PARTNER_CODE_LOCK})`;
  const pattern = `^${prefix}([0-9]{1,9})$`;
  const rows = await db.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("code" FROM ${pattern}::text) AS INTEGER)) AS n FROM partners`;
  const max = rows[0]?.n ?? 0;
  return Array.from({ length: count }, (_, i) => format(prefix, max + 1 + i));
}

export const nextPartnerCodes = (db: Prisma.TransactionClient, kind: PartnerKind, count: number) => nextPartnerCodesWithPrefix(db, CODE_PREFIX[kind], count);
