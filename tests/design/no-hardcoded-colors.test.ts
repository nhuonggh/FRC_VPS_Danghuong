import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

// tokens.css và app-override.css là NƠI DUY NHẤT được khai báo màu gốc
const ALLOWED = [/src[\\/]styles[\\/]tokens\.css$/, /design[\\/]app-override\.css$/, /tailwind\.config\.ts$/];

const files = [...walk("src"), ...walk("design")].filter((f) => !ALLOWED.some((r) => r.test(f)));

describe("kỷ luật token (crm-design)", () => {
  it("không hex hardcode trong code UI", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // #rgb / #rrggbb / #rrggbbaa; bỏ qua fragment URL & id nằm trong chuỗi ngắn như "#main"
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(m[0])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("không dùng dark: rời rạc và không tham chiếu --gray-* trực tiếp", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
      const text = readFileSync(f, "utf8");
      if (/\bdark:/.test(text)) bad.push(`${f}: dark:`);
      if (/var\(--gray-/.test(text)) bad.push(`${f}: var(--gray-*)`);
    }
    expect(bad).toEqual([]);
  });
});
