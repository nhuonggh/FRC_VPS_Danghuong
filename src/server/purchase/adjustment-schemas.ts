import { z } from "zod";
export const adjustmentInSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."), note: z.string().trim().max(500), lines: z.array(z.object({ productId: z.number().int().positive("Chọn sản phẩm."), qty: z.number().gt(0, "Số lượng phải lớn hơn 0."), unitCost: z.number().min(0).nullable() })).min(1, "Thêm ít nhất 1 dòng hàng.").max(200) });
export type AdjustmentInInput = z.infer<typeof adjustmentInSchema>;
