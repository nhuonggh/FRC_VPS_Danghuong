import { DiscountList } from "@/components/discount/DiscountList";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DISCOUNT_FILTER_KEYS, listDiscountBalances } from "@/server/discount/queries";

export const dynamic = "force-dynamic";

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("debt.view");
  const params = parseListParams(await searchParams, DISCOUNT_FILTER_KEYS);
  const data = await listDiscountBalances(prisma, actor, params);
  return <DiscountList rows={data.rows} total={data.total} summary={data.summary} params={params} />;
}
