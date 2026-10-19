import { z } from "zod";

const num = (label: string) => z.number({ required_error: `Nhập ${label.toLowerCase()}.`, invalid_type_error: `${label} không hợp lệ.` }).finite().positive(`${label} phải lớn hơn 0.`).max(1_000_000_000, `${label} quá lớn.`).multipleOf(0.001, "Tối đa 3 chữ số thập phân.");
const productId = z.number({ required_error: "Chọn sản phẩm cần sản xuất.", invalid_type_error: "Chọn sản phẩm cần sản xuất." }).int().positive("Chọn sản phẩm cần sản xuất.");
export const productionOutputSchema = z.object({
  productId, qty: num("Số lượng thành phẩm"), widthMm: num("Khổ tôn").max(100_000).optional(),
  stripCount: z.number().int().positive().max(10000).optional(), lengthM: num("Chiều dài").optional(), allocationWeight: num("Trọng số phân bổ").optional(),
});
export type ProductionOutputInput = z.infer<typeof productionOutputSchema>;
export function productionOutputs(input: { productId?: number; qty?: number; outputs?: ProductionOutputInput[] }): ProductionOutputInput[] {
  return input.outputs ?? (input.productId && input.qty ? [{ productId: input.productId, qty: input.qty, allocationWeight: 1 }] : []);
}
export const productionOrderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine(s => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, "Ngày không tồn tại."),
  // ASSUMPTION: API cũ dùng productId/qty; lệnh mới dùng outputs, không trộn hai cách.
  productId: productId.optional(), qty: num("Số lượng thành phẩm").optional(),
  outputs: z.array(productionOutputSchema).min(1, "Cần ít nhất một sản phẩm đầu ra.").max(50).optional(),
  allocationBasis: z.enum(["WEIGHT", "AREA"]).optional(), note: z.string().trim().max(500),
  materials: z.array(z.object({ productId: z.number({ required_error: "Chọn nguyên vật liệu.", invalid_type_error: "Chọn nguyên vật liệu." }).int().positive("Chọn nguyên vật liệu."), qty: num("Lượng NVL"), widthMm: num("Khổ nguyên liệu").max(100_000).optional() })).min(1, "Cần ít nhất một nguyên vật liệu.").max(50),
}).superRefine((v, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (!v.outputs) {
    if (!v.productId) issue(["productId"], "Chọn sản phẩm cần sản xuất.");
    if (!v.qty) issue(["qty"], "Nhập số lượng thành phẩm.");
  } else if (v.productId !== undefined || v.qty !== undefined) issue(["outputs"], "Chỉ gửi danh sách đầu ra hoặc sản phẩm đầu ra cũ.");
  const outputs = productionOutputs(v);
  if (new Set(outputs.map(o => o.productId)).size !== outputs.length) issue(["outputs"], "Sản phẩm đầu ra bị lặp — gộp thành một dòng.");
  if (v.allocationBasis === "AREA") {
    if (v.materials.length !== 1) issue(["materials"], "Phương án xẻ khổ dùng một nguyên liệu mỗi lệnh.");
    if (!v.materials[0]?.widthMm) issue(["materials", 0, "widthMm"], "Nhập khổ nguyên liệu.");
    outputs.forEach((o, i) => {
      if (!o.widthMm) issue(["outputs", i, "widthMm"], "Nhập khổ đầu ra.");
      if (!o.lengthM) issue(["outputs", i, "lengthM"], "Nhập chiều dài mỗi dải.");
      if (Math.abs(o.qty - (o.lengthM ?? 0) * (o.stripCount ?? 1)) > 0.0001) issue(["outputs", i, "qty"], "Số lượng phải bằng số dải × chiều dài.");
      if (o.lengthM && Math.abs(o.lengthM - v.materials[0]?.qty) > 0.0001) issue(["outputs", i, "lengthM"], "Xẻ khổ: chiều dài mỗi dải phải bằng chiều dài nguyên liệu.");
    });
    if (outputs.reduce((sum, o) => sum + (o.widthMm ?? 0) * (o.stripCount ?? 1), 0) > (v.materials[0]?.widthMm ?? 0) + 0.0001) issue(["outputs"], "Tổng khổ đầu ra vượt khổ nguyên liệu.");
  } else if (outputs.length > 1) outputs.forEach((o, i) => { if (!o.allocationWeight) issue(["outputs", i, "allocationWeight"], "Nhập trọng số phân bổ cho từng đầu ra."); });
});
export type ProductionOrderInput = z.infer<typeof productionOrderSchema>;
export const cancelProductionSchema = z.object({ reason: z.string().trim().min(3, "Nhập lý do hủy.").max(500) });