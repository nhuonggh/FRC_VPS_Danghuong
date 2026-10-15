import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Ngày không tồn tại.");

export const deliveryNoteSchema = z
  .object({
    orderId: z.number().int().positive(),
    date: ymd,
    note: z.string().trim().max(500),
    lines: z.array(z.object({
      orderLineId: z.number().int().positive(),
      /** Theo đơn vị của dòng bán. */
      qty: z.number({ invalid_type_error: "Nhập số lượng giao." }).finite().gt(0, "Số lượng giao phải lớn hơn 0.").max(999_999_999).refine((n) => Number(n.toFixed(3)) === n, "Tối đa 3 chữ số thập phân."),
    })).min(1, "Chọn ít nhất một dòng để giao.").max(200),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<number>();
    v.lines.forEach((l, i) => {
      if (seen.has(l.orderLineId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines", i, "orderLineId"], message: "Dòng hàng bị trùng." });
      seen.add(l.orderLineId);
    });
  });
export type DeliveryNoteInput = z.infer<typeof deliveryNoteSchema>;
