import { z } from "zod";

const text = (max: number) => z.string().trim().max(max, `Tối đa ${max} ký tự.`);
/** Chuỗi luôn có mặt trong body (form luôn gửi đủ); rỗng nghĩa là để trống. */
const optionalText = text;

/** Host nội bộ/loopback: webhook chỉ được trỏ ra ngoài (GĐ2 gọi từ server → tránh SSRF vào mạng nội bộ). */
const PRIVATE_HOST = /^(localhost|.*\.(local|internal|localdomain)|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|0\.0\.0\.0|\[.*\])$/i;

const httpsUrl = text(500).refine((v) => {
  if (v === "") return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}, "Nhập địa chỉ https công khai hợp lệ (không dùng địa chỉ nội bộ, không kèm tài khoản).");

/**
 * Logo/ảnh QR: đường dẫn upload nội bộ (`/uploads/…`) hoặc https. Server KHÔNG tải ảnh từ URL người dùng;
 * https còn phải thuộc allowlist `COMPANY_IMAGE_HOSTS` (kiểm ở service — client không đọc được env).
 */
export const IMAGE_PATH = /^\/uploads\/[A-Za-z0-9._\-/]+$/;
const imageRef = text(500).refine((v) => {
  if (v === "") return true;
  if (v.startsWith("/")) return IMAGE_PATH.test(v) && !v.includes("..");
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}, "Chỉ nhận đường dẫn /uploads/… hoặc địa chỉ https hợp lệ.");

export const companyInfoSchema = z.object({
  name: text(200).min(1, "Nhập tên công ty."),
  address: optionalText(300),
  phone: optionalText(30),
  taxCode: optionalText(20),
  logo: imageRef,
});
export const companyBankSchema = z.object({
  bankName: optionalText(100),
  accountNo: optionalText(30),
  accountHolder: optionalText(100),
  branch: optionalText(100),
});
export type CompanyInfoInput = z.infer<typeof companyInfoSchema>;
export type CompanyBankInput = z.infer<typeof companyBankSchema>;

/** Body PATCH /api/company: một section + `version` (updatedAt ms) để chống ghi đè mù. */
export const updateCompanySchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("info"), version: z.number().int(), value: companyInfoSchema }),
  z.object({ section: z.literal("bank"), version: z.number().int(), value: companyBankSchema }),
]);

export const DOC_TYPE = /^[A-Z][A-Z0-9_]{1,39}$/;

const templateBase = z.object({
  name: text(100).min(1, "Nhập tên mẫu in."),
  webhookUrl: httpsUrl,
  title: optionalText(100),
  signerName: optionalText(100),
  phone: optionalText(30),
  qrImage: imageRef,
  showCompanyInfo: z.boolean(),
  footerNote: optionalText(300),
  isActive: z.boolean(),
});

/**
 * Secret (D-21): `secretAction` phải NÊU RÕ. "keep" bỏ qua mọi giá trị secret gửi kèm;
 * "replace" bắt buộc có secret mới; "clear" xoá. PATCH thiếu/rỗng KHÔNG bao giờ xoá secret.
 */
const secretFields = {
  secretAction: z.enum(["keep", "replace", "clear"]),
  secret: text(200).optional(),
};
const needSecret = (v: { secretAction: string; secret?: string | undefined }, ctx: z.RefinementCtx) => {
  if (v.secretAction === "replace" && (!v.secret || v.secret.length < 8)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["secret"], message: "Secret mới tối thiểu 8 ký tự." });
  }
};

export const createTemplateSchema = templateBase
  .extend({ docType: z.string().trim().toUpperCase().regex(DOC_TYPE, "Mã loại chứng từ gồm chữ HOA, số, gạch dưới (2–40 ký tự)."), ...secretFields })
  .superRefine(needSecret);
export const updateTemplateSchema = templateBase.extend(secretFields).superRefine(needSecret);

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
