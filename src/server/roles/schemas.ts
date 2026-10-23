import { z } from "zod";

export const roleInfoSchema = z.object({
  name: z.string({ required_error: "Nhập tên nhóm quyền." }).trim().min(2, "Tên nhóm quyền tối thiểu 2 ký tự.").max(40, "Tên nhóm quyền tối đa 40 ký tự."),
  description: z.string().trim().max(200, "Mô tả tối đa 200 ký tự.").optional(),
});
export type RoleInfoInput = z.infer<typeof roleInfoSchema>;

/** Tạo nhóm mới; `copyFromRoleId` (tuỳ chọn) = sao chép toàn bộ quyền từ nhóm đó. */
export const roleCreateSchema = roleInfoSchema.extend({ copyFromRoleId: z.number().int().positive().optional() });
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const rolePermissionsSchema = z.object({ codes: z.array(z.string()) });
