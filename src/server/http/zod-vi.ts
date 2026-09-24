import { z } from "zod";

/**
 * Thông báo mặc định tiếng Việt cho lỗi zod mà schema không tự đặt `message`
 * (kiểu dữ liệu sai, thiếu field...). Message tự đặt trên schema luôn được ưu tiên.
 */
const viErrorMap: z.ZodErrorMap = (issue) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "Thiếu dữ liệu bắt buộc." : "Dữ liệu không đúng định dạng." };
    case z.ZodIssueCode.too_small:
      return { message: "Giá trị quá nhỏ hoặc quá ngắn." };
    case z.ZodIssueCode.too_big:
      return { message: "Giá trị quá lớn hoặc quá dài." };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Giá trị không nằm trong danh sách cho phép." };
    default:
      return { message: "Dữ liệu không hợp lệ." };
  }
};

z.setErrorMap(viErrorMap);
