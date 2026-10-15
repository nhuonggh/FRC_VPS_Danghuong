import type { Prisma, PrismaClient } from "@prisma/client";
import { formatDate } from "@/lib/format";
import { ictYmd } from "@/lib/time";
import { buildXlsx } from "@/server/export/xlsx";

type Db = Prisma.TransactionClient | PrismaClient;

/** Xuất phiên bản định mức đang hiệu lực (hoặc sớm nhất sắp hiệu lực) của từng cặp — cùng cột với file nhập để sửa rồi nhập lại. */
export async function exportBomXlsx(db: Db): Promise<Buffer> {
  const today = ictYmd(new Date());
  const boms = await db.bom.findMany({
    orderBy: [{ product: { code: "asc" } }, { processingType: { name: "asc" } }],
    select: {
      product: { select: { code: true, name: true } },
      processingType: { select: { name: true } },
      versions: { where: { status: "ACTIVE" }, orderBy: { validFrom: "asc" }, select: { validFrom: true, lines: { orderBy: { id: "asc" }, select: { qtyPerUnit: true, note: true, material: { select: { code: true } } } } } },
    },
  });
  const rows = boms.flatMap((b) => {
    const current = [...b.versions].reverse().find((v) => v.validFrom.toISOString().slice(0, 10) <= today) ?? b.versions[0];
    return (current?.lines ?? []).map((l) => ({ productCode: b.product.code, productName: b.product.name, processingType: b.processingType.name, validFrom: formatDate(current!.validFrom), material: l.material.code, qty: l.qtyPerUnit.toString(), note: l.note ?? "" }));
  });
  return buildXlsx("Định mức", [
    { header: "Mã thành phẩm", key: "productCode", width: 18, text: true }, { header: "Tên thành phẩm", key: "productName", width: 40 }, { header: "Kiểu gia công", key: "processingType", width: 22 },
    { header: "Ngày hiệu lực (dd/mm/yyyy)", key: "validFrom", width: 22, text: true }, { header: "Mã nguyên vật liệu", key: "material", width: 20, text: true }, { header: "Định mức / 1 đơn vị thành phẩm", key: "qty", width: 24 }, { header: "Ghi chú (tỷ lệ cũ, mùa, độ dày…)", key: "note", width: 40 },
  ], rows);
}
