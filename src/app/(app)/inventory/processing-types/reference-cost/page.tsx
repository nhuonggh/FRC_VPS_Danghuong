import { BulkReferenceCostForm } from "@/components/products/BulkReferenceCostForm";
import { listActiveOptions } from "@/server/catalog/queries";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function BulkReferenceCostPage() {
  const actor = await requireActor("cost.view");
  if (!actor.perms.has("bom.manage") && !actor.perms.has("product.manage")) await requireActor("bom.manage");
  return <BulkReferenceCostForm today={ictYmd(new Date())} types={await listActiveOptions(prisma, "processing-types")} />;
}
