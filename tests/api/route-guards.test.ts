import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mọi route handler và mọi page phải TỰ gọi requireActorApi / requireActor (không dựa vào layout hay middleware —
 * Next có thể render page/route handler độc lập với layout). Trừ các route công khai có chủ đích.
 */
const APP = join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const rel = (f: string) => relative(APP, f).replaceAll("\\", "/");
const all = walk(APP).map((f) => ({ file: f, rel: rel(f) }));

// Công khai có chủ đích: next-auth, health check, trang đăng nhập, 403.
const PUBLIC = [/^api\/auth\//, /^api\/health\//, /^\(auth\)\/login\//, /^403\//];
const isPublic = (r: string) => PUBLIC.some((p) => p.test(r));

describe("mọi route handler / page tự kiểm đăng nhập", () => {
  const routes = all.filter((f) => /(^|\/)route\.ts$/.test(f.rel) && !isPublic(f.rel));
  const pages = all.filter((f) => /(^|\/)page\.tsx$/.test(f.rel) && !isPublic(f.rel));

  it("có route handler để kiểm (chống test rỗng)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  it.each(routes.map((f) => [f.rel, f.file]))("route %s gọi requireActorApi(", (_r, file) => {
    expect(readFileSync(file as string, "utf8")).toMatch(/requireActorApi\(/);
  });

  it.each(pages.map((f) => [f.rel, f.file]))("page %s gọi requireActor(", (_r, file) => {
    expect(readFileSync(file as string, "utf8")).toMatch(/requireActor\(/);
  });
});
