import { z } from "zod";
import { purchaseLineSchema } from "@/server/purchase/schemas";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Ngày không hợp lệ.");
export const attachmentSchema = z.object({ name: z.string().max(150), data: z.string().max(1000000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) });
export const supplierOrderSchema = z.object({
  attachments: z.array(attachmentSchema).max(3).default([]),
  partnerId: z.number().int().positive(), date,
  note: z.string().trim().max(500),
  lines: z.array(purchaseLineSchema.omit({ id: true }).extend({ expectedDate: date.nullable(),
    qty: purchaseLineSchema.shape.qty.refine(v => Number(v.toFixed(3)) === v, "Số lượng tối đa 3 số lẻ."),
  })).min(1).max(200),
});
export type SupplierOrderInput = z.infer<typeof supplierOrderSchema>;
export const orderActionSchema = z.object({ action: z.enum(["send", "cancel", "close", "schedule"]), reason: z.string().trim().max(500).default(""),
  dates: z.array(z.object({ lineId: z.number().int().positive(), expectedDate: date.nullable() })).max(200).default([]),
});
export const receiveOrderSchema = z.object({
  date, freightCost: z.number().min(0).max(9_999_999_999), note: z.string().trim().max(500),
  excessReason: z.string().trim().max(300).default(""),
  lines: z.array(z.object({ lineId: z.number().int().positive(), qty: z.number().positive().max(999_999_999).refine(v => Number(v.toFixed(3)) === v), purchasePrice: z.number().min(0).max(9_999_999_999) })).min(1).max(200),
}).refine(v => new Set(v.lines.map(l => l.lineId)).size === v.lines.length, "Dòng nhận hàng bị trùng.");
export type ReceiveOrderInput = z.infer<typeof receiveOrderSchema>;
