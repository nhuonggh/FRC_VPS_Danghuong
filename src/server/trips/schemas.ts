import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");
const id = (msg: string) => z.number({ invalid_type_error: msg }).int().positive(msg);
const money0 = z.number({ invalid_type_error: "Nhập số tiền." }).finite().min(0, "Số tiền không được âm.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân.");

/** Kết quả chọn được khi nhập. "Giao, hẹn trả" (HEN_TRA) đã bỏ — coi như ghi nợ; chỉ còn ở dữ liệu cũ (hiển thị, không nhập mới). */
export const RESULT_KINDS = ["GIAO_DU", "GHI_NO", "KHONG_GIAO", "GIAO_MOT_PHAN"] as const;
export const RESULT_LABEL: Record<(typeof RESULT_KINDS)[number] | "HEN_TRA", string> = { GIAO_DU: "Giao đủ", GHI_NO: "Giao đủ, ghi nợ", HEN_TRA: "Giao, ghi nợ (hẹn trả — cũ)", KHONG_GIAO: "Không giao được", GIAO_MOT_PHAN: "Giao một phần" };
export const TRIP_STATUS_LABEL = { PLANNED: "Đã xếp", ON_ROAD: "Đang đi", RETURNED: "Đã về (đủ kết quả)", SETTLED: "Đã đối soát", CONFIRMED: "Thủ quỹ đã nhận tiền", CANCELLED: "Đã hủy" } as const;

/** Xếp chuyến (38): ngày, tuyến, xe + lái + phụ, danh sách đơn theo thứ tự giao. */
export const tripSchema = z.object({
  date: ymd,
  routeId: id("Tuyến không hợp lệ.").nullable(),
  vehicleId: id("Chọn xe."),
  driverId: id("Chọn lái xe."),
  assistantId: id("Phụ xe không hợp lệ.").nullable(),
  note: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự."),
  orderIds: z.array(id("Đơn không hợp lệ.")).min(1, "Chọn ít nhất một đơn.").max(60, "Tối đa 60 đơn mỗi chuyến.").refine((a) => new Set(a).size === a.length, "Đơn bị chọn trùng."),
});

/** Kết quả giao một điểm (40). Tiền: mặt + chuyển khoản + ghi nợ; giao một phần nhập SL thực giao từng dòng. */
export const tripResultSchema = z.object({
  orderId: id("Chọn đơn."),
  result: z.enum(RESULT_KINDS, { errorMap: () => ({ message: "Chọn kết quả giao." }) }),
  lines: z.array(z.object({ orderLineId: id("Dòng không hợp lệ."), qty: z.number().finite().min(0, "SL không được âm.") })).max(200).default([]),
  cashAmount: money0.default(0),
  /** Quỹ / tài khoản NH nhận tiền của điểm giao (UI bắt buộc chọn khi có tiền; thiếu thì thủ quỹ chọn lúc xác nhận). */
  cashAccountId: id("Quỹ tiền mặt không hợp lệ.").nullable().default(null),
  transferAccountId: id("Tài khoản ngân hàng không hợp lệ.").nullable().default(null),
  transferAmount: money0.default(0),
  debtAmount: money0.default(0),
  /** Tiền bớt cho khách (khách đưa ít hơn phải thu một chút). Bắt buộc ghi lý do. */
  discountAmount: money0.default(0),
  note: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự.").default(""),
}).superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (v.result === "KHONG_GIAO") {
    if (v.cashAmount || v.transferAmount || v.debtAmount || v.discountAmount) bad("cashAmount", "Không giao được thì không có tiền.");
    if (!v.note) bad("note", "Nhập lý do không giao được.");
  }
  if (v.discountAmount > 0 && !v.note) bad("note", "Có tiền bớt — nhập lý do bớt.");
  if (v.result === "GIAO_MOT_PHAN" && !v.lines.some((l) => l.qty > 0)) bad("lines", "Nhập số lượng thực giao.");
  if (v.result === "GIAO_DU" && v.debtAmount > 0) bad("debtAmount", "Giao đủ thu đủ không ghi nợ — chọn “Giao đủ, ghi nợ”.");
  if (v.result === "GHI_NO" && !(v.debtAmount > 0)) bad("debtAmount", "Nhập số ghi nợ.");
});

/** Chi phí lái xe ứng từ tiền thu của chuyến (đổ dầu, mua giấy…): trừ vào quỹ tiền mặt đã chọn khi thủ quỹ xác nhận chuyến. */
export const tripExpenseSchema = z.object({
  expenseTypeId: id("Chọn loại chi phí."),
  cashAccountId: id("Chọn quỹ tiền mặt."),
  amount: z.number({ invalid_type_error: "Nhập số tiền." }).finite().gt(0, "Số tiền phải lớn hơn 0.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân."),
  note: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự.").default(""),
});
export const removeTripExpenseSchema = z.object({ expenseId: id("Chọn khoản chi phí.") });

export const settleTripSchema = z.object({ reason: z.string().trim().max(300, "Lý do tối đa 300 ký tự.").default(""), handedAmount: money0.nullable().default(null) });
/** Chỉ cần cho điểm giao chưa chọn tài khoản lúc nhập kết quả (dữ liệu cũ). */
export const confirmTripSchema = z.object({ cashAccountId: id("Chọn quỹ tiền mặt.").nullable().default(null), transferAccountId: id("Chọn tài khoản ngân hàng.").nullable().default(null) });
export const cancelTripSchema = z.object({ reason: z.string().trim().min(1, "Nhập lý do hủy chuyến.").max(300, "Lý do tối đa 300 ký tự.") });
export const handleStopSchema = z.object({ note: z.string().trim().min(1, "Nhập cách xử lý.").max(300, "Tối đa 300 ký tự.") });

export type TripInput = z.infer<typeof tripSchema>;
export type TripResultInput = z.infer<typeof tripResultSchema>;
export type TripExpenseInput = z.infer<typeof tripExpenseSchema>;
export type ConfirmTripInput = z.infer<typeof confirmTripSchema>;
