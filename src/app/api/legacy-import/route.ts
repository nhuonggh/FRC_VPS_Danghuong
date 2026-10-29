import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { DomainError, ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { commitLegacyOrders, legacyOptionsSchema, previewLegacyOrders, resolutionSchema } from "@/server/legacy-import/service";
import { parseLegacySales } from "@/server/legacy-import/parse";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ORDERS = 500;

const json = <T extends z.ZodTypeAny>(schema: T, raw: FormDataEntryValue | null, what: string): z.infer<T> => {
  try { return schema.parse(JSON.parse(typeof raw === "string" ? raw : "null")); } catch { throw new ValidationError(`${what} không hợp lệ.`); }
};

/**
 * Nhập đơn bán từ "Báo cáo bán hàng hằng ngày" của phần mềm cũ. multipart: file + options + resolutions (+ selected khi commit).
 * `?mode=preview` chỉ xem trước (không ghi); `?mode=commit` ghi các đơn trong `selected`, mỗi đơn một giao dịch.
 */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("order.create");
  const mode = new URL(req.url).searchParams.get("mode");
  if (mode !== "preview" && mode !== "commit") throw new ValidationError("Chế độ nhập không hợp lệ.");
  const form = await req.formData().catch(() => { throw new ValidationError("Không đọc được tệp gửi lên."); });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Chưa chọn tệp.");
  if (file.size > MAX_BYTES) throw new DomainError("Tệp quá lớn (tối đa 4 MB).", 413);
  const parsed = parseLegacySales(await file.text());
  if (!parsed.orders.length) throw new ValidationError(parsed.errors[0] ?? "Tệp không có đơn hàng nào.");
  if (parsed.orders.length > MAX_ORDERS) throw new DomainError(`Tối đa ${MAX_ORDERS} đơn mỗi lần nhập.`, 413);
  const options = json(legacyOptionsSchema, form.get("options"), "Tùy chọn nhập");
  const resolutions = json(z.array(resolutionSchema).max(2000), form.get("resolutions") ?? "[]", "Lựa chọn ghép");
  if (mode === "preview") return { ...(await previewLegacyOrders(prisma, actor, parsed.orders, options, resolutions)), fileErrors: parsed.errors };
  const selected = json(z.array(z.string().min(1).max(60)).max(MAX_ORDERS), form.get("selected"), "Danh sách đơn chọn");
  return commitLegacyOrders(prisma, actor, parsed.orders, selected, options, resolutions);
});
