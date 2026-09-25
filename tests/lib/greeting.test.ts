import { describe, expect, it } from "vitest";
import { greeting } from "@/lib/greeting";

const at = (utc: string) => greeting(new Date(utc));

describe("greeting — theo giờ ICT, không phải giờ máy chủ", () => {
  it.each([
    ["2026-09-24T21:59:00Z", "Chào buổi tối"], // 04:59 ICT — còn ca đêm
    ["2026-09-24T22:00:00Z", "Chào buổi sáng"], // 05:00 ICT
    ["2026-09-24T03:59:00Z", "Chào buổi sáng"], // 10:59 ICT
    ["2026-09-24T04:00:00Z", "Chào buổi trưa"], // 11:00 ICT
    ["2026-09-24T05:59:00Z", "Chào buổi trưa"], // 12:59 ICT
    ["2026-09-24T06:00:00Z", "Chào buổi chiều"], // 13:00 ICT
    ["2026-09-24T10:59:00Z", "Chào buổi chiều"], // 17:59 ICT
    ["2026-09-24T11:00:00Z", "Chào buổi tối"], // 18:00 ICT
    ["2026-09-24T16:50:00Z", "Chào buổi tối"], // 23:50 ICT
    ["2026-09-24T19:00:00Z", "Chào buổi tối"], // 02:00 ICT sáng hôm sau
    ["2026-09-24T17:00:00Z", "Chào buổi tối"], // 00:00 ICT (qua ngày, dùng giờ ICT chứ không phải UTC)
  ])("%s → %s", (utc, out) => {
    expect(at(utc)).toBe(out);
  });
});
