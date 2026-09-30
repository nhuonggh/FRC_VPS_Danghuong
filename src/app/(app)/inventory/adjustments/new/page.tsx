import { LossAdjustForm } from "@/components/stock-adjust/LossAdjustForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewLossAdjustmentPage() {
  await requireActor("stock_adjust.manage");
  return <LossAdjustForm today={ictYmd(new Date())} />;
}
