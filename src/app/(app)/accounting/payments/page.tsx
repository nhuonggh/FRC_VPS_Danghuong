import { VoucherList } from "@/components/cash/VoucherList";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listVouchers, VOUCHER_FILTER_KEYS } from "@/server/cash/queries";

export const dynamic = "force-dynamic";

export default async function PaymentListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("payment.manage");
  const params = parseListParams(await searchParams, VOUCHER_FILTER_KEYS);
  const data = await listVouchers(prisma, actor, "PAYMENT", params);
  return <VoucherList doc="PAYMENT" rows={data.rows} total={data.total} stats={data.stats} params={params} canCreate={actor.perms.has("cash.transaction.create")} />;
}
