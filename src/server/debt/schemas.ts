import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");
const money = z.number({ invalid_type_error: "Nhập số tiền." }).finite().gt(0, "Số tiền phải lớn hơn 0.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân.");
const partnerId = (msg: string) => z.number({ invalid_type_error: msg }).int().positive(msg);

export const DEBT_REASONS = ["HANG_LOI", "BEP_MOP", "CHIET_KHAU", "KHAC"] as const;
export const REASON_LABEL: Record<(typeof DEBT_REASONS)[number], string> = { HANG_LOI: "Hàng lỗi", BEP_MOP: "Hàng bẹp, móp", CHIET_KHAU: "Trừ bằng chiết khấu tích lũy", KHAC: "Khác" };

/** Điều chỉnh công nợ (64): DECREASE = giảm số dư đối tác (credit), INCREASE = tăng (debit). Ghi chú bắt buộc (dấu vết). */
export const debtAdjustmentSchema = z.object({
  partnerId: partnerId("Chọn đối tác."),
  reason: z.enum(DEBT_REASONS, { errorMap: () => ({ message: "Chọn lý do." }) }),
  direction: z.enum(["DECREASE", "INCREASE"]),
  amount: money,
  date: ymd,
  note: z.string().trim().min(1, "Nhập ghi chú.").max(300, "Ghi chú tối đa 300 ký tự."),
  /** Chỉ cho lý do CHIET_KHAU: phần chiết khấu còn dư sau khi trừ — giữ lại quỹ (mặc định) hoặc chuyển vào lãi công ty. */
  discountRemainder: z.enum(["KEEP", "FORFEIT"]).optional(),
}).superRefine((v, ctx) => {
  if (v.reason === "CHIET_KHAU" && v.direction !== "DECREASE") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direction"], message: "Trừ bằng chiết khấu chỉ để giảm nợ." });
  if (v.reason !== "CHIET_KHAU" && v.discountRemainder !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountRemainder"], message: "Chỉ áp dụng khi trừ bằng chiết khấu tích lũy." });
});

/** Chuyển (65): TRANSFER chuyển một phần số dư từ đối tác này sang đối tác kia; MERGE chuyển toàn bộ rồi gộp mã. */
export const debtTransferSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TRANSFER"), fromPartnerId: partnerId("Chọn bên chuyển."), toPartnerId: partnerId("Chọn bên nhận."), amount: money, date: ymd, note: z.string().trim().max(300) }),
  z.object({ kind: z.literal("MERGE"), fromPartnerId: partnerId("Chọn mã cần gộp."), toPartnerId: partnerId("Chọn mã giữ lại."), date: ymd, note: z.string().trim().max(300) }),
]).superRefine((v, ctx) => {
  if (v.fromPartnerId === v.toPartnerId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toPartnerId"], message: "Hai đối tác phải khác nhau." });
});

export const cancelDebtSchema = z.object({ reason: z.string().trim().min(1, "Nhập lý do hủy.").max(300, "Lý do tối đa 300 ký tự.") });

export type DebtAdjustmentInput = z.infer<typeof debtAdjustmentSchema>;
export type DebtTransferInput = z.infer<typeof debtTransferSchema>;
