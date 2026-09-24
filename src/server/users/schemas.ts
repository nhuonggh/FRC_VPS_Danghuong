import { z } from "zod";

export const usernameSchema = z
  .string({ required_error: "Nhập tên đăng nhập." })
  .trim()
  .min(3, "Tên đăng nhập tối thiểu 3 ký tự.")
  .max(30, "Tên đăng nhập tối đa 30 ký tự.")
  .regex(/^[a-zA-Z0-9._-]+$/, "Tên đăng nhập chỉ gồm chữ không dấu, số và . _ -");

export const fullNameSchema = z.string({ required_error: "Nhập họ tên." }).trim().min(2, "Nhập họ tên.").max(80, "Họ tên tối đa 80 ký tự.");

export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: fullNameSchema,
  roleIds: z.array(z.number().int()).min(1, "Chọn ít nhất 1 nhóm quyền."),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const profileSectionSchema = z.object({ fullName: fullNameSchema });
export const rolesSectionSchema = z.object({ roleIds: z.array(z.number().int()).min(1, "Chọn ít nhất 1 nhóm quyền.") });

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Nhập mật khẩu hiện tại."),
    next: z.string().min(1, "Nhập mật khẩu mới."),
    confirm: z.string().min(1, "Nhập lại mật khẩu mới."),
  })
  .superRefine((v, ctx) => {
    if (v.next !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "Mật khẩu nhập lại không khớp." });
    // Báo sớm cho form; service vẫn kiểm lại sau khi chuẩn hoá NFC (chỗ duy nhất tin được)
    if (v.next && v.next === v.current) ctx.addIssue({ code: "custom", path: ["next"], message: "Mật khẩu mới phải khác mật khẩu hiện tại." });
  });
