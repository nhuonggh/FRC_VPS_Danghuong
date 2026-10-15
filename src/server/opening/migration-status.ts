import type { Prisma, PrismaClient } from "@prisma/client";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;
export interface MigrationStep { key: string; order: number; title: string; hint: string; href: string; count: number; unit: string }

/** Hiện trạng chuyển dữ liệu D1–D4 + số đầu kỳ, theo THỨ TỰ nên làm (mỗi bước dựa vào bước trước). */
export async function migrationStatus(db: Db): Promise<{ steps: MigrationStep[]; periodName: string; hasDocs: boolean }> {
  const p = await getOpenPeriod(db); const where = { periodId: p.id };
  const [period, customers, suppliers, products, boms, oStock, oMat, oDebt, oCash, oDisc, groups, cash, sStock, sPartner, sCash, sOrders, sPurch] = await Promise.all([
    db.period.findUniqueOrThrow({ where: { id: p.id }, select: { name: true } }),
    db.partner.count({ where: { isCustomer: true } }), db.partner.count({ where: { isSupplier: true } }),
    db.product.count(), db.bom.count(),
    db.openingStock.count({ where: { ...where, product: { kind: { not: "NVL" } } } }), db.openingStock.count({ where: { ...where, product: { kind: "NVL" } } }),
    db.openingDebt.count({ where }), db.openingCash.count({ where }), db.openingDiscount.count({ where }),
    db.partnerGroup.count(), db.cashAccount.count(),
    db.stockLedger.count({ where: { ...where, NOT: { docType: "OPENING" } } }), db.partnerLedger.count({ where }), db.cashLedger.count({ where }), db.saleOrder.count({ where }), db.purchase.count({ where }),
  ]);
  const steps: MigrationStep[] = [
    { key: "catalog", order: 1, title: "Danh mục nền", hint: "Nhóm khách, kho, xe, quỹ/tài khoản ngân hàng, loại chi phí — phải có trước khi nhập khách và số dư quỹ.", href: "/system/catalog-settings", count: groups + cash, unit: "mục" },
    { key: "customers", order: 2, title: "Khách hàng (D1)", hint: "Nhập Excel: Mã, Tên, Nhóm, SĐT, Địa chỉ, Hạn mức nợ, Cho ghi nợ.", href: "/sales/customers", count: customers, unit: "khách" },
    { key: "suppliers", order: 3, title: "Nhà cung cấp (D1)", hint: "Cùng định dạng với khách hàng.", href: "/purchase/suppliers", count: suppliers, unit: "NCC" },
    { key: "products", order: 4, title: "Sản phẩm (D2)", hint: "Mã trùng/lỗi được tách ra tệp riêng để khách xác nhận; ngừng bán để cột Ngừng bán = Có.", href: "/inventory/products", count: products, unit: "mã" },
    { key: "bom", order: 5, title: "Định mức tôn xốp", hint: "Nhập tay ở màn Định mức theo độ dày/mùa (chưa có Excel).", href: "/production/bom", count: boms, unit: "định mức" },
    { key: "stock", order: 6, title: "Tồn kho đầu kỳ + giá vốn (D4)", hint: "Hàng hóa/thành phẩm/phụ kiện, tại ngày chốt.", href: "/period/opening-stock", count: oStock, unit: "mã" },
    { key: "material", order: 7, title: "Tồn NVL đầu kỳ (D4)", hint: "Nguyên vật liệu, tại ngày chốt.", href: "/period/opening-materials", count: oMat, unit: "mã" },
    { key: "debt", order: 8, title: "Công nợ đầu kỳ (D3)", hint: "Khách (+) và NCC (−) tại ngày chốt.", href: "/period/opening-debt", count: oDebt, unit: "đối tác" },
    { key: "cash", order: 9, title: "Số dư quỹ đầu kỳ", hint: "Tiền mặt và từng tài khoản ngân hàng.", href: "/period/opening-cash", count: oCash, unit: "quỹ" },
    { key: "discount", order: 10, title: "Chiết khấu tích lũy đầu kỳ", hint: "Số công ty còn nợ từng khách.", href: "/period/opening-discount", count: oDisc, unit: "khách" },
  ];
  return { steps, periodName: period.name, hasDocs: sStock + sPartner + sCash + sOrders + sPurch > 0 };
}
