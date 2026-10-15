import { describe, expect, it } from "vitest";
import { createPartnerSchema, profileSectionSchema } from "@/server/partners/schemas";

const valid = { code: "", name: "Nguyễn Văn Đạt", groupId: 1, isCustomer: true, isSupplier: false, ownerUserId: null, debtLimit: 5_000_000, allowCredit: true, phone: "0912 345 678", address: "", note: "", isActive: true };
const message = (value: unknown) => { const result = createPartnerSchema.safeParse(value); return result.success ? null : result.error.issues[0]?.message; };
describe("createPartnerSchema", () => {
  it("cắt khoảng trắng tên và cho phép mã rỗng để tự sinh", () => expect(createPartnerSchema.parse({ ...valid, name: "  Đạt  " }).name).toBe("Đạt"));
  it("báo lỗi tiếng Việt cho tên/nhóm/loại đối tác", () => {
    expect(message({ ...valid, name: " " })).toBe("Nhập tên.");
    expect(message({ ...valid, groupId: undefined })).toBe("Chọn nhóm.");
    expect(message({ ...valid, isCustomer: false, isSupplier: false })).toBe("Chọn khách hàng hoặc nhà cung cấp.");
  });
  it("chặn mã, hạn mức và điện thoại sai", () => {
    expect(message({ ...valid, code: "KH 01" })).toBe("Mã chỉ gồm chữ không dấu, số và . _ -");
    expect(message({ ...valid, debtLimit: -1 })).toBe("Không được âm.");
    expect(message({ ...valid, phone: "abc" })).toBe("Số điện thoại không hợp lệ.");
  });
  it("section hồ sơ cũng bắt buộc có ít nhất một loại", () => expect(profileSectionSchema.safeParse({ name: "A", groupId: 1, isCustomer: false, isSupplier: false, phone: "", address: "", note: "" }).success).toBe(false));
});
