import type { PrismaClient } from "@prisma/client";
import { formatCurrency } from "@/lib/format";
import { getOpenPeriod } from "./guard";

export type CloseSeverity = "BLOCK" | "WARN";

export interface CloseFinding {
  key: string;
  severity: CloseSeverity;
  title: string;
  count: number;
  items: { id: number; code: string; description: string; href: string }[];
}

export async function getCloseChecklist(db: PrismaClient) {
  const period = await getOpenPeriod(db);
  const [periodRow, provisionalCount, provisionalLines, tripCount, trips, stocktakeCount, stocktakes, draftCount, drafts, depositCount, deposits] = await Promise.all([
    db.period.findUniqueOrThrow({ where: { id: period.id }, select: { name: true } }),
    db.saleOrderLine.count({ where: { isProvisional: true, order: { periodId: period.id, isCancelled: false, isDraft: false } } }),
    db.saleOrderLine.findMany({
      where: { isProvisional: true, order: { periodId: period.id, isCancelled: false, isDraft: false } },
      orderBy: [{ order: { orderDate: "asc" } }, { id: "asc" }], take: 20,
      select: { id: true, qty: true, unit: true, product: { select: { code: true, name: true } }, order: { select: { id: true, code: true, partner: { select: { name: true } } } } },
    }),
    db.trip.count({ where: { periodId: period.id, status: { notIn: ["CONFIRMED", "CANCELLED"] } } }),
    db.trip.findMany({
      where: { periodId: period.id, status: { notIn: ["CONFIRMED", "CANCELLED"] } },
      orderBy: [{ tripDate: "asc" }, { id: "asc" }], take: 20,
      select: { id: true, code: true, status: true, tripDate: true },
    }),
    db.stocktake.count({ where: { periodId: period.id, status: "DRAFT" } }),
    db.stocktake.findMany({
      where: { periodId: period.id, status: "DRAFT" }, orderBy: [{ at: "asc" }, { id: "asc" }], take: 20,
      select: { id: true, code: true, at: true },
    }),
    db.saleOrder.count({ where: { periodId: period.id, isDraft: true, isCancelled: false } }),
    db.saleOrder.findMany({
      where: { periodId: period.id, isDraft: true, isCancelled: false }, orderBy: [{ orderDate: "asc" }, { id: "asc" }], take: 20,
      select: { id: true, code: true, partner: { select: { name: true } } },
    }),
    db.receipt.count({ where: { periodId: period.id, type: "COC", isCancelled: false, order: { isDraft: true, isCancelled: false } } }),
    db.receipt.findMany({
      where: { periodId: period.id, type: "COC", isCancelled: false, order: { isDraft: true, isCancelled: false } },
      orderBy: [{ at: "asc" }, { id: "asc" }], take: 20,
      select: { id: true, code: true, amount: true, order: { select: { id: true, code: true } } },
    }),
  ]);

  const settlements = await db.discountSettlement.findMany({
    where: { periodId: period.id, isCancelled: false }, orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { id: true, code: true, partnerId: true, partner: { select: { name: true } } },
  });
  const settlementIds = settlements.map((row) => row.id);
  const unreviewed = settlementIds.length
    ? await db.discountLedger.findMany({
        where: { periodId: period.id, docType: "DISCOUNT_SETTLE", docId: { in: settlementIds }, isReconciled: false },
        select: { docId: true },
      })
    : [];
  const unreviewedIds = new Set(unreviewed.map((row) => row.docId));
  const unsettled = settlements.filter((row) => unreviewedIds.has(row.id));

  const blockers: CloseFinding[] = [
    {
      key: "provisional-sales", severity: "BLOCK", title: "Đơn bán còn thiếu tồn", count: provisionalCount,
      items: provisionalLines.map((line) => ({
        id: line.order.id, code: line.order.code, description: `${line.product.code} · ${line.product.name} · thiếu giá vốn cho ${line.qty.toString()} ${line.unit}`,
        href: `/sales/orders/${line.order.id}`,
      })),
    },
    {
      key: "open-trips", severity: "BLOCK", title: "Chuyến chưa xác nhận hoàn tất", count: tripCount,
      items: trips.map((trip) => ({ id: trip.id, code: trip.code, description: `Trạng thái ${trip.status} · ${trip.tripDate.toLocaleDateString("vi-VN")}`, href: `/delivery/trips/${trip.id}` })),
    },
    {
      key: "draft-stocktakes", severity: "BLOCK", title: "Phiếu kiểm kho còn nháp", count: stocktakeCount,
      items: stocktakes.map((stocktake) => ({ id: stocktake.id, code: stocktake.code, description: `Ngày ${stocktake.at.toLocaleDateString("vi-VN")}`, href: `/inventory/stocktakes/${stocktake.id}` })),
    },
  ];
  const warnings: CloseFinding[] = [
    {
      key: "draft-orders", severity: "WARN", title: "Đơn nháp sẽ cần mang sang kỳ mới", count: draftCount,
      items: drafts.map((order) => ({ id: order.id, code: order.code, description: order.partner.name, href: `/sales/orders/${order.id}` })),
    },
    {
      key: "unused-deposits", severity: "WARN", title: "Tiền cọc còn gắn đơn nháp", count: depositCount,
      items: deposits.map((receipt) => ({ id: receipt.id, code: receipt.code, description: `${receipt.order!.code} · ${formatCurrency(receipt.amount)}`, href: `/accounting/receipts/${receipt.id}` })),
    },
    {
      key: "unreconciled-discounts", severity: "WARN", title: "Tất toán chiết khấu chưa hậu kiểm", count: unsettled.length,
      items: unsettled.slice(0, 20).map((row) => ({ id: row.id, code: row.code, description: row.partner.name, href: `/accounting/discounts/${row.partnerId}` })),
    },
  ];

  return {
    period: { ...period, name: periodRow.name },
    blockers,
    warnings,
    blockerCount: blockers.reduce((total, item) => total + item.count, 0),
    warningCount: warnings.reduce((total, item) => total + item.count, 0),
  };
}