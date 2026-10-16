import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.");
const money = z.number({ invalid_type_error: "Nhập số tiền." }).finite().gt(0, "Số tiền phải lớn hơn 0.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân.");

/**
 * Tất toán chiết khấu tích lũy (D-37): CASH = chi tiền (cần quỹ), OFFSET = trừ vào công nợ,
 * FORFEIT = chuyển vào lãi công ty (không quỹ, không công nợ). `forfeitAmount` (chỉ kèm CASH/OFFSET) = chuyển luôn
 * phần còn lại này vào lãi công ty trong CÙNG giao dịch (vd chiết khấu 80k: chi 70k + chuyển lãi 10k).
 */
export const settleSchema = z.object({
  partnerId: z.number({ invalid_type_error: "Chọn khách hàng." }).int().positive("Chọn khách hàng."),
  method: z.enum(["CASH", "OFFSET", "FORFEIT"], { errorMap: () => ({ message: "Chọn hình thức tất toán." }) }),
  amount: money,
  cashAccountId: z.number().int().positive().nullable(),
  forfeitAmount: money.optional(),
  date: ymd,
  note: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự."),
}).superRefine((v, ctx) => {
  if (v.method === "CASH" && v.cashAccountId === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cashAccountId"], message: "Chọn quỹ/tài khoản chi tiền." });
  if (v.method !== "CASH" && v.cashAccountId !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cashAccountId"], message: "Hình thức này không dùng quỹ." });
  if (v.method === "FORFEIT" && v.forfeitAmount !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["forfeitAmount"], message: "Chuyển vào lãi đã là hình thức đang chọn." });
});
export const cancelSettlementSchema = z.object({ reason: z.string().trim().min(1, "Nhập lý do hủy.").max(300, "Lý do tối đa 300 ký tự.") });
export type SettleInput = z.infer<typeof settleSchema>;
export const SETTLE_METHOD_LABEL = { CASH: "Chi tiền", OFFSET: "Trừ vào công nợ", FORFEIT: "Chuyển vào lãi công ty" } as const;
