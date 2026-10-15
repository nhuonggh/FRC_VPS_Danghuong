import { ReturnListPage } from "@/components/returns/ReturnListPage";
import { requireActor } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("return.manage");
  return <ReturnListPage actor={actor} title="Danh sách trả theo đơn" base="/returns/by-order" kinds={["BY_ORDER"]} newHref="/returns/by-order/new" searchParams={searchParams} />;
}
