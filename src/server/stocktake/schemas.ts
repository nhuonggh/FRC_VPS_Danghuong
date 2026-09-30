import { z } from "zod";

export const stocktakeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."),
  note: z.string().trim().max(500),
  lines: z.array(z.object({
    productId: z.number({ required_error: "Chọn sản phẩm.", invalid_type_error: "Chọn sản phẩm." }).int().positive("Chọn sản phẩm."),
    actualQty: z.number({ required_error: "Nhập tồn thực đếm.", invalid_type_error: "Tồn thực đếm không hợp lệ." }).min(0, "Tồn thực đếm không được âm.").max(1_000_000_000, "Số lượng quá lớn."),
  })).min(1, "Cần ít nhất một sản phẩm.").max(2000),
});
export type StocktakeInput = z.infer<typeof stocktakeSchema>;
export const cancelStocktakeSchema = z.object({ reason: z.string().trim().min(3, "Nhập lý do hủy.").max(500) });
