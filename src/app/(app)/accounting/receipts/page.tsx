import { VoucherList } from "@/components/cash/VoucherList";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listVouchers, VOUCHER_FILTER_KEYS } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function ReceiptListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("receipt.manage");
  const params = parseListParams(await searchParams, VOUCHER_FILTER_KEYS);
  const data = await listVouchers(prisma, actor, "RECEIPT", params);
  return <VoucherList doc="RECEIPT" rows={data.rows} total={data.total} stats={data.stats} params={params} canCreate={actor.perms.has("cash.transaction.create")} />;
}
