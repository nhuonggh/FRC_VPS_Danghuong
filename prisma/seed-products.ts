import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
// KHÔNG import zod/exceljs/service: image migrator chỉ có prisma + @prisma/client + tsx + bcryptjs (Dockerfile stage migrator)
import { normalizeSearch } from "../src/lib/search";

/** Dữ liệu đóng gói bởi scripts/build-product-sync.ts từ file khách "OK ds_sanpham.xlsx". */
export interface ProductSync {
  version: 1;
  units: { name: string }[]; productGroups: { name: string }[];
  processingTypes: { name: string; ratio: number | null; stockRatio: number | null; unit: string | null }[];
  products: { code: string; name: string; group: string | null; baseUnit: string | null; qtyLabel: string | null; kind: "HANG" | "NVL" | "THANH_PHAM" | "PHU_KIEN"; weight: string | null; processing: string[] }[];
}
export const DEFAULT_SYNC_FILE = path.join(process.cwd(), "prisma", "data", "product-sync.json");

/**
 * Đồng bộ danh mục sản phẩm theo file khách: nhóm hàng, đơn vị tính, kiểu gia công (tỷ lệ / tỷ lệ trừ kho / ĐVT), nhóm + loại + tên số lượng của sản phẩm,
 * tỷ trọng (đơn vị quy đổi) và kiểu gia công của từng sản phẩm. CHỈ chạy MỘT lần: khi chưa có dòng gắn kiểu gia công nào (product_processing_ratios trống);
 * sau đó người dùng sửa/xoá tay không bị deploy sau ghi đè. Không đụng đơn vị gốc, không đụng sản phẩm có sẵn đơn vị quy đổi. Trả `false` nếu bỏ qua.
 */
export async function seedProductSync(prisma: PrismaClient, opts: { file?: string; log?: (msg: string) => void } = {}): Promise<boolean> {
  const log = opts.log ?? (() => undefined); const file = opts.file ?? DEFAULT_SYNC_FILE;
  if (!existsSync(file)) { log("Đồng bộ sản phẩm: không có file — bỏ qua"); return false; }
  const data = JSON.parse(readFileSync(file, "utf8")) as ProductSync;
  if (data.version !== 1) throw new Error(`product-sync.json: phiên bản ${String(data.version)} không hỗ trợ`);
  if ((await prisma.productProcessingRatio.count()) > 0) { log("Đồng bộ sản phẩm: đã đồng bộ trước đó — bỏ qua"); return false; }
  const user = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
  if (!user) { log("Đồng bộ sản phẩm: chưa có người dùng — bỏ qua"); return false; }

  await prisma.$transaction(async (tx) => {
    await tx.unit.createMany({ data: data.units, skipDuplicates: true });
    await tx.productGroup.createMany({ data: data.productGroups, skipDuplicates: true });

    const existingTypes = new Map((await tx.processingType.findMany({ select: { id: true, name: true } })).map((t) => [normalizeSearch(t.name), t.id]));
    for (const t of data.processingTypes) {
      const fields = { ratio: t.ratio === null ? null : new Prisma.Decimal(t.ratio), stockRatio: t.stockRatio === null ? null : new Prisma.Decimal(t.stockRatio), unit: t.unit };
      const id = existingTypes.get(normalizeSearch(t.name));
      if (id) await tx.processingType.update({ where: { id }, data: fields });
      else existingTypes.set(normalizeSearch(t.name), (await tx.processingType.create({ data: { name: t.name, ...fields } })).id);
    }

    const products = new Map((await tx.product.findMany({ select: { id: true, code: true, kind: true, _count: { select: { units: true } } } })).map((p) => [p.code, p]));
    const groups = new Map((await tx.productGroup.findMany()).map((g) => [g.name, g.id]));
    const byGroup = new Map<number, number[]>(); const byLabel = new Map<string, number[]>(); const byKind = new Map<string, number[]>();
    const push = <K>(m: Map<K, number[]>, k: K, id: number) => m.set(k, [...(m.get(k) ?? []), id]);
    const convs: { productId: number; unit: string; factor: Prisma.Decimal }[] = []; const links: { productId: number; processingTypeId: number; ratio: null; updatedBy: number }[] = [];
    let missing = 0, unknownType = 0;
    for (const p of data.products) {
      const row = products.get(p.code); if (!row) { missing++; continue; }
      const gid = p.group ? groups.get(p.group) : undefined; if (gid) push(byGroup, gid, row.id);
      if (p.qtyLabel) push(byLabel, p.qtyLabel, row.id);
      if (p.kind !== row.kind) push(byKind, p.kind, row.id);
      if (p.weight && row._count.units === 0) {
        const w = Number(p.weight); const base = (p.baseUnit ?? "").toLowerCase();
        // Tỷ trọng = kg trên 1 đơn vị gốc; hàng bán theo kg thì ngược lại: số cây trên 1 kg.
        convs.push(base === "kg" ? { productId: row.id, unit: "cây", factor: new Prisma.Decimal(1).div(w).toDecimalPlaces(6) } : { productId: row.id, unit: "kg", factor: new Prisma.Decimal(w) });
      }
      for (const name of p.processing) { const tid = existingTypes.get(normalizeSearch(name)); if (tid) links.push({ productId: row.id, processingTypeId: tid, ratio: null, updatedBy: user.id }); else unknownType++; }
    }
    for (const [gid, ids] of byGroup) await tx.product.updateMany({ where: { id: { in: ids } }, data: { groupId: gid } });
    for (const [label, ids] of byLabel) await tx.product.updateMany({ where: { id: { in: ids } }, data: { qtyLabel: label } });
    for (const [kind, ids] of byKind) await tx.product.updateMany({ where: { id: { in: ids } }, data: { kind: kind as "HANG" | "NVL" | "THANH_PHAM" | "PHU_KIEN" } });
    await tx.productUnit.createMany({ data: convs, skipDuplicates: true });
    await tx.productProcessingRatio.createMany({ data: links, skipDuplicates: true });
    log(`Đồng bộ sản phẩm: ${data.processingTypes.length} kiểu gia công, ${convs.length} tỷ trọng, ${links.length} liên kết sản phẩm × kiểu gia công, ${[...byGroup.values()].flat().length} gán nhóm${missing ? `, ${missing} mã không có trong DB` : ""}${unknownType ? `, ${unknownType} kiểu lạ` : ""}`);
  }, { timeout: 120_000 });
  return true;
}
