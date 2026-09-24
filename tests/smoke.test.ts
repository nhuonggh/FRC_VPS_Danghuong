import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/version";

describe("smoke", () => {
  it("alias @/ hoạt động", () => {
    expect(APP_NAME).toBe("Xưởng tôn Đặng Hương");
  });
});
