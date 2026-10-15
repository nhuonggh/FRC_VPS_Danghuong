import { DebtTransferForm } from "@/components/debt/DebtTransferForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewDebtTransferPage() {
  await requireActor("debt.adjust");
  return <DebtTransferForm today={ictYmd(new Date())} />;
}
