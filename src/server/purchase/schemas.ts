import { z } from "zod";

const num = (message: string) => z.number({ required_error: message, invalid_type_error: message });

export const purchaseLineSchema = z.object({
  /** Present on edit so the existing FIFO position is preserved. */
  id: z.number().int().positive().optional(),
  productId: num("Chọn sản phẩm.").int("Chọn sản phẩm.").positive("Chọn sản phẩm."),
  qty: num("Nhập số lượng.").gt(0, "Số lượng phải lớn hơn 0.").max(999_999_999, "Số lượng quá lớn."),
  unit: z.string({ required_error: "Chọn đơn vị." }).trim().min(1, "Chọn đơn vị.").max(10, "Đơn vị tối đa 10 ký tự."),
  factor: num("Nhập hệ số.").gt(0, "Hệ số phải lớn hơn 0.").max(1_000_000, "Hệ số quá lớn."),
  purchasePrice: num("Nhập đơn giá.").min(0, "Đơn giá không được âm.").max(9_999_999_999, "Đơn giá quá lớn."),
  rollInfo: z.string().trim().max(200, "Ghi chú cuộn tối đa 200 ký tự."),
});

export const purchaseInputSchema = z.object({
  partnerId: num("Chọn nhà cung cấp.").int("Chọn nhà cung cấp.").positive("Chọn nhà cung cấp."),
  date: z.string({ required_error: "Chọn ngày." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."),
  freightCost: num("Nhập cước.").min(0, "Cước không được âm.").max(9_999_999_999, "Cước quá lớn."),
  note: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự."),
  lines: z.array(purchaseLineSchema).min(1, "Thêm ít nhất 1 dòng hàng.").max(200, "Tối đa 200 dòng."),
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export const cancelPurchaseSchema = z.object({
  reason: z.string({ required_error: "Nhập lý do hủy." }).trim().min(1, "Nhập lý do hủy.").max(300, "Lý do tối đa 300 ký tự."),
});

export const freightSchema = purchaseInputSchema.pick({ freightCost: true });
