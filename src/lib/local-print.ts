/** Mọi loại phiếu đều in trực tiếp bằng HTML (không còn Google Apps Script). */
export const LOCAL_PRINT_TYPES = ["SALE_INVOICE", "QUOTE", "DELIVERY_NOTE", "RECEIPT", "PAYMENT", "PRODUCTION_ORDER", "DEBT_STATEMENT", "PURCHASE_RECEIPT", "STOCKTAKE", "GOODS_RETURN", "TRIP_SHEET", "LOSS_ADJUST", "DISCOUNT_SETTLEMENT", "SUPPLIER_ORDER"] as const;
export const hasLocalPrint = (type: string) => LOCAL_PRINT_TYPES.some((t) => t === type);
/** Hóa đơn bán hàng mở màn xem trước (chọn in có/không nợ cũ, ẩn tổng số tấm); các phiếu khác mở hộp thoại in ngay. */
export const localPrintHref = (type: string, id: number, extra = "") => `/api/print/${type}/${id}/html${type === "SALE_INVOICE" ? (extra ? `?${extra}` : "") : `?auto=1${extra ? `&${extra}` : ""}`}`;
