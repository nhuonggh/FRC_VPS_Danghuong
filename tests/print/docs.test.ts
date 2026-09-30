import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, PRINT_DOCS } from "@/server/print/types";

describe("tài liệu in khớp code", () => {
  const readme = readFileSync("docs/infra/print/README.md", "utf8");
  const script = readFileSync("docs/infra/print/apps-script.gs", "utf8");
  it("README liệt kê mọi docType (kể cả loại chưa hỗ trợ)", () => { for (const d of PRINT_DOCS) expect(readme, d.docType).toContain(`\`${d.docType}\``); });
  it("script mẫu kiểm secret + đúng version + có action create/delete + không hard-code secret", () => {
    expect(script).toContain(`body.version !== ${CONTRACT_VERSION}`);
    expect(script).toContain("body.secret !== secret"); expect(script).toContain("'delete'"); expect(script).toContain("'create'");
    expect(script).toContain("getScriptProperties"); expect(script).not.toMatch(/SECRET\s*=\s*['"][^'"]{4,}['"]/);
  });
});
