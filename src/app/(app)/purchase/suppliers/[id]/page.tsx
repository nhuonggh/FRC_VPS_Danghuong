import { loadPartnerDetail } from "@/components/partners/load-detail";
import { requireActor } from "@/server/auth/session";
export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) { return loadPartnerDetail("supplier", await requireActor("partner.view"), (await params).id); }
