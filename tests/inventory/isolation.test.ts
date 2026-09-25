import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Review Focus #6: engine thuần dữ liệu — không dính UI/xác thực, không ghi audit_log (module nghiệp vụ làm). */
const DIRS = ["src/server/inventory", "src/server/period"];
const files = DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)));

describe("engine kho / kiểm kỳ độc lập với web", () => {
  it("có file để kiểm", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s không import next/react/auth và không ghi audit_log", (f) => {
    const src = readFileSync(f, "utf8");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const spec of imports) {
      expect(spec, `${f} import ${spec}`).not.toMatch(/^(next|react|next-auth)(\/|$)/);
      expect(spec, `${f} import ${spec}`).not.toMatch(/(^|\/)(auth|audit)(\/|$)/);
    }
    expect(src).not.toMatch(/auditLog|writeAudit|audit_log/);
  });
});
