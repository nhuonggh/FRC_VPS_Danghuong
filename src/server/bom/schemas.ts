import { z } from "zod";

/**
 * Policy sản phẩm được phép có BOM (plan 03c, mục "Cần khách xác nhận" #1) — TODO: confirm với khách.
 * Đặt MỘT chỗ để đổi khi khách chốt bảng định mức thật; service và UI đều đọc từ đây.
 */
export const BOM_TARGET_KINDS = ["THANH_PHAM", "PHU_KIEN"] as const;
export const BOM_MATERIAL_KINDS = ["NVL", "HANG", "PHU_KIEN"] as const;

export const BOM_MAX_LINES = 100;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày hiệu lực không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày hiệu lực không tồn tại.");

/** Định mức: dương, tối đa 3 chữ số thập phân (khớp Decimal(18,3)). */
const qtyPerUnit = z
  .number({ invalid_type_error: "Nhập định mức." })
  .finite("Định mức không hợp lệ.")
  .gt(0, "Định mức phải lớn hơn 0.")
  .max(999_999_999, "Định mức quá lớn.")
  .refine((n) => Number(n.toFixed(3)) === n, "Định mức tối đa 3 chữ số thập phân.");

export const bomLineSchema = z.object({
  materialProductId: z.number().int().positive("Chọn nguyên vật liệu."),
  qtyPerUnit,
  note: z.string().trim().max(200).optional(),
});

export const createBomVersionSchema = z
  .object({
    productId: z.number().int().positive("Chọn thành phẩm."),
    processingTypeId: z.number().int().positive("Chọn kiểu gia công."),
    validFrom: ymd,
    note: z.string().trim().max(500).optional(),
    lines: z.array(bomLineSchema).min(1, "Nhập ít nhất một nguyên vật liệu.").max(BOM_MAX_LINES, `Tối đa ${BOM_MAX_LINES} dòng.`),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<number>();
    v.lines.forEach((l, i) => {
      if (l.materialProductId === v.productId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", i, "materialProductId"], message: "Nguyên vật liệu không được trùng với chính thành phẩm." });
      }
      if (seen.has(l.materialProductId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", i, "materialProductId"], message: "Nguyên vật liệu bị trùng." });
      }
      seen.add(l.materialProductId);
    });
  });

export type CreateBomVersionInput = z.infer<typeof createBomVersionSchema>;

export const BOM_MAX_BATCH = 50;
export const createBomBatchSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1, "Chọn thành phẩm.").max(BOM_MAX_BATCH),
  processingTypeIds: z.array(z.number().int().positive()).min(1, "Chọn kiểu gia công.").max(BOM_MAX_BATCH),
  validFrom: ymd,
  note: z.string().trim().max(500).optional(),
  lines: z.array(bomLineSchema).min(1, "Nhập ít nhất một nguyên vật liệu.").max(BOM_MAX_LINES),
}).superRefine((v, ctx) => {
  if (new Set(v.productIds).size !== v.productIds.length || new Set(v.processingTypeIds).size !== v.processingTypeIds.length)
    ctx.addIssue({ code: "custom", path: ["productIds"], message: "Thành phẩm và kiểu gia công không được chọn trùng." });
  if (v.productIds.length * v.processingTypeIds.length > BOM_MAX_BATCH)
    ctx.addIssue({ code: "custom", path: ["productIds"], message: `Tối đa ${BOM_MAX_BATCH} cặp thành phẩm × kiểu gia công mỗi lần.` });
  // Reuse all single-version rules, including duplicate materials and self-consumption.
  for (const productId of v.productIds) {
    const result = createBomVersionSchema.safeParse({ ...v, productId, processingTypeId: v.processingTypeIds[0] });
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue, message: `${issue.message} (thành phẩm #${productId})` });
  }
});
export type CreateBomBatchInput = z.infer<typeof createBomBatchSchema>;
