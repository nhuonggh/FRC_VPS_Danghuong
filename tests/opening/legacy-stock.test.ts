import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { commitImport, previewImport } from "@/server/import/framework";
import { getOnHand } from "@/server/inventory";
import { openingLegacyStockSpec } from "@/server/opening/legacy-stock";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";
import { newWorld, useNoopCostOwners, type World } from "../inventory/helpers";

useNoopCostOwners();
let w: World; let seq = 0;
const staff: Actor = { userId: 0, perms: new Set(["data.import"]) };
// Định dạng thật của phần mềm cũ: HTML đổi đuôi .xls, có dòng tên báo cáo phía trên dòng tiêu đề.
const legacyFile = (rows: [string, string, string][]) => Buffer.from(`<table border="1"><thead><tr><th colspan="4">ĐỊNH MỨC TỒN</th></tr><tr><th>STT</th><th>Tên sản phẩm</th><th>Số lượng còn</th><th>Định mức tồn kho</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table>`, "utf8");
const spec = (kind: "stock" | "material" = "stock", updateMinStock = false) => openingLegacyStockSpec(kind, { actor: staff, force: false, updateMinStock });
const run = (s: ReturnType<typeof spec>, buf: Buffer) => commitImport(prisma, staff, s, buf, { overwrite: false, idempotencyKey: `k-${++seq}` });

beforeEach(async () => { await resetDb(); w = await newWorld(1); staff.userId = w.userId; });

describe("Nhập tồn đầu kỳ từ tệp phần mềm cũ", () => {
  it("khớp theo tên không dấu/hoa thường, giá vốn = giá nhập mặc định, số lượng thập phân dạng 4220.0000", async () => {
    const a = await makeProduct({ code: "HM1", name: "Hộp mạ kẽm 25*50*1.1", purchasePrice: "18500" });
    const buf = legacyFile([["hop ma kem 25*50*1.1", "4220.0000", "750.0000"]]);
    const pv = await previewImport(prisma, spec(), buf, { overwrite: false });
    expect(pv.counts.create).toBe(1);
    expect((await run(spec(), buf)).created).toBe(1);
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("4220");
    expect((await prisma.costLayer.findFirstOrThrow({ where: { productId: a.id } })).unitCost.toString()).toBe("18500");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).minStock.toString()).toBe("0"); // không tích tuỳ chọn ⇒ định mức không đổi
  });

  it("thiếu giá nhập: vẫn nhập với giá vốn 0 và có cảnh báo trong bản xem trước", async () => {
    const a = await makeProduct({ code: "NG1", name: "Nhôm gỗ cỏ" });
    const buf = legacyFile([["Nhôm gỗ cỏ", "149.5500", ""]]);
    const pv = await previewImport(prisma, spec(), buf, { overwrite: false });
    expect(pv.rows[0]!.status).toBe("create"); expect(pv.rows[0]!.message).toContain("CẢNH BÁO");
    await run(spec(), buf);
    expect((await prisma.costLayer.findFirstOrThrow({ where: { productId: a.id } })).unitCost.toString()).toBe("0");
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("149.55");
  });

  it("tên không khớp ⇒ lỗi; tồn 0 không có trong danh mục ⇒ bỏ qua; tên trùng nhiều mã ⇒ lỗi; hàng/NVL tách theo màn", async () => {
    await makeProduct({ code: "T1", name: "Trùng tên" }); await makeProduct({ code: "T2", name: "Trùng tên" });
    await makeProduct({ code: "H1", name: "Hàng A", purchasePrice: "10" }); await makeProduct({ code: "N1", name: "Vật liệu B", kind: "NVL", purchasePrice: "5" });
    const buf = legacyFile([["Không có", "5", ""], ["Không có 2", "0", ""], ["Trùng tên", "3", ""], ["Hàng A", "2", ""], ["Vật liệu B", "7", ""]]);
    const pv = await previewImport(prisma, spec("stock"), buf, { overwrite: false });
    expect(pv.counts).toMatchObject({ error: 2, "skip-reason": 2, create: 1 });
    const pm = await previewImport(prisma, spec("material"), buf, { overwrite: false });
    expect(pm.counts.create).toBe(1);
    expect(pm.rows.find((r) => r.status === "create")!.summary).toContain("Vật liệu B");
  });

  it("tuỳ chọn Định mức tồn: bật ⇒ ghi đè + hiện cũ→mới; dòng tồn 0 vẫn cập nhật định mức mà không tạo lô", async () => {
    const a = await makeProduct({ code: "D1", name: "Đinh", purchasePrice: "100", minStock: "5" });
    const b = await makeProduct({ code: "D2", name: "Vít" });
    const buf = legacyFile([["Đinh", "10", "750.0000"], ["Vít", "0", "20"]]);
    const pv = await previewImport(prisma, spec("stock", true), buf, { overwrite: false });
    expect(pv.counts.create).toBe(2); expect(pv.rows.find((r) => r.summary.includes("Đinh"))!.message).toContain("5 → 750");
    await run(spec("stock", true), buf);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).minStock.toString()).toBe("750");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).minStock.toString()).toBe("20");
    expect(await prisma.openingStock.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "opening.stock.min-stock" } })).toBe(2);
  });

  it("từ chối tệp HTML thiếu cột bắt buộc", async () => {
    await expect(previewImport(prisma, spec(), Buffer.from("<table><tr><th>A</th><th>B</th></tr></table>"), { overwrite: false })).rejects.toThrow(/Thiếu cột/);
  });
});

describe("Nhập tồn từ phần mềm cũ: sản phẩm ngừng bán", () => {
  it("trùng tên nhưng chỉ 1 bản đang hoạt động ⇒ khớp bản đó; chỉ còn bản ngừng bán ⇒ lỗi rõ ràng", async () => {
    const live = await makeProduct({ code: "A1", name: "Tôn lạnh", purchasePrice: "10" }); const dead = await makeProduct({ code: "A2", name: "Tôn lạnh" });
    await prisma.product.update({ where: { id: dead.id }, data: { isActive: false } });
    const gone = await makeProduct({ code: "B1", name: "Chỉ ngừng bán" }); await prisma.product.update({ where: { id: gone.id }, data: { isActive: false } });
    const pv = await previewImport(prisma, spec(), legacyFile([["Tôn lạnh", "4", ""], ["Chỉ ngừng bán", "3", ""]]), { overwrite: false });
    expect(pv.rows.find((r) => r.summary.includes("Tôn lạnh"))!.status).toBe("create");
    const bad = pv.rows.find((r) => r.summary.includes("Chỉ ngừng bán"))!; expect(bad.status).toBe("error"); expect(bad.message).toContain("ngừng bán");
    await run(spec(), legacyFile([["Tôn lạnh", "4", ""]]));
    expect((await getOnHand(prisma, w.periodId, live.id)).toString()).toBe("4");
  });
});
