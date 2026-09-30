// Nhãn/kiểu thuần (không kéo prisma vào client bundle) — server/stocktake/queries.ts import lại từ đây.
export const STOCKTAKE_LABEL = { DRAFT: "Nháp", DONE: "Đã chốt", CANCELLED: "Đã hủy" } as const;
export type StocktakeStatusKey = keyof typeof STOCKTAKE_LABEL;
export interface StocktakeRowDTO { id: number; code: string; at: Date; status: StocktakeStatusKey; lineCount: number; note: string | null; createdByName: string | null }
