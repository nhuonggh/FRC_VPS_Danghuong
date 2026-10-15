import { z } from "zod";

export const SALE_MAX_LINES = 200;
export const SALE_PAYMENT_METHODS = ["NONE", "CASH", "TRANSFER", "COD"] as const;
export const SALE_PAYMENT_LABELS: Record<(typeof SALE_PAYMENT_METHODS)[number], string> = { NONE: "Không", CASH: "Tiền mặt", TRANSFER: "Chuyển khoản", COD: "Thu hộ khi giao (COD)" };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");

const decimals = (n: number) => (v: number) => Number(v.toFixed(n)) === v;

export const saleLineSchema = z
  .object({
    /** Chỉ dùng khi SỬA đơn: id dòng hiện có (giữ vị trí `seq` trong chuỗi FIFO). Dòng không có id = dòng mới. */
    id: z.number().int().positive().optional(),
    productId: z.number({ invalid_type_error: "Chọn sản phẩm." }).int().positive("Chọn sản phẩm."),
    unit: z.string().trim().min(1, "Chọn đơn vị.").max(10),
    qty: z.number({ invalid_type_error: "Nhập số lượng." }).finite().gt(0, "Số lượng phải lớn hơn 0.").max(999_999_999).refine(decimals(3), "Tối đa 3 chữ số thập phân."),
    salePrice: z.number({ invalid_type_error: "Nhập đơn giá." }).finite().min(0, "Đơn giá không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân."),
    /** Chiết khấu trừ ngay — số tiền của CẢ dòng, giảm tiền phải thu. */
    discountNow: z.number().finite().min(0, "Chiết khấu không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân."),
    /** Chiết khấu tích lũy trả sau — số tiền của CẢ dòng, không giảm tiền phải thu. */
    discountAccum: z.number().finite().min(0, "Chiết khấu không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân."),
    /** Có → bán hàng gia công: xuất NVL theo BOM hiệu lực tại ngày đơn thay vì xuất chính mã này. */
    processingTypeId: z.number().int().positive().nullable(),
    /** Ghi chú theo dòng hàng. */
    note: z.string().trim().max(200, "Ghi chú dòng tối đa 200 ký tự.").optional(),
  })
  .superRefine((l, ctx) => {
    if (l.discountNow + l.discountAccum > Math.round(l.qty * l.salePrice * 100) / 100 + 1e-9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountNow"], message: "Tổng chiết khấu vượt giá trị dòng." });
    }
  });

export const saleOrderSchema = z
  .object({
    partnerId: z.number({ invalid_type_error: "Chọn khách hàng." }).int().positive("Chọn khách hàng."),
    date: ymd,
    expectedDeliveryDate: ymd,
    note: z.string().trim().max(500),
    /** Người bán: bỏ trống khi tạo = người lập; khi sửa bỏ trống = giữ nguyên; null = xoá. */
    salesUserId: z.number().int().positive().nullable().optional(),
    /** Kho xuất ghi trên đơn (thông tin). null = không ghi kho; bỏ trống khi sửa = giữ nguyên. */
    warehouseId: z.number().int().positive().nullable().optional(),
    /** Hình thức thanh toán dự kiến — không sinh phiếu thu. Bỏ trống = không đổi (đơn mới: NONE). */
    paymentMethod: z.enum(SALE_PAYMENT_METHODS).optional(),
    /** Phí vận chuyển thu của khách (cộng vào tiền phải thu). Bỏ trống: đơn mới = 0, sửa đơn = giữ nguyên. */
    shippingFee: z.number().finite().min(0, "Phí vận chuyển không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân.").optional(),
    /** Chiết khấu cả đơn: phân bổ theo tỷ lệ vào chiết khấu trừ ngay của các dòng. Bỏ trống: đơn mới = 0, sửa đơn = giữ nguyên. */
    orderDiscount: z.number().finite().min(0, "Chiết khấu không được âm.").max(9_999_999_999).refine(decimals(2), "Tối đa 2 chữ số thập phân.").optional(),
    lines: z.array(saleLineSchema).min(1, "Nhập ít nhất một dòng hàng.").max(SALE_MAX_LINES, `Tối đa ${SALE_MAX_LINES} dòng.`),
  })
  .superRefine((o, ctx) => {
    if (o.expectedDeliveryDate < o.date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedDeliveryDate"], message: "Ngày giao dự kiến không được trước ngày đơn." });
    }
  });

export type SaleLineInput = z.infer<typeof saleLineSchema>;
export type SaleOrderInput = z.infer<typeof saleOrderSchema>;

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(1, "Nhập lý do hủy.").max(300, "Lý do tối đa 300 ký tự.") });
