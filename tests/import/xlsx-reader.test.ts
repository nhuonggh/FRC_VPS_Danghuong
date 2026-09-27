import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/server/export/xlsx";
import { readSheet } from "@/server/import/xlsx-reader";
import type { ImportColumn } from "@/server/import/types";
const columns: ImportColumn[] = [{ key: "code", header: "Mã", required: true, sample: "A1" }, { key: "name", header: "Tên", aliases: ["Tên hàng"], required: true, sample: "Tôn" }];
const file = (headers: string[], rows: unknown[][]) => buildXlsx("S", headers.map((header, i) => ({ header, key: `c${i}` })), rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))));
describe("readSheet", () => {
  it("khớp header không dấu/tên phụ, bỏ dòng rỗng và giữ số dòng Excel", async () => { const rows = await readSheet(await file(["MA", "ten hang"], [["A1", "Tôn"], [null, null], ["A2", "Xốp"]]), columns); expect(rows.map((r) => r.line)).toEqual([2, 4]); expect(rows[0]!.cells).toMatchObject({ code: "A1", name: "Tôn" }); });
  it("bỏ mẫu có dấu # và báo thiếu cột bắt buộc", async () => { expect(await readSheet(await file(["Mã", "Tên"], [["# mẫu", "Bỏ"], ["A1", "Giữ"]]), columns)).toHaveLength(1); await expect(readSheet(await file(["Mã"], [["A1"]]), columns)).rejects.toMatchObject({ status: 400 }); });
});
