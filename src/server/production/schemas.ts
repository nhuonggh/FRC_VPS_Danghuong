import { z } from "zod";

const num = (label: string) => z.number({ required_error: `Nhập ${label.toLowerCase()}.`, invalid_type_error: `${label} không hợp lệ.` }).positive(`${label} phải lớn hơn 0.`).max(1_000_000_000, `${label} quá lớn.`);

export const productionOrderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."),
  productId: z.number({ required_error: "Chọn phụ kiện cần sản xuất.", invalid_type_error: "Chọn phụ kiện cần sản xuất." }).int().positive("Chọn phụ kiện cần sản xuất."),
  qty: num("Số lượng thành phẩm"),
  note: z.string().trim().max(500),
  materials: z.array(z.object({ productId: z.number({ required_error: "Chọn nguyên vật liệu.", invalid_type_error: "Chọn nguyên vật liệu." }).int().positive("Chọn nguyên vật liệu."), qty: num("Lượng NVL") })).min(1, "Cần ít nhất một nguyên vật liệu.").max(50),
});
export type ProductionOrderInput = z.infer<typeof productionOrderSchema>;

export const cancelProductionSchema = z.object({ reason: z.string().trim().min(3, "Nhập lý do hủy.").max(500) });
