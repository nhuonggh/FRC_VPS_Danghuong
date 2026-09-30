import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");

export const depositSchema = z.object({
  orderId: z.number({ invalid_type_error: "Chọn đơn hàng." }).int().positive("Chọn đơn hàng."),
  amount: z.number({ invalid_type_error: "Nhập số tiền." }).finite().gt(0, "Số tiền phải lớn hơn 0.").max(99_999_999_999).refine((n) => Number(n.toFixed(2)) === n, "Tối đa 2 chữ số thập phân."),
  cashAccountId: z.number({ invalid_type_error: "Chọn quỹ/tài khoản nhận tiền." }).int().positive("Chọn quỹ/tài khoản nhận tiền."),
  date: ymd,
  note: z.string().trim().max(300),
});
export type DepositInput = z.infer<typeof depositSchema>;
