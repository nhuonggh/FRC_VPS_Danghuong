import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");
const money = z.number({ invalid_type_error: "Nhập số tiền." }).finite().gt(0, "Số tiền phải lớn hơn 0.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân.");
const id = (msg: string) => z.number({ invalid_type_error: msg }).int().positive(msg);
const note = z.string().trim().max(300, "Ghi chú tối đa 300 ký tự.");
const reason = z.string().trim().min(1, "Nhập lý do.").max(300, "Lý do tối đa 300 ký tự.");

export const RECEIPT_TYPES = ["THU_NO", "BO_SUNG_QUY", "KHAC"] as const;
export const PAYMENT_KINDS = ["TRA_NCC", "HOAN_KHACH", "NOP_LAI_QUY", "KHAC"] as const;
export const RECEIPT_TYPE_LABEL: Record<string, string> = { THU_NO: "Thu nợ", COC: "Tiền cọc", BO_SUNG_QUY: "Bổ sung quỹ", KHAC: "Thu khác" };
export const PAYMENT_KIND_LABEL: Record<string, string> = { TRA_NCC: "Trả nhà cung cấp", HOAN_KHACH: "Hoàn tiền khách", CHI_PHI: "Chi phí hoạt động", TAT_TOAN_CK: "Tất toán chiết khấu", NOP_LAI_QUY: "Nộp lại quỹ (giám đốc nhận)", KHAC: "Chi khác" };

/** Phiếu thu (56, 57): THU_NO cần khách (tuỳ chọn gắn đơn); KHAC không gắn đơn, đối tác tuỳ chọn. */
export const receiptSchema = z.object({
  type: z.enum(RECEIPT_TYPES, { errorMap: () => ({ message: "Chọn loại phiếu thu." }) }),
  partnerId: id("Chọn đối tác.").nullable(),
  orderId: id("Đơn không hợp lệ.").nullable(),
  cashAccountId: id("Chọn quỹ/tài khoản."),
  amount: money,
  date: ymd,
  note,
}).superRefine((v, ctx) => {
  if (v.type === "THU_NO" && v.partnerId === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnerId"], message: "Chọn khách hàng." });
  if ((v.type === "KHAC" || v.type === "BO_SUNG_QUY") && v.orderId !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orderId"], message: "Phiếu thu này không gắn đơn." });
  if (v.type === "BO_SUNG_QUY" && v.partnerId !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnerId"], message: "Bổ sung quỹ không gắn đối tác." });
  if (v.orderId !== null && v.partnerId === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnerId"], message: "Chọn khách của đơn." });
});

/** Phiếu chi (58, 59). CHI_PHI và TAT_TOAN_CK do chi phí hoạt động / tất toán chiết khấu tạo, không qua form này. */
export const paymentSchema = z.object({
  advancedById: id("Người ứng tiền không hợp lệ.").nullable().optional(),
  kind: z.enum(PAYMENT_KINDS, { errorMap: () => ({ message: "Chọn loại phiếu chi." }) }),
  partnerId: id("Chọn đối tác.").nullable(),
  cashAccountId: id("Chọn quỹ/tài khoản."),
  amount: money,
  date: ymd,
  note,
}).superRefine((v, ctx) => {
  const needs = v.kind === "TRA_NCC" || v.kind === "HOAN_KHACH";
  if (needs && v.partnerId === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnerId"], message: v.kind === "TRA_NCC" ? "Chọn nhà cung cấp." : "Chọn khách hàng." });
  if (!needs && v.partnerId !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnerId"], message: "Chi khác không gắn đối tác." });
});

export const reasonSchema = z.object({ reason });

export const adjustmentRequestSchema = z.object({
  kind: z.enum(["AMOUNT", "VOID"]),
  reason,
  newAmount: money.nullable().default(null),
  newCashAccountId: id("Chọn quỹ/tài khoản.").nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.kind === "AMOUNT" && v.newAmount === null && v.newCashAccountId === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newAmount"], message: "Nhập số tiền hoặc quỹ mới." });
  if (v.kind === "VOID" && (v.newAmount !== null || v.newCashAccountId !== null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Hủy phiếu không kèm số mới." });
});

export const decideAdjustmentSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300) }).superRefine((v, ctx) => {
  if (!v.approve && !v.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "Nhập lý do từ chối." });
});

export const cashCloseSchema = z.object({
  cashAccountId: id("Chọn quỹ/tài khoản."),
  closeAt: z.string().datetime({ offset: true, message: "Mốc chốt không hợp lệ." }),
  actual: z.number({ invalid_type_error: "Nhập số tiền kiểm đếm." }).finite().min(0, "Số tiền không được âm.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân."),
  reason: z.string().trim().max(300).default(""),
  /** Giám đốc nhận lại toàn bộ tiền kiểm đếm: tự lập phiếu chi "Nộp lại quỹ" = số kiểm đếm, ghi vào ngày của mốc chốt. */
  handOver: z.boolean().default(false),
});

export type ReceiptInput = z.infer<typeof receiptSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type AdjustmentRequestInput = z.infer<typeof adjustmentRequestSchema>;
export type CashCloseInput = z.infer<typeof cashCloseSchema>;
export type VoucherDoc = "RECEIPT" | "PAYMENT";
