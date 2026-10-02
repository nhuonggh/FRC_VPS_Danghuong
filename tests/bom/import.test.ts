import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { exportBomXlsx } from "@/server/bom/export";
import { bomImportSpec, parseBomDate } from "@/server/bom/import-spec";
import { commitImport, previewImport } from "@/server/import/framework";
import { ictYmd } from "@/lib/time";
import { prisma, resetDb } from "../helpers/db";
import { makeProcessingType, makeProduct, makeUser } from "../helpers/factories";
import { toXlsx } from "../../scripts/lib/customer-data";

const H = ["Mã thành phẩm", "Tên thành phẩm", "Kiểu gia công", "Ngày hiệu lực (dd/mm/yyyy)", "Mã nguyên vật liệu", "Định mức / 1 đơn vị thành phẩm", "Ghi chú (tỷ lệ cũ, mùa, độ dày…)"];
const TODAY = ictYmd(new Date());
const dmy = (ymd: string) => ymd.split("-").reverse().join("/");
let actor: Actor; let seq = 0; let fg: { code: string; id: number }; let m1: { code: string; id: number }; let m2: { code: string; id: number };
const commit = (buf: Buffer, overwrite = false) => commitImport(prisma, actor, bomImportSpec(), buf, { overwrite, idempotencyKey: `b-${++seq}` });
const preview = (buf: Buffer, overwrite = false) => previewImport(prisma, bomImportSpec(), buf, { overwrite });

beforeEach(async () => {
  await resetDb();
  actor = { userId: (await makeUser()).id, perms: new Set(["data.import", "bom.manage"]) };
  await makeProcessingType("Tôn xốp 6S");
  fg = await makeProduct({ kind: "THANH_PHAM", code: "TX6S" }); await makeProduct({ kind: "THANH_PHAM", code: "TX11S" });
  m1 = await makeProduct({ kind: "NVL", code: "TON-04" }); m2 = await makeProduct({ kind: "NVL", code: "XOP-05" });
});

describe("parseBomDate", () => {
  it("nhận dd/mm/yyyy, ISO, ô ngày Excel; trống = hôm nay; từ chối ngày không tồn tại", () => {
    expect(parseBomDate("01/10/2026", TODAY)).toEqual({ ok: true, value: "2026-10-01" });
    expect(parseBomDate("1/2/2026", TODAY)).toEqual({ ok: true, value: "2026-02-01" });
    expect(parseBomDate("2026-10-01", TODAY)).toEqual({ ok: true, value: "2026-10-01" });
    expect(parseBomDate(new Date("2026-10-01T00:00:00Z"), TODAY)).toEqual({ ok: true, value: "2026-10-01" });
    expect(parseBomDate(null, TODAY)).toEqual({ ok: true, value: TODAY });
    expect(parseBomDate("31/02/2026", TODAY).ok).toBe(false);
    expect(parseBomDate(45000, TODAY).ok).toBe(false);
  });
});

describe("nhập định mức (BOM) từ Excel", () => {
  it("nhiều dòng NVL cùng cặp ⇒ 1 phiên bản; số kiểu VN; audit", async () => {
    const buf = await toXlsx(H, [["# ví dụ"], ["tx6s", "Tôn xốp", "tôn xop 6s", "01/09/2026", "ton-04", "1,05", "tôn"], ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "XOP-05", 0.5, null]]);
    const pv = await preview(buf);
    expect(pv.counts).toMatchObject({ create: 2, error: 0 });
    expect(await commit(buf)).toMatchObject({ created: 2, failed: 0 });
    const bom = await prisma.bom.findFirstOrThrow({ where: { productId: fg.id }, include: { versions: { include: { lines: true } } } });
    expect(bom.versions).toHaveLength(1);
    expect(bom.versions[0]!.versionNo).toBe(1);
    expect(bom.versions[0]!.lines.map((l) => [l.materialProductId, l.qtyPerUnit.toString()]).sort()).toEqual([[m1.id, "1.05"], [m2.id, "0.5"]].sort());
    expect(await prisma.auditLog.count({ where: { action: "import.Bom" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "bom.create_version" } })).toBe(1);
  });

  it("loại CẢ nhóm khi một dòng lỗi (không nhập dở); nhóm khác vẫn nhập", async () => {
    await makeProcessingType("11 sóng");
    const buf = await toXlsx(H, [
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1", null],
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "KHONGCO", "1", null],
      ["TX11S", null, "11 sóng", "01/09/2026", "TON-04", "2", null],
    ]);
    const res = await commit(buf);
    expect(res).toMatchObject({ created: 1, failed: 2 });
    expect(res.failures.map((f) => f.line).sort()).toEqual([2, 3]);
    expect(await prisma.bom.count()).toBe(1);
    expect(await prisma.bom.count({ where: { productId: fg.id } })).toBe(0);
  });

  it("lỗi: sai loại SP, NVL = thành phẩm, định mức ≤ 0 / quá 3 số lẻ, trùng NVL, ngày lệch trong nhóm", async () => {
    const other = await makeProduct({ kind: "HANG", code: "HH1" });
    await makeProcessingType("Một lớp");
    const pv = await preview(await toXlsx(H, [
      ["HH1", null, "Tôn xốp 6S", null, "TON-04", "1", null],
      ["TX11S", null, "Tôn xốp 6S", null, "TX11S", "1", null],
      ["TX11S", null, "Một lớp", null, "TON-04", "0", null],
      ["TX11S", null, "Một lớp", null, "TON-04", "1,2345", null],
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1", null],
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "2", null],
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "XOP-05", "x", null],
    ]));
    expect(other.code).toBe("HH1");
    expect(pv.counts.error).toBe(7);
    const msgs = pv.rows.map((r) => r.message ?? "").join("|");
    expect(msgs).toContain("chỉ khai báo định mức");
    expect(msgs).toContain("trùng với chính thành phẩm");
    expect(msgs).toContain("lớn hơn 0");
    expect(msgs).toContain("Trùng mã");
  });

  it("các dòng một nhóm khác ngày hiệu lực ⇒ loại cả nhóm", async () => {
    const pv = await preview(await toXlsx(H, [
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1", null],
      ["TX6S", null, "Tôn xốp 6S", "02/09/2026", "XOP-05", "1", null],
    ]));
    expect(pv.counts.error).toBe(2);
    expect(pv.rows[0]!.message).toContain("cùng ngày hiệu lực");
  });

  it("dòng cặp chưa điền NVL/định mức (từ phần mềm cũ) bị bỏ qua, không làm hỏng nhóm", async () => {
    await makeProcessingType("11 sóng");
    const buf = await toXlsx(H, [
      ["TX11S", "x", "11 sóng", null, null, null, "PM cũ: ×1"],
      ["TX11S", "x", "11 sóng", null, null, null, "PM cũ: ×2"],
      ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1", null],
    ]);
    const pv = await preview(buf);
    expect(pv.counts).toMatchObject({ create: 1, "skip-reason": 2, error: 0 });
    expect(await commit(buf)).toMatchObject({ created: 1, skippedReason: 2 });
  });

  it("cặp đã có định mức: bỏ qua; Ghi đè ⇒ phiên bản MỚI (bản cũ giữ nguyên); ngày quá khứ bị từ chối", async () => {
    const first = await toXlsx(H, [["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1", null]]);
    await commit(first);
    expect(await commit(first)).toMatchObject({ created: 0, skippedExisting: 1 });
    expect(await prisma.bomVersion.count()).toBe(1);
    const next = await toXlsx(H, [["TX6S", null, "Tôn xốp 6S", dmy(TODAY), "TON-04", "2", null], ["TX6S", null, "Tôn xốp 6S", dmy(TODAY), "XOP-05", "3", null]]);
    expect(await commit(next, true)).toMatchObject({ updated: 2 });
    const versions = await prisma.bomVersion.findMany({ orderBy: { versionNo: "asc" }, include: { lines: true } });
    expect(versions.map((v) => [v.versionNo, v.lines.length])).toEqual([[1, 1], [2, 2]]);
    const past = await toXlsx(H, [["TX6S", null, "Tôn xốp 6S", "01/01/2026", "TON-04", "5", null]]);
    await expect(commit(past, true)).rejects.toThrow(/không được trước hôm nay/);
    expect(await prisma.bomVersion.count()).toBe(2);
  });

  it("chạy lại cùng khoá idempotency không nhân đôi", async () => {
    const buf = await toXlsx(H, [["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1", null]]);
    const a = await commitImport(prisma, actor, bomImportSpec(), buf, { overwrite: false, idempotencyKey: "same" });
    const b = await commitImport(prisma, actor, bomImportSpec(), buf, { overwrite: false, idempotencyKey: "same" });
    expect(b).toEqual(a);
    expect(await prisma.bomVersion.count()).toBe(1);
  });

  it("xuất Excel dùng cùng cột với file nhập (đọc lại được)", async () => {
    await commit(await toXlsx(H, [["TX6S", null, "Tôn xốp 6S", "01/09/2026", "TON-04", "1,25", "ghi chú"], ["TX6S", null, "Tôn xốp 6S", "01/09/2026", "XOP-05", "0,5", null]]));
    const xlsx = await exportBomXlsx(prisma);
    const pv = await preview(xlsx, true);
    expect(pv.counts).toMatchObject({ update: 2, error: 0 });
    expect((await preview(xlsx)).counts).toMatchObject({ "skip-existing": 2, error: 0 });
  });
});
