import { StocktakeForm } from "@/components/stocktake/StocktakeForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewStocktakePage() {
  await requireActor("stocktake.manage");
  return <StocktakeForm today={ictYmd(new Date())} />;
}
