import { describe, expect, it } from "vitest";
import { ownerMap } from "@/server/partners/import-spec";

describe("khớp người phụ trách khi nhập khách", () => {
  const users = [{ id: 1, username: "Nham", fullName: "Bùi Thị Nhâm" }, { id: 2, username: "Phuong", fullName: "Bùi Thị Phượng" }, { id: 3, username: "ketoan2", fullName: "Bùi Thị Nhâm" }];
  it("khớp tên đăng nhập không phân biệt hoa/thường/dấu", () => { const m = ownerMap(users); expect(m.get("nham")).toBe(1); expect(m.get("phuong")).toBe(2); });
  it("khớp họ tên; họ tên trùng nhau thì bỏ vì mơ hồ", () => { const m = ownerMap(users); expect(m.get("bui thi phuong")).toBe(2); expect(m.has("bui thi nham")).toBe(false); });
});
