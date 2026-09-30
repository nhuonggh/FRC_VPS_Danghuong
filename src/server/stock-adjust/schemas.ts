import { z } from "zod";

export const lossAdjustSchema = z.object({
  type: z.enum(["LOSS", "WRITE_OFF"], { required_error: "Chọn loại điều chỉnh.", invalid_type_error: "Chọn loại điều chỉnh." }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."),
  note: z.string().trim().min(3, "Nhập lý do (bắt buộc).").max(500),
  lines: z.array(z.object({
    productId: z.number({ required_error: "Chọn sản phẩm.", invalid_type_error: "Chọn sản phẩm." }).int().positive("Chọn sản phẩm."),
    qty: z.number({ required_error: "Nhập số lượng.", invalid_type_error: "Số lượng không hợp lệ." }).positive("Số lượng phải lớn hơn 0.").max(1_000_000_000, "Số lượng quá lớn."),
  })).min(1, "Cần ít nhất một sản phẩm.").max(200),
});
export type LossAdjustInput = z.infer<typeof lossAdjustSchema>;
export const LOSS_TYPE_LABEL = { LOSS: "Hao hụt", WRITE_OFF: "Xuất hủy" } as const;
export const cancelLossSchema = z.object({ reason: z.string().trim().min(3, "Nhập lý do hủy.").max(500) });
