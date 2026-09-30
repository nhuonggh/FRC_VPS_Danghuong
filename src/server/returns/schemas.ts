import { z } from "zod";

export const RETURN_MAX_LINES = 200;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");
const decimals = (n: number) => (v: number) => Number(v.toFixed(n)) === v;
const qty = z.number({ invalid_type_error: "Nhập số lượng." }).finite().gt(0, "Số lượng phải lớn hơn 0.").max(999_999_999).refine(decimals(3), "Tối đa 3 chữ số thập phân.");

/** Trả theo đơn (43): chỉ chọn dòng + SL; đơn vị, giá vốn, giá trừ công nợ lấy từ dòng bán gốc. */
export const returnByOrderSchema = z.object({
  orderId: z.number({ invalid_type_error: "Chọn đơn hàng." }).int().positive("Chọn đơn hàng."),
  date: ymd,
  note: z.string().trim().max(500),
  lines: z.array(z.object({ orderLineId: z.number().int().positive(), qty })).min(1, "Nhập số lượng trả cho ít nhất một dòng.").max(RETURN_MAX_LINES),
});

/** Trả theo sản phẩm (45) và trả NCC (47): đối tác + dòng hàng có đơn giá (giá trừ công nợ / giá thỏa thuận). */
export const returnByProductSchema = z.object({
  partnerId: z.number({ invalid_type_error: "Chọn đối tác." }).int().positive("Chọn đối tác."),
  date: ymd,
  note: z.string().trim().max(500),
  lines: z.array(z.object({
    productId: z.number({ invalid_type_error: "Chọn sản phẩm." }).int().positive("Chọn sản phẩm."),
    unit: z.string().trim().min(1, "Chọn đơn vị.").max(10),
    qty,
    unitPrice: z.number({ invalid_type_error: "Nhập đơn giá." }).finite().min(0, "Đơn giá không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân."),
  })).min(1, "Nhập ít nhất một dòng hàng.").max(RETURN_MAX_LINES, `Tối đa ${RETURN_MAX_LINES} dòng.`),
});

export const cancelReturnSchema = z.object({ reason: z.string().trim().min(1, "Nhập lý do hủy.").max(300, "Lý do tối đa 300 ký tự.") });

export type ReturnByOrderInput = z.infer<typeof returnByOrderSchema>;
export type ReturnByProductInput = z.infer<typeof returnByProductSchema>;
