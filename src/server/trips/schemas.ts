import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");
const id = (msg: string) => z.number({ invalid_type_error: msg }).int().positive(msg);
const money0 = z.number({ invalid_type_error: "Nhập số tiền." }).finite().min(0, "Số tiền không được âm.").max(99_999_999_999).refine((v) => Number(v.toFixed(2)) === v, "Tối đa 2 chữ số thập phân.");

export const RESULT_KINDS = ["GIAO_DU", "GHI_NO", "HEN_TRA", "KHONG_GIAO", "GIAO_MOT_PHAN"] as const;
export const RESULT_LABEL: Record<(typeof RESULT_KINDS)[number], string> = { GIAO_DU: "Giao đủ", GHI_NO: "Giao đủ, ghi nợ", HEN_TRA: "Giao, hẹn trả", KHONG_GIAO: "Không giao được", GIAO_MOT_PHAN: "Giao một phần" };
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
  transferAmount: money0.default(0),
  debtAmount: money0.default(0),
  /** Tiền bớt cho khách (khách đưa ít hơn phải thu một chút). Bắt buộc ghi lý do. */
  discountAmount: money0.default(0),
  promiseDate: ymd.nullable().default(null),
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
  if (v.result === "HEN_TRA") {
    if (!v.promiseDate) bad("promiseDate", "Nhập ngày khách hẹn trả.");
    if (!(v.debtAmount > 0)) bad("debtAmount", "Nhập số tiền khách hẹn trả.");
  } else if (v.promiseDate) bad("promiseDate", "Chỉ nhập ngày hẹn khi chọn “Giao, hẹn trả”.");
});

export const settleTripSchema = z.object({ reason: z.string().trim().max(300, "Lý do tối đa 300 ký tự.").default("") });
export const confirmTripSchema = z.object({ cashAccountId: id("Chọn quỹ tiền mặt.").nullable(), transferAccountId: id("Chọn tài khoản ngân hàng.").nullable() });
export const cancelTripSchema = z.object({ reason: z.string().trim().min(1, "Nhập lý do hủy chuyến.").max(300, "Lý do tối đa 300 ký tự.") });
export const handleStopSchema = z.object({ note: z.string().trim().min(1, "Nhập cách xử lý.").max(300, "Tối đa 300 ký tự.") });

export type TripInput = z.infer<typeof tripSchema>;
export type TripResultInput = z.infer<typeof tripResultSchema>;
export type ConfirmTripInput = z.infer<typeof confirmTripSchema>;
