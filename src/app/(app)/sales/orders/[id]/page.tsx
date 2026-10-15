import { notFound } from "next/navigation";
import { canPrintDoc } from "@/server/print/types";
import { OrderDetail } from "@/components/sales/OrderDetail";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { ClosedPeriodBanner } from "@/components/period/PeriodHistoryViews";
import { requireActor } from "@/server/auth/session";
import { closedPeriodOf } from "@/server/period/doc-period";
import { DomainError } from "@/server/http/errors";
import { getOrder } from "@/server/sales/queries";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("order.view");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const order = await getOrder(prisma, actor, Number(raw)).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  });
  // Đơn của kỳ đã kết sổ: không sửa/hủy/khôi phục/xác nhận (server chặn thật); vẫn thu cọc + trả hàng + giao nốt ở kỳ đang mở
  const closed = await closedPeriodOf(prisma, "saleOrder", Number(raw));
  const open = !closed;
  return (
    <>
      {closed && <div className="mb-4"><ClosedPeriodBanner periodName={closed.name} closedAt={closed.closedAt} note="Vẫn giao nốt, thu tiền và trả hàng được — chứng từ mới sẽ thuộc kỳ đang mở." /></div>}
      <OrderDetail order={order} today={ictYmd(new Date())}
        perms={{ canEdit: open && actor.perms.has("order.edit") && actor.perms.has("sale_price.view"), canCancel: open && actor.perms.has("order.cancel"), canRestore: open && actor.perms.has("order.restore"), canConfirm: open && actor.perms.has("order.create") && actor.perms.has("sale_price.view"), canDeleteDraft: open && actor.perms.has("order.delete_draft"), canDeposit: actor.perms.has("deposit.manage"), canReturn: actor.perms.has("return.manage"), canPrint: canPrintDoc(actor.perms, "SALE_INVOICE") }} />
    </>
  );
}
