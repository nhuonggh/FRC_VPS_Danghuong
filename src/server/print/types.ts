import type { PermissionCode } from "@/lib/permissions/catalog";

/**
 * 13 mẫu in (M1–M13) + phiếu chuyến, tất cả in trực tiếp bằng HTML (không còn Apps Script). `docType` trùng với `print_templates.docType` (mã loại chứng từ khách cấu hình ở Hệ thống → Công ty & mẫu in).
 * Data contract có `version` — đổi cấu trúc JSON gửi đi phải tăng CONTRACT_VERSION và cập nhật docs/infra/print/README.md + apps-script.gs.
 */
export const CONTRACT_VERSION = 1;

export interface PrintDocDef { docType: string; code: string; label: string; perm: PermissionCode; fileTag: string; supported: boolean }
export const PRINT_DOCS: readonly PrintDocDef[] = [
  { docType: "SALE_INVOICE", code: "M1", label: "Hóa đơn bán hàng", perm: "sale_price.view", fileTag: "HoaDon", supported: true },
  { docType: "QUOTE", code: "M2", label: "Báo giá", perm: "sale_price.view", fileTag: "BaoGia", supported: true },
  { docType: "DELIVERY_NOTE", code: "M3", label: "Phiếu giao nhận", perm: "order.view", fileTag: "PhieuGiao", supported: true },
  { docType: "RECEIPT", code: "M4", label: "Phiếu thu", perm: "receipt.manage", fileTag: "PhieuThu", supported: true },
  { docType: "PAYMENT", code: "M5", label: "Phiếu chi", perm: "payment.manage", fileTag: "PhieuChi", supported: true },
  { docType: "PRODUCTION_ORDER", code: "M6", label: "Lệnh sản xuất", perm: "production.manage", fileTag: "LenhSX", supported: true },
  { docType: "DEBT_STATEMENT", code: "M7", label: "Đối chiếu công nợ", perm: "debt.view", fileTag: "DoiChieuCongNo", supported: true },
  { docType: "PURCHASE_RECEIPT", code: "M8", label: "Phiếu nhập hàng", perm: "purchase_price.view", fileTag: "PhieuNhap", supported: true },
  { docType: "STOCKTAKE", code: "M9", label: "Phiếu kiểm kho", perm: "stocktake.manage", fileTag: "KiemKho", supported: true },
  { docType: "GOODS_RETURN", code: "M10", label: "Phiếu trả hàng", perm: "return.manage", fileTag: "PhieuTra", supported: true },
  { docType: "LOSS_ADJUST", code: "M11", label: "Phiếu hao hụt / xuất hủy", perm: "stock_adjust.manage", fileTag: "HaoHut", supported: true },
  { docType: "DISCOUNT_SETTLEMENT", code: "M12", label: "Phiếu tất toán chiết khấu", perm: "discount.settle", fileTag: "TatToanCK", supported: true },
  { docType: "SUPPLIER_ORDER", code: "M13", label: "Đơn đặt hàng nhà cung cấp", perm: "purchase_price.view", fileTag: "DatHangNCC", supported: true },
  { docType: "TRIP_SHEET", code: "M3b", label: "Phiếu giao nhận theo chuyến", perm: "trip.manage", fileTag: "PhieuChuyen", supported: true },
] as const;
export const printDoc = (docType: string) => PRINT_DOCS.find((d) => d.docType === docType);

/** JSON gửi tới Apps Script. Mọi số/ngày đã định dạng kiểu Việt Nam (chuỗi) để placeholder trong Google Doc dùng thẳng. */
export interface PrintPayload {
  version: number;
  /** Secret của mẫu (chỉ nằm trong body gửi đi — không log, không audit, không trả về client). */
  secret: string;
  action: "create";
  docType: string;
  docId: number;
  docCode: string;
  fileName: string;
  /** File bản in cũ của chứng từ này (in lại ⇒ Apps Script chuyển vào thùng rác). */
  replaceFileId: string | null;
  template: { title: string; signerName: string; phone: string; qrImage: string; footerNote: string };
  company: { name: string; address: string; phone: string; taxCode: string; logo: string; bank: { bankName: string; accountNo: string; accountHolder: string; branch: string } } | null;
  partner: { code: string; name: string; phone: string; address: string } | null;
  doc: Record<string, string>;
  lines: Record<string, string>[];
  totals: Record<string, string>;
}
export type ContractBody = Pick<PrintPayload, "docCode" | "partner" | "doc" | "lines" | "totals">;

/** Có in được loại chứng từ này không: cần `print.use` và quyền xem chứng từ (giá/tiền) tương ứng. */
export const canPrintDoc = (perms: ReadonlySet<string>, docType: string): boolean => {
  const d = printDoc(docType);
  return !!d && d.supported && perms.has("print.use") && perms.has(d.perm);
};
