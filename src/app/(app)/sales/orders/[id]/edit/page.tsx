import { notFound, redirect } from "next/navigation";
import { SaleOrderForm } from "@/components/sales/SaleOrderForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { loadSaleFormOptions } from "@/server/sales/form-options";
import { getOrderForEdit } from "@/server/sales/queries";

export const dynamic = "force-dynamic";

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("order.edit");
  if (!actor.perms.has("sale_price.view")) redirect("/403"); // form sửa cần thấy giá bán (như lúc lập đơn)
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const edit = await getOrderForEdit(prisma, actor, Number(raw)).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 409) redirect(`/sales/orders/${raw}`); // đơn đã hủy: xem chi tiết để khôi phục
    throw e;
  });
  return <SaleOrderForm today={ictYmd(new Date())} canEditPrice={actor.perms.has("order.edit_price")} edit={edit} options={await loadSaleFormOptions(prisma, actor)} />;
}
