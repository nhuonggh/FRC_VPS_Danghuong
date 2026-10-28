import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { listTimeRange, parseTimedListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { CASHBOOK_FILTER_KEYS, listCashBook } from "@/server/cash/queries";
import { OrderPrintButton } from "@/components/sales/OrderPrintButton";
import styles from "./print.module.css";

export const dynamic = "force-dynamic";
/** In sổ quỹ theo ngày (lưu PDF qua hộp thoại in): Ngày, Chứng từ, Nội dung, Người nhận/nộp, Thu, Chi, Số dư; có số dư đầu/cuối kỳ. */
export default async function CashbookPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("cashbook.view");
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const type = first(sp.type) === "BANK" ? "BANK" : "CASH";
  const raw = first(sp.account);
  const account = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const params = parseTimedListParams(sp, CASHBOOK_FILTER_KEYS);
  const book = await listCashBook(prisma, actor, type, account, { ...params, page: 1, pageSize: 100_000 } as never);
  const range = listTimeRange(params);
  const entries = [...book.entries].reverse();
  const opening = book.rangeOpening ?? book.selected?.opening ?? "0";
  const totalIn = entries.reduce((s, e) => s.plus(e.amountIn), new Prisma.Decimal(0));
  const totalOut = entries.reduce((s, e) => s.plus(e.amountOut), new Prisma.Decimal(0));
  const closing = entries.at(-1)?.running ?? opening;
  const title = type === "CASH" ? "SỔ QUỸ TIỀN MẶT" : "SỔ TIỀN GỬI NGÂN HÀNG";
  const period = range ? `Từ ${formatDate(range.start)} đến ${formatDate(new Date(range.end.getTime() - 1))}` : "Toàn bộ";
  return <article className={styles.root}>
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="w-full text-center">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm">{book.selected?.name ?? ""} · {period}</p>
      </div>
      <OrderPrintButton label="In / Lưu PDF" />
    </div>
    <table className={styles.table}>
      <thead>
        <tr><th>Ngày</th><th>Chứng từ</th><th>Nội dung thu/chi</th><th>Người nhận/nộp</th><th className={styles.num}>Thu</th><th className={styles.num}>Chi</th><th className={styles.num}>Số dư</th></tr>
      </thead>
      <tbody>
        <tr className={styles.sum}><td colSpan={6}>Số dư đầu kỳ</td><td className={styles.num}>{formatCurrency(opening)}</td></tr>
        {entries.map((e) => <tr key={e.id}>
          <td>{formatDate(e.at)}</td><td>{e.docCode ?? e.docLabel}</td><td>{e.content ?? ""}</td><td>{e.counterparty ?? ""}</td>
          <td className={styles.num}>{Number(e.amountIn) ? formatCurrency(e.amountIn) : ""}</td>
          <td className={styles.num}>{Number(e.amountOut) ? formatCurrency(e.amountOut) : ""}</td>
          <td className={styles.num}>{formatCurrency(e.running)}</td>
        </tr>)}
        <tr className={styles.sum}><td colSpan={4}>Cộng phát sinh</td><td className={styles.num}>{formatCurrency(totalIn.toString())}</td><td className={styles.num}>{formatCurrency(totalOut.toString())}</td><td /></tr>
        <tr className={styles.sum}><td colSpan={6}>Số dư cuối kỳ</td><td className={styles.num}>{formatCurrency(closing)}</td></tr>
      </tbody>
    </table>
    {!entries.length && <p className="p-4 text-center">Không có phát sinh trong kỳ.</p>}
    <div className={styles.sign}>
      <div><strong>Thủ quỹ</strong><span>(Ký, ghi rõ họ tên)</span></div>
      <div><strong>Kế toán</strong><span>(Ký, ghi rõ họ tên)</span></div>
    </div>
    <p className="mt-4 text-xs">In lúc {formatDateTime(new Date())}</p>
  </article>;
}
