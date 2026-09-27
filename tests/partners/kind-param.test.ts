import { describe, expect, it } from "vitest";
import { parseKindParam } from "@/server/partners/kind-param";

describe("parseKindParam", () => {
  it("chỉ nhận customers/suppliers; giá trị khác trả 404", () => {
    expect(parseKindParam("customers")).toBe("customer");
    expect(parseKindParam("suppliers")).toBe("supplier");
    expect(() => parseKindParam("partners")).toThrow(expect.objectContaining({ status: 404 }));
  });
});
