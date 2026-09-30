import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lỗi chỉ lộ ở `next build`: component "use client" nhập GIÁ TRỊ từ module server kéo theo prisma / node:* / next/headers vào bundle trình duyệt.
 * Quy tắc: import giá trị từ "@/…" của file client phải đi tới module KHÔNG (gián tiếp) nhập các thứ cấm. Import `type` bỏ qua.
 */
const BANNED = [/^node:/, /^@\/lib\/prisma$/, /^@\/server\/audit\//, /^@\/server\/http\/request-context$/, /^next\/headers$/, /^@\/server\/auth\/session$/, /^fs$/, /^crypto$/, /^exceljs$/];
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const files = walk("src");
const resolve = (spec: string, from: string): string | null => {
  const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : normalize(join(dirname(from), spec));
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c)) return c;
  return null;
};
const valueImports = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const clause = m[1]!.trim();
    if (/^type\s/.test(clause)) continue; // import type {...}
    if (/^\{[^}]*\}$/.test(clause) && clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[2]!);
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]!);
  return out;
};

function offender(file: string, seen = new Set<string>(), trail: string[] = []): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const spec of valueImports(readFileSync(file, "utf8"))) {
    if (BANNED.some((b) => b.test(spec))) return [...trail, file, spec];
    if (spec === "@prisma/client") {
      // giá trị (vd Prisma.Decimal) từ @prisma/client trong bundle trình duyệt: chỉ chấp nhận enum thuần — cấm ở file thuộc "@/server" bị client nhập
      continue;
    }
    if (spec.startsWith("@/") || spec.startsWith(".")) { const r = resolve(spec, file); if (r) { const hit = offender(r, seen, [...trail, file]); if (hit) return hit; } }
  }
  return null;
}

describe("component client không kéo module server vào bundle trình duyệt", () => {
  const clients = files.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  it("có component client để kiểm", () => { expect(clients.length).toBeGreaterThan(50); });
  it.each(clients)("%s", (file) => {
    const hit = offender(file);
    expect(hit, hit ? `Đường nhập: ${hit.join(" → ")}` : "").toBeNull();
  });
});
