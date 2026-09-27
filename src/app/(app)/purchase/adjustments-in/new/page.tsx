import { AdjustmentInForm } from "@/components/purchase/AdjustmentInForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
export default async function NewAdjustmentInPage() { const actor = await requireActor("stock_adjust.manage"); return <AdjustmentInForm today={ictYmd(new Date())} canSetCost={actor.perms.has("cost.view")} />; }
