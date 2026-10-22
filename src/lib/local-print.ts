/** Mọi loại phiếu đều in trực tiếp bằng HTML (không còn Google Apps Script). */
export const LOCAL_PRINT_TYPES = ["SALE_INVOICE", "QUOTE", "DELIVERY_NOTE", "RECEIPT", "PAYMENT", "PRODUCTION_ORDER", "DEBT_STATEMENT", "PURCHASE_RECEIPT", "STOCKTAKE", "GOODS_RETURN", "TRIP_SHEET", "LOSS_ADJUST", "DISCOUNT_SETTLEMENT", "SUPPLIER_ORDER"] as const;
export const hasLocalPrint = (type: string) => LOCAL_PRINT_TYPES.some((t) => t === type);
export const localPrintHref = (type: string, id: number) => `/api/print/${type}/${id}/html?auto=1`;
