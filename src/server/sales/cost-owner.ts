import { unitCostOf, type CostOwner } from "@/server/inventory";

/**
 * Chủ dòng của `SALE` (D-23, engine-fifo §2): engine gọi hàm này cho MỌI dòng bán mà lần tính lại chạm tới, trong cùng
 * transaction. Chỉ engine được ghi `unitCostFifo` / `isProvisional` — module bán hàng KHÔNG ghi tay hai cột này.
 *
 * `unitCostFifo` là giá vốn trên MỘT ĐƠN VỊ GỐC (không phải đơn vị của dòng) = tổng vốn mọi mã bị xuất cho dòng
 * (một mã thường, hoặc từng NVL của tôn xốp) / `qtyBase` của dòng. Giữ hàm này rẻ: 1 select + 1 update.
 */
export const saleLineCostOwner: CostOwner = async (tx, snap) => {
  const line = await tx.saleOrderLine.findUnique({ where: { id: snap.docLineId }, select: { qtyBase: true } });
  if (!line) return; // dòng đã bị gỡ trong cùng giao dịch (sửa/hủy) — không còn gì để cập nhật
  await tx.saleOrderLine.update({
    where: { id: snap.docLineId },
    data: { unitCostFifo: unitCostOf(snap.totalCost, line.qtyBase), isProvisional: snap.qtyProvisional.gt(0) },
  });
};
