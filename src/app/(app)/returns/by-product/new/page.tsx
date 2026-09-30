import { ReturnByProductForm } from "@/components/returns/ReturnByProductForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewReturnPage() {
  await requireActor("return.manage");
  return <ReturnByProductForm mode="BY_PRODUCT" today={ictYmd(new Date())} />;
}
