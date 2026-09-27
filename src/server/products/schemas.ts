import { z } from "zod";

export const PRODUCT_KINDS = [
  { value: "HANG", label: "Hàng hóa" }, { value: "NVL", label: "Nguyên vật liệu" },
  { value: "THANH_PHAM", label: "Thành phẩm" }, { value: "PHU_KIEN", label: "Phụ kiện" },
] as const;
export const BASE_UNIT_SUGGESTIONS = ["md", "kg", "cái", "cây", "bộ", "tấm", "cuộn"] as const;
const unitName = z.string().trim().min(1, "Nhập đơn vị.").max(10, "Đơn vị tối đa 10 ký tự.");
const unitRow = z.object({ unit: unitName, factor: z.number().finite("Hệ số không hợp lệ.").gt(0, "Hệ số phải lớn hơn 0.").max(1_000_000) });
const uniqueUnits = (value: { unit: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  value.forEach((row, index) => { const key = row.unit.toLocaleLowerCase("vi"); if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "unit"], message: "Đơn vị quy đổi bị trùng." }); seen.add(key); });
};
const base = z.object({
  code: z.string().trim().min(1, "Nhập mã sản phẩm.").max(30).regex(/^[A-Za-z0-9._\-/]+$/, "Mã chỉ gồm chữ không dấu, số và . _ - /."),
  name: z.string().trim().min(1, "Nhập tên sản phẩm.").max(200), kind: z.enum(["HANG", "NVL", "THANH_PHAM", "PHU_KIEN"]),
  baseUnit: unitName, minStock: z.number().finite().min(0, "Định mức tồn không được âm.").max(999_999_999),
  isCoil: z.boolean(), isActive: z.boolean(), note: z.string().trim().max(500),
});
export const createProductSchema = base.extend({ units: z.array(unitRow).max(10, "Tối đa 10 đơn vị quy đổi.") }).superRefine((value, ctx) => { uniqueUnits(value.units, ctx); value.units.forEach((row, index) => { if (row.unit.toLocaleLowerCase("vi") === value.baseUnit.toLocaleLowerCase("vi")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["units", index, "unit"], message: "Đơn vị gốc không được là đơn vị quy đổi." }); }); });
export const basicSectionSchema = base.pick({ name: true, kind: true, baseUnit: true, isCoil: true, note: true });
export const stockSectionSchema = base.pick({ minStock: true });
export const statusSectionSchema = base.pick({ isActive: true });
export const unitsSectionSchema = z.object({ units: z.array(unitRow).max(10) }).superRefine((value, ctx) => uniqueUnits(value.units, ctx));
export type CreateProductInput = z.infer<typeof createProductSchema>;
