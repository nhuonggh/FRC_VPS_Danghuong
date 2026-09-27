import { PartnerList } from "@/components/partners/PartnerList";
import { requireActor } from "@/server/auth/session";
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <PartnerList kind="supplier" actor={await requireActor("partner.view")} searchParams={await searchParams} />; }
