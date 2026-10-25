/** Mọi loại phiếu đều in trực tiếp bằng HTML (không còn Google Apps Script). */
export const LOCAL_PRINT_TYPES = ["SALE_INVOICE", "QUOTE", "DELIVERY_NOTE", "RECEIPT", "PAYMENT", "PRODUCTION_ORDER", "DEBT_STATEMENT", "PURCHASE_RECEIPT", "STOCKTAKE", "GOODS_RETURN", "TRIP_SHEET", "TRIP_CASH", "LOSS_ADJUST", "DISCOUNT_SETTLEMENT", "SUPPLIER_ORDER"] as const;
export const hasLocalPrint = (type: string) => LOCAL_PRINT_TYPES.some((t) => t === type);
/** Mọi phiếu mở màn xem trước để chọn tiêu chí (màu/đen trắng, khổ giấy, nợ cũ...); bấm nút In trên màn đó mới hiện hộp thoại in. */
export const localPrintHref = (type: string, id: number, extra = "") => `/api/print/${type}/${id}/html${extra ? `?${extra}` : ""}`;
