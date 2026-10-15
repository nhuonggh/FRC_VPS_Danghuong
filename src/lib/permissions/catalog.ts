export interface PermissionDef {
  code: string;
  label: string;
  group: string;
  sensitive?: boolean;
}

// Nhóm 1 quyền = 1 khả năng có thể bật/tắt trong màn "Cấu hình nhóm quyền" (mục 3).
export const PERMISSIONS = [
  // Hệ thống
  { code: "user.view", label: "Xem người dùng", group: "Hệ thống" },
  { code: "user.manage", label: "Tạo/sửa/khoá tài khoản", group: "Hệ thống" },
  { code: "role.manage", label: "Cấu hình nhóm quyền", group: "Hệ thống" },
  { code: "audit.view", label: "Xem nhật ký thao tác", group: "Hệ thống" },
  { code: "company.manage", label: "Cấu hình công ty & mẫu in", group: "Hệ thống" },
  { code: "catalog.manage", label: "Quản lý danh mục nền", group: "Hệ thống" },
  { code: "period.close", label: "Kết sổ cuối kỳ", group: "Kỳ", sensitive: true },
  { code: "period.view_closed", label: "Tra cứu kỳ cũ", group: "Kỳ" },
  // Dữ liệu nhạy cảm — ẩn ở tầng server (T2)
  { code: "cost.view", label: "Xem giá vốn", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "profit.view", label: "Xem lãi/lỗ", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "purchase_price.view", label: "Xem giá nhập", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "sale_price.view", label: "Xem giá bán", group: "Dữ liệu nhạy cảm", sensitive: true },
  // Đối tác & sản phẩm
  { code: "partner.view", label: "Xem khách hàng/NCC (thiếu partner.view_all = chỉ khách của mình)", group: "Đối tác" },
  { code: "partner.view_all", label: "Xem mọi khách hàng (phạm vi dữ liệu)", group: "Đối tác" },
  { code: "partner.manage", label: "Thêm/sửa khách hàng, NCC", group: "Đối tác" },
  { code: "product.view", label: "Xem sản phẩm", group: "Sản phẩm" },
  { code: "product.manage", label: "Thêm/sửa sản phẩm", group: "Sản phẩm" },
  // Nhập hàng & kho
  { code: "purchase.view", label: "Xem phiếu nhập", group: "Nhập hàng" },
  { code: "purchase.create", label: "Lập phiếu nhập", group: "Nhập hàng" },
  { code: "purchase.edit", label: "Sửa phiếu nhập", group: "Nhập hàng" },
  { code: "purchase.cancel", label: "Hủy phiếu nhập", group: "Nhập hàng" },
  { code: "stock.view", label: "Xem sổ kho, tồn kho", group: "Kho" },
  { code: "stocktake.manage", label: "Kiểm kho", group: "Kho" },
  { code: "stock_adjust.manage", label: "Điều chỉnh hao hụt / xuất hủy", group: "Kho" },
  // Bán hàng
  { code: "order.view", label: "Xem đơn hàng", group: "Bán hàng" },
  { code: "order.create", label: "Tạo đơn hàng", group: "Bán hàng" },
  { code: "order.edit", label: "Sửa đơn hàng", group: "Bán hàng" },
  { code: "order.edit_price", label: "Sửa giá bán tay khi lập/sửa đơn (thiếu quyền = chỉ dùng giá gần nhất)", group: "Bán hàng" },
  { code: "order.cancel", label: "Hủy đơn hàng", group: "Bán hàng" },
  { code: "order.restore", label: "Khôi phục đơn đã hủy", group: "Bán hàng" },
  { code: "order.delete_draft", label: "Xóa hẳn đơn nháp/trùng", group: "Bán hàng" },
  { code: "quote.manage", label: "Báo giá", group: "Bán hàng" },
  { code: "deposit.manage", label: "Tiền cọc", group: "Bán hàng" },
  // Giao hàng
  { code: "trip.manage", label: "Xếp chuyến, nhập kết quả giao", group: "Giao hàng" },
  { code: "trip.settle", label: "Đối soát lái xe", group: "Giao hàng" },
  { code: "trip.confirm_cash", label: "Thủ quỹ xác nhận nhận tiền", group: "Giao hàng" },
  { code: "return.manage", label: "Trả hàng", group: "Trả hàng" },
  // Sản xuất
  { code: "production.manage", label: "Lệnh sản xuất phụ kiện", group: "Sản xuất" },
  { code: "processing.manage", label: "Gia công thuê", group: "Sản xuất" },
  { code: "bom.manage", label: "Định mức NVL", group: "Sản xuất" },
  // Kế toán
  { code: "receipt.manage", label: "Phiếu thu", group: "Kế toán" },
  { code: "payment.manage", label: "Phiếu chi", group: "Kế toán" },
  { code: "cashbook.view", label: "Sổ quỹ, sổ tiền gửi", group: "Kế toán" },
  // Quỹ chung hậu kiểm (plan 05 D-34): kế toán lập trước, thủ quỹ kiểm sau
  { code: "cash.transaction.create", label: "Lập phiếu thu/chi", group: "Quỹ" },
  { code: "cash.transaction.edit_pending", label: "Sửa/hủy phiếu thu/chi chưa kiểm tra", group: "Quỹ" },
  { code: "cash.review", label: "Kiểm tra / trả lại phiếu thu-chi", group: "Quỹ", sensitive: true },
  { code: "cash.adjust.request", label: "Yêu cầu điều chỉnh phiếu đã kiểm tra", group: "Quỹ" },
  { code: "cash.adjust.approve", label: "Duyệt điều chỉnh phiếu đã kiểm tra", group: "Quỹ", sensitive: true },
  { code: "cash.close", label: "Chốt quỹ", group: "Quỹ", sensitive: true },
  { code: "cash.close.reopen", label: "Hủy chốt quỹ", group: "Quỹ", sensitive: true },
  { code: "debt.view", label: "Xem công nợ", group: "Kế toán" },
  { code: "debt.adjust", label: "Điều chỉnh/gộp công nợ", group: "Kế toán" },
  { code: "discount.settle", label: "Tất toán chiết khấu tích lũy", group: "Kế toán" },
  { code: "discount.reconcile", label: "Hậu kiểm chiết khấu tích lũy", group: "Kế toán" },
  { code: "expense.manage", label: "Chi phí hoạt động", group: "Kế toán" },
  // Báo cáo, in, dữ liệu
  { code: "report.view", label: "Xem báo cáo quản trị", group: "Báo cáo" },
  { code: "print.use", label: "In chứng từ", group: "In ấn" },
  { code: "data.import", label: "Nhập/chuyển dữ liệu", group: "Dữ liệu" },
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

// Tên field trong DTO → quyền cần có để được thấy. Mỗi domain BỔ SUNG field của mình ở đây
// (plan module nào thêm field nhạy cảm thì thêm dòng vào bảng này + test ở module đó).
// QUY ƯỚC: redact chạy theo TÊN field, nên giá trị nhạy cảm KHÔNG BAO GIỜ được trả dưới tên chung chung
// (price, unitPrice, amount, total...) — luôn dùng tên riêng (salePrice, unitCostFifo, lineProfit...) rồi
// đăng ký ở đây. Xem docs/conventions/sensitive-data.md.
export const SENSITIVE_FIELDS: Record<string, PermissionCode> = {
  unitCostFifo: "cost.view",
  materialCost: "cost.view",
  unitCostOut: "cost.view",
  costAmount: "cost.view",
  lineProfit: "profit.view",
  orderProfit: "profit.view",
  profit: "profit.view",
  unitCost: "cost.view",
  costPrice: "cost.view",
  stockValue: "cost.view",
  margin: "profit.view",
  grossProfit: "profit.view",
  purchasePrice: "purchase_price.view",
  lastPurchasePrice: "purchase_price.view",
  purchaseAmount: "purchase_price.view",
  purchaseTotal: "purchase_price.view",
  freightCost: "purchase_price.view",
  allocatedFreight: "purchase_price.view",
  openingValue: "cost.view",
  inValue: "cost.view",
  outValue: "cost.view",
  closingValue: "cost.view",
  salePrice: "sale_price.view",
  lastSalePrice: "sale_price.view",
  discountNow: "sale_price.view",
  discountAccum: "sale_price.view",
  lineAmount: "sale_price.view",
  orderTotal: "sale_price.view",
  oldDebt: "debt.view",
  totalPayable: "debt.view",
  quoteTotal: "sale_price.view",
  returnTotal: "sale_price.view",
  returnDeduction: "sale_price.view",
  refundAmount: "sale_price.view",
};

type RoleSpec = "*" | { allow: readonly PermissionCode[] } | { except: readonly PermissionCode[] };

// Phân quyền MẪU (spec 6.6) — khách tự chỉnh được sau. `// TODO: confirm` với khách chi tiết từng vai trò.
export const ROLE_DEFAULTS: Record<string, RoleSpec> = {
  "Giám đốc": "*",
  "Kế toán": { except: ["period.close", "user.manage", "role.manage", "cash.review", "cash.adjust.approve", "cash.close", "cash.close.reopen", "trip.confirm_cash"] },
  "Thủ kho": {
    allow: ["product.view", "stock.view", "stocktake.manage", "stock_adjust.manage", "order.view", "print.use"],
  },
  "Thủ quỹ": {
    allow: [
      "partner.view", "partner.view_all", "cashbook.view", "receipt.manage", "payment.manage", "trip.confirm_cash",
      "cash.transaction.create", "cash.transaction.edit_pending", "cash.review", "cash.adjust.request", "cash.adjust.approve", "cash.close",
      "debt.view", "order.view", "sale_price.view", "print.use",
    ],
  },
  "Bán hàng": {
    allow: [
      "partner.view", "product.view", "order.view", "order.create", "order.edit", "order.edit_price", "quote.manage", "deposit.manage",
      "sale_price.view", "stock.view", "return.manage", "print.use",
    ],
  },
};

export function resolveRolePermissions(role: string): Set<string> {
  const spec = ROLE_DEFAULTS[role];
  if (!spec) throw new Error(`Vai trò không có trong ROLE_DEFAULTS: ${role}`);
  if (spec === "*") return new Set<string>(ALL_PERMISSION_CODES);
  if ("allow" in spec) return new Set<string>(spec.allow);
  const banned = new Set<string>(spec.except);
  return new Set<string>(ALL_PERMISSION_CODES.filter((c) => !banned.has(c)));
}
