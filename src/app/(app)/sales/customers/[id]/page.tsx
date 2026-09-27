import { loadPartnerDetail } from "@/components/partners/load-detail";
import { requireActor } from "@/server/auth/session";
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) { return loadPartnerDetail("customer", await requireActor("partner.view"), (await params).id); }
