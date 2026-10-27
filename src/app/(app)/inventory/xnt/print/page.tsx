import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime } from "@/lib/format";
import { listTimeRange, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { xntList, XNT_NO_GROUP } from "@/server/inventory-reports/xnt";
import { XntPrintTable } from "@/components/inventory/XntPrintTable";
import { OrderPrintButton } from "@/components/sales/OrderPrintButton";
import styles from "./print.module.css";

export const dynamic = "force-dynamic";
/** In báo cáo XNT: toàn bộ dòng theo bộ lọc đang xem (không giới hạn theo trang), chỉ các cột khách đã chọn ở bảng. */
export default async function XntPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const parsed = parseListParams(await searchParams, ["group"]), params = listTimeRange(parsed) ? parsed : { ...parsed, timePreset: "today" as const, timeStart: undefined, timeEnd: undefined };
  const range = listTimeRange(params)!, groups = params.filters.group;
  const [report, groupRows] = await Promise.all([
    xntList(prisma, actor, { from: range.start, to: range.end, q: params.q, groups, page: 1, pageSize: Number.MAX_SAFE_INTEGER }),
    groups?.length ? prisma.productGroup.findMany({ where: { id: { in: groups.filter((g) => /^\d+$/.test(g)).map(Number) } }, select: { name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const groupNames = [...groupRows.map((g) => g.name), ...(groups?.includes(XNT_NO_GROUP) ? ["Chưa phân nhóm"] : [])];
  const from = formatDate(range.start), to = formatDate(new Date(range.end.getTime() - 1));
  return <article className={styles.root}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">Báo cáo xuất nhập tồn</h1>
        <p className="text-sm text-fg-secondary">Từ {from} đến {to} · Nhóm: {groupNames.length ? groupNames.join(", ") : "Tất cả"}{params.q && <> · Tìm: “{params.q}”</>}</p>
        <p className="text-xs text-fg-secondary">{report.total} sản phẩm · In lúc {formatDateTime(new Date())}</p>
        <p className="text-xs text-fg-secondary print:hidden">Bản in chỉ gồm các cột đang hiển thị ở bảng báo cáo (biểu tượng chọn cột góc phải bảng).</p>
      </div>
      <OrderPrintButton />
    </div>
    <XntPrintTable rows={report.rows} totals={report.totals} />
    {!report.total && <p className="p-4 text-fg-secondary">Không có sản phẩm phù hợp.</p>}
  </article>;
}
