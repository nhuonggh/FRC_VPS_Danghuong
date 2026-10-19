export const LOCAL_PRINT_TYPES = ["SALE_INVOICE", "DELIVERY_NOTE", "PURCHASE_RECEIPT"] as const;
export const hasLocalPrint = (type: string) => LOCAL_PRINT_TYPES.some((t) => t === type);
export const localPrintHref = (type: string, id: number) => `/api/print/${type}/${id}/html?auto=1`;
