import { redirect } from "next/navigation";
import { LegacyImport } from "@/components/sales/LegacyImport";
import { requireActor } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function LegacyImportPage() {
  const actor = await requireActor("order.create");
  if (!actor.perms.has("sale_price.view")) redirect("/403"); // lập đơn cần xem giá bán
  return <LegacyImport />;
}
