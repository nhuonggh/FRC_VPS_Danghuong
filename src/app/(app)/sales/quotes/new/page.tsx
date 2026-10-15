import { redirect } from "next/navigation";
import { QuoteForm } from "@/components/sales/QuoteForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewQuotePage() {
  const actor = await requireActor("quote.manage");
  if (!actor.perms.has("sale_price.view")) redirect("/403"); // giá là nội dung của báo giá
  return <QuoteForm today={ictYmd(new Date())} />;
}
