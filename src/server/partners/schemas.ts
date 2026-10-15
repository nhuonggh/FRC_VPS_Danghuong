import { z } from "zod";

const money = z.number({ required_error: "Nhập số tiền.", invalid_type_error: "Nhập số tiền." }).min(0, "Không được âm.").max(9_999_999_999_999, "Số quá lớn.");
const text = (max: number, label: string) => z.string().trim().max(max, `${label} tối đa ${max} ký tự.`);

export const partnerBase = z.object({
  /** Rỗng = tự sinh (KH000001 / NCC000001). */
  code: z.string().trim().max(30, "Mã tối đa 30 ký tự.").refine((v) => v === "" || /^[A-Za-z0-9._-]+$/.test(v), "Mã chỉ gồm chữ không dấu, số và . _ -"),
  name: z.string({ required_error: "Nhập tên." }).trim().min(1, "Nhập tên.").max(120, "Tên tối đa 120 ký tự."),
  groupId: z.number({ required_error: "Chọn nhóm.", invalid_type_error: "Chọn nhóm." }).int("Chọn nhóm.").positive("Chọn nhóm."),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
  ownerUserId: z.number().int().positive().nullable(),
  debtLimit: money,
  allowCredit: z.boolean(),
  phone: text(30, "Số điện thoại").refine((v) => v === "" || /^[0-9+().\-\s]{6,30}$/.test(v), "Số điện thoại không hợp lệ."),
  address: text(250, "Địa chỉ"),
  taxCode: text(20, "Mã số thuế").refine((v) => v === "" || /^[0-9][0-9-]{8,18}[0-9]$/.test(v), "Mã số thuế gồm 10–13 chữ số (có thể có dấu -).").optional(),
  deliveryAddress: text(250, "Địa chỉ giao hàng").optional(),
  /** Các trường bổ sung của hộp thoại "Thêm khách hàng" (form bán hàng) — tất cả tuỳ chọn. */
  email: text(120, "Email").refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email không hợp lệ.").optional(),
  bankAccount: text(120, "TK ngân hàng").optional(),
  representative: text(120, "Người đại diện").optional(),
  sortOrder: z.number({ invalid_type_error: "Thứ tự phải là số." }).int("Thứ tự phải là số nguyên.").min(0, "Không được âm.").max(1_000_000, "Số quá lớn.").nullable().optional(),
  isExpense: z.boolean().optional(),
  /** Công nợ đầu kỳ (+ khách nợ, − mình nợ); ghi vào số đầu kỳ của kỳ đang mở. 0/trống = không ghi. */
  openingDebt: z.number({ invalid_type_error: "Nhập số tiền." }).min(-9_999_999_999_999, "Số quá lớn.").max(9_999_999_999_999, "Số quá lớn.").optional(),
  note: text(500, "Ghi chú"),
  isActive: z.boolean(),
});

type Kind = { isCustomer: boolean; isSupplier: boolean };
const kindRule = (v: Kind, ctx: z.RefinementCtx) => {
  if (!v.isCustomer && !v.isSupplier) ctx.addIssue({ code: "custom", path: ["isCustomer"], message: "Chọn khách hàng hoặc nhà cung cấp." });
};

export const createPartnerSchema = partnerBase.superRefine(kindRule);
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export const profileSectionSchema = partnerBase.pick({ name: true, groupId: true, isCustomer: true, isSupplier: true, phone: true, address: true, taxCode: true, deliveryAddress: true, note: true }).superRefine(kindRule);
export const creditSectionSchema = partnerBase.pick({ debtLimit: true, allowCredit: true });
export const ownerSectionSchema = partnerBase.pick({ ownerUserId: true });
export const statusSectionSchema = partnerBase.pick({ isActive: true });
