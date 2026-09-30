import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");
const decimals = (n: number) => (v: number) => Number(v.toFixed(n)) === v;

export const quoteLineSchema = z.object({
  productId: z.number({ invalid_type_error: "Chọn sản phẩm." }).int().positive("Chọn sản phẩm."),
  unit: z.string().trim().min(1, "Chọn đơn vị.").max(10),
  qty: z.number({ invalid_type_error: "Nhập số lượng." }).finite().gt(0, "Số lượng phải lớn hơn 0.").max(999_999_999).refine(decimals(3), "Tối đa 3 chữ số thập phân."),
  salePrice: z.number({ invalid_type_error: "Nhập đơn giá." }).finite().min(0, "Đơn giá không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân."),
  note: z.string().trim().max(200),
});

export const quoteSchema = z.object({
  partnerId: z.number({ invalid_type_error: "Chọn khách hàng." }).int().positive("Chọn khách hàng."),
  date: ymd,
  note: z.string().trim().max(500),
  lines: z.array(quoteLineSchema).min(1, "Nhập ít nhất một dòng hàng.").max(200, "Tối đa 200 dòng."),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const quoteStatusSchema = z.object({ status: z.enum(["SENT", "CANCELLED"]) });
