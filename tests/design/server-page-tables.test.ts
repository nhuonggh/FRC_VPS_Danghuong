import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe("server page không truyền hàm sang DataTable (client)", () => {
  // Lỗi thật trên VPS 02/10: trang chỉ lỗi khi có dữ liệu ("Functions cannot be passed directly to Client Components").
  it("page.tsx (server) không render <DataTable> trực tiếp — dùng *Table.tsx có \"use client\"", () => {
    const offenders = walk("src/app").filter((f) => f.endsWith("page.tsx")).filter((f) => { const s = readFileSync(f, "utf8"); return !s.startsWith('"use client"') && s.includes("<DataTable"); });
    expect(offenders).toEqual([]);
  });
  it("*Table.tsx có <DataTable> phải là client component", () => {
    const offenders = [...walk("src/app"), ...walk("src/components")].filter((f) => /Table\.tsx$/.test(f) && !f.endsWith("DataTable.tsx")).filter((f) => { const s = readFileSync(f, "utf8"); return s.includes("<DataTable") && !s.startsWith('"use client"'); });
    expect(offenders).toEqual([]);
  });
});
