import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { CATALOG_SECTIONS } from "@/config/catalog-sections";
import { catalogImportSpec } from "@/server/catalog/import-spec";
import { commitImport, previewImport } from "@/server/import/framework";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { toXlsx } from "../../scripts/lib/customer-data";

let actor: Actor; let seq = 0;
const commit = (key: string, buf: Buffer, overwrite = false) => commitImport(prisma, actor, catalogImportSpec(key), buf, { overwrite, idempotencyKey: `c-${++seq}` });
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["data.import", "catalog.manage"]) }; });

describe("nhập Excel Cài đặt danh mục", () => {
  it("mọi mục đều có spec + mẫu nhập", () => { for (const s of CATALOG_SECTIONS) expect(catalogImportSpec(s.key).columns.length).toBeGreaterThan(0); });

  it("kho: tạo mới, bỏ dòng ví dụ, báo trùng trong tệp và trùng không phân biệt hoa/thường/dấu", async () => {
    await prisma.warehouse.create({ data: { name: "Kho Chính" } });
    const buf = await toXlsx(["Tên kho"], [["# Kho ví dụ"], ["Kho I"], ["kho i"], ["kho chinh"], [""]]);
    const pv = await previewImport(prisma, catalogImportSpec("warehouses"), buf, { overwrite: false });
    expect(pv.counts).toMatchObject({ create: 1, error: 1, "skip-existing": 1 });
    expect((await commit("warehouses", buf)).created).toBe(1);
    expect(await prisma.warehouse.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "import.Warehouse" } })).toBe(1);
  });

  it("xe: chuẩn hoá biển số (bỏ khoảng trắng, in hoa) và so trùng theo biển đã chuẩn hoá", async () => {
    await prisma.vehicle.create({ data: { plate: "29C-35396" } });
    const res = await commit("vehicles", await toXlsx(["Biển số"], [["29c-35396 "], ["22C 01672"]]));
    expect(res).toMatchObject({ created: 1, skippedExisting: 1 });
    expect((await prisma.vehicle.findMany({ orderBy: { id: "asc" } })).map((v) => v.plate)).toEqual(["29C-35396", "22C01672"]);
  });

  it("lái xe: cột Là phụ xe nhận Có/Không, giá trị lạ bị báo lỗi", async () => {
    const buf = await toXlsx(["Họ tên", "Là phụ xe"], [["Bùi Văn Huỳnh", "Có"], ["Phạm Văn Hoàng", null], ["Nguyễn A", "có thể"]]);
    const res = await commit("drivers", buf);
    expect(res.created).toBe(2); expect(res.failed).toBe(1);
    expect(await prisma.driver.findFirstOrThrow({ where: { name: "Bùi Văn Huỳnh" } })).toMatchObject({ isAssistant: true });
    expect(await prisma.driver.findFirstOrThrow({ where: { name: "Phạm Văn Hoàng" } })).toMatchObject({ isAssistant: false });
  });

  it("ngân hàng & quỹ: suy ra loại từ số tài khoản khi để trống, số tài khoản dạng số vẫn nhận, loại lạ báo lỗi", async () => {
    const buf = await toXlsx(["Tên tài khoản", "Loại", "Số tài khoản"], [["Tiền mặt", "Tiền mặt", null], ["MB", null, 12345], ["Agribank", "Ngân hàng", "6789"], ["Ví", "Momo", null]]);
    const res = await commit("cash-accounts", buf);
    expect(res).toMatchObject({ created: 3, failed: 1 });
    expect(await prisma.cashAccount.findUniqueOrThrow({ where: { name: "MB" } })).toMatchObject({ type: "BANK", bankNo: "12345" });
    expect(await prisma.cashAccount.findUniqueOrThrow({ where: { name: "Tiền mặt" } })).toMatchObject({ type: "CASH", bankNo: null });
  });

  it("kiểu gia công: tỷ lệ/trừ kho/ĐVT gộp vào Ghi chú; ghi đè không xoá ghi chú khi ô trống", async () => {
    await commit("processing-types", await toXlsx(["Tên kiểu gia công", "Ghi chú", "Tỷ lệ", "Tỷ lệ trừ kho", "ĐVT"], [["Tôn xốp 6S", null, 1.07, 1, "m2"]]));
    expect((await prisma.processingType.findUniqueOrThrow({ where: { name: "Tôn xốp 6S" } })).note).toBe("Tỷ lệ 1,07 · Trừ kho 1 · ĐVT m2");
    const res = await commit("processing-types", await toXlsx(["Tên kiểu gia công", "Ghi chú"], [["Tôn xốp 6S", null]]), true);
    expect(res.updated).toBe(1);
    expect((await prisma.processingType.findUniqueOrThrow({ where: { name: "Tôn xốp 6S" } })).note).toBe("Tỷ lệ 1,07 · Trừ kho 1 · ĐVT m2");
  });

  it("chạy lại cùng tệp + cùng Idempotency-Key không nhân đôi", async () => {
    const buf = await toXlsx(["Tên tuyến"], [["Phú Lương"], ["Văn Sơn"]]);
    const spec = catalogImportSpec("routes"); const idem = { overwrite: false, idempotencyKey: "same" };
    await commitImport(prisma, actor, spec, buf, idem); await commitImport(prisma, actor, spec, buf, idem);
    expect(await prisma.route.count()).toBe(2);
  });
});
