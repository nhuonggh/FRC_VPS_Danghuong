import type { PermissionCode } from "@/lib/permissions/catalog";

export type ViewKind = "table" | "card" | "kanban" | "calendar" | "dashboard" | "tree" | "catalog" | "form" | "report";

export interface NavFunction {
  key: string;
  label: string;
  desc: string;
  icon: string;
  view: ViewKind;
  path: string;
  /** Mã phạm vi (spec Phần 7). Code không truy được về một mã thì không viết. */
  codes: readonly string[];
  perm?: PermissionCode;
  /** Chưa làm: ẩn khỏi menu. Plan của module bỏ cờ này khi giao. */
  planned?: boolean;
}

export interface NavCategory {
  key: string;
  label: string;
  functions: readonly NavFunction[];
}

export interface NavModule {
  key: string;
  label: string;
  icon: string;
  type: "flat" | "accordion";
  /** Chỉ module flat. */
  path?: string;
  /** Mã phạm vi của module flat (Trang chủ = 7). */
  codes?: readonly string[];
  perm?: PermissionCode;
  categories: readonly NavCategory[];
}

const P = true; // planned

// Thứ tự = luồng nghiệp vụ thực tế, KHÔNG alphabet (navigation-model.md).
export const APP_NAV: readonly NavModule[] = [
  { key: "home", label: "Trang chủ", icon: "home", type: "flat", path: "/", codes: ["7"], categories: [] },

  {
    key: "sales", label: "Bán hàng", icon: "shopping-cart", type: "accordion",
    categories: [
      {
        key: "orders", label: "Đơn hàng",
        functions: [
          { key: "order-new", label: "Bán hàng", desc: "Lập đơn, chiết khấu, xuất kho FIFO", icon: "shopping-cart", view: "form", path: "/sales/orders/new", codes: ["31"], perm: "order.create", planned: P },
          { key: "order-list", label: "Danh sách đơn", desc: "Đơn theo 2 trục trạng thái giao hàng & thanh toán", icon: "receipt", view: "table", path: "/sales/orders", codes: ["32", "33"], perm: "order.view", planned: P },
          { key: "order-deleted", label: "Đơn đã xóa", desc: "Xem, khôi phục đơn đã hủy", icon: "trash-2", view: "table", path: "/sales/orders-deleted", codes: ["34", "34a", "34b", "34c"], perm: "order.restore", planned: P },
          { key: "quote-list", label: "Báo giá", desc: "Lập báo giá, chuyển thành đơn", icon: "file-text", view: "table", path: "/sales/quotes", codes: ["35"], perm: "quote.manage", planned: P },
          { key: "deposit-list", label: "Tiền cọc", desc: "Quản lý tiền cọc của đơn", icon: "hand-coins", view: "table", path: "/sales/deposits", codes: ["36"], perm: "deposit.manage", planned: P },
          { key: "delivery-note-list", label: "Phiếu xuất / giao", desc: "Giao hàng nhiều lần cho một đơn", icon: "package", view: "table", path: "/sales/delivery-notes", codes: ["37"], perm: "order.view", planned: P },
        ],
      },
      {
        key: "customers", label: "Khách hàng",
        functions: [
          { key: "customer-list", label: "Khách hàng", desc: "Hồ sơ, hạn mức nợ, người phụ trách", icon: "users", view: "table", path: "/sales/customers", codes: ["9"], perm: "partner.view" },
        ],
      },
    ],
  },

  {
    key: "delivery", label: "Giao hàng", icon: "truck", type: "accordion",
    categories: [
      {
        key: "trips", label: "Chuyến giao",
        functions: [
          { key: "trip-new", label: "Xếp chuyến", desc: "Gom đơn theo tuyến, gán xe + lái + phụ, in phiếu giao", icon: "truck", view: "form", path: "/delivery/trips/new", codes: ["38"], perm: "trip.manage", planned: P },
          { key: "trip-list", label: "Danh sách chuyến", desc: "Chuyến theo trạng thái", icon: "clipboard-list", view: "table", path: "/delivery/trips", codes: ["39"], perm: "trip.manage", planned: P },
          { key: "trip-result", label: "Nhập kết quả giao", desc: "Trạng thái + tiền mặt + chuyển khoản + ghi nợ", icon: "list-checks", view: "form", path: "/delivery/results", codes: ["40"], perm: "trip.manage", planned: P },
          { key: "trip-settle", label: "Đối soát lái xe", desc: "Đối soát tiền, thủ quỹ xác nhận", icon: "scale", view: "table", path: "/delivery/settlements", codes: ["41"], perm: "trip.settle", planned: P },
          { key: "undelivered", label: "Hàng không giao được", desc: "Nhập lại kho, giao người bán xử lý", icon: "undo-2", view: "table", path: "/delivery/undelivered", codes: ["42"], perm: "trip.manage", planned: P },
        ],
      },
    ],
  },

  {
    key: "purchase", label: "Nhập hàng", icon: "package-plus", type: "accordion",
    categories: [
      {
        key: "receiving", label: "Nhập hàng",
        functions: [
          { key: "purchase-new", label: "Lập phiếu nhập", desc: "Quy đổi đơn vị, sinh lô FIFO, phân bổ cước", icon: "package-plus", view: "form", path: "/purchase/orders/new", codes: ["19"], perm: "purchase.create" },
          { key: "purchase-list", label: "Danh sách phiếu nhập", desc: "Xem, tìm, sửa phiếu nhập", icon: "clipboard-list", view: "table", path: "/purchase/orders", codes: ["20"], perm: "purchase.view" },
          { key: "stock-in-adj", label: "Nhập kho đầu kỳ / không NCC", desc: "Hàng lệch, dư — không sinh công nợ", icon: "layers", view: "table", path: "/purchase/adjustments-in", codes: ["21"], perm: "stock_adjust.manage", planned: P },
          { key: "supplier-list", label: "Nhà cung cấp", desc: "Danh sách NCC", icon: "building-2", view: "table", path: "/purchase/suppliers", codes: ["10"], perm: "partner.view" },
        ],
      },
    ],
  },

  {
    key: "inventory", label: "Kho", icon: "warehouse", type: "accordion",
    categories: [
      {
        key: "stock", label: "Tồn kho",
        functions: [
          { key: "stock-onhand", label: "Tồn kho hiện tại", desc: "Tồn theo mã hàng", icon: "warehouse", view: "table", path: "/inventory/stock", codes: ["23"], perm: "stock.view", planned: P },
          { key: "stock-ledger", label: "Sổ kho / thẻ kho", desc: "Chi tiết nhập xuất từng mã", icon: "scroll-text", view: "table", path: "/inventory/ledger", codes: ["22"], perm: "stock.view", planned: P },
          { key: "stock-xnt", label: "Báo cáo xuất nhập tồn", desc: "XNT kèm giá", icon: "bar-chart-3", view: "report", path: "/inventory/xnt", codes: ["24"], perm: "stock.view", planned: P },
          { key: "stock-min", label: "Định mức tồn", desc: "Cảnh báo dưới định mức", icon: "sliders-horizontal", view: "table", path: "/inventory/min-stock", codes: ["25"], perm: "stock.view", planned: P },
          { key: "roll-lookup", label: "Tra cứu cuộn", desc: "Ngày nhập, NCC, loại tôn, khối lượng, ghi chú cuộn", icon: "search", view: "table", path: "/inventory/rolls", codes: ["30"], perm: "stock.view", planned: P },
          { key: "pending-orders", label: "Đơn chưa đủ tồn", desc: "Đơn treo chờ nhập bù", icon: "clipboard-list", view: "table", path: "/inventory/pending-orders", codes: ["29"], perm: "stock.view", planned: P },
        ],
      },
      {
        key: "control", label: "Kiểm soát",
        functions: [
          { key: "stocktake-list", label: "Kiểm kho", desc: "Lập phiếu, danh sách kiểm kho", icon: "list-checks", view: "table", path: "/inventory/stocktakes", codes: ["26", "27"], perm: "stocktake.manage", planned: P },
          { key: "stock-adjust", label: "Điều chỉnh hao hụt / xuất hủy", desc: "Cắt lỗi ~1%/tháng", icon: "scale", view: "table", path: "/inventory/adjustments", codes: ["28"], perm: "stock_adjust.manage", planned: P },
        ],
      },
      {
        key: "products", label: "Sản phẩm",
        functions: [
          { key: "product-list", label: "Danh mục sản phẩm", desc: "~1.300 mã, đơn vị tính & quy đổi", icon: "package", view: "table", path: "/inventory/products", codes: ["11", "12"], perm: "product.view" },
        ],
      },
    ],
  },

  {
    key: "returns", label: "Trả hàng", icon: "undo-2", type: "accordion",
    categories: [
      {
        key: "customer-returns", label: "Khách trả",
        functions: [
          { key: "return-order", label: "Trả theo đơn", desc: "Nhập lại kho theo giá vốn dòng bán gốc", icon: "undo-2", view: "form", path: "/returns/by-order/new", codes: ["43"], perm: "return.manage", planned: P },
          { key: "return-order-list", label: "DS trả theo đơn", desc: "", icon: "clipboard-list", view: "table", path: "/returns/by-order", codes: ["44"], perm: "return.manage", planned: P },
          { key: "return-product", label: "Trả theo sản phẩm", desc: "Khách không nhớ đơn", icon: "undo-2", view: "form", path: "/returns/by-product/new", codes: ["45"], perm: "return.manage", planned: P },
          { key: "return-product-list", label: "DS trả theo SP", desc: "", icon: "clipboard-list", view: "table", path: "/returns/by-product", codes: ["46"], perm: "return.manage", planned: P },
        ],
      },
      {
        key: "supplier-returns", label: "Trả nhà cung cấp",
        functions: [
          { key: "return-supplier", label: "Trả NCC", desc: "Xuất kho FIFO, giảm công nợ phải trả", icon: "undo-2", view: "form", path: "/returns/to-supplier/new", codes: ["47"], perm: "return.manage", planned: P },
          { key: "return-supplier-list", label: "DS trả NCC", desc: "", icon: "clipboard-list", view: "table", path: "/returns/to-supplier", codes: ["48"], perm: "return.manage", planned: P },
        ],
      },
    ],
  },

  {
    key: "production", label: "Sản xuất", icon: "factory", type: "accordion",
    categories: [
      {
        key: "bom", label: "Định mức",
        functions: [
          { key: "bom-list", label: "Định mức NVL", desc: "Khai báo có phiên bản", icon: "sliders-horizontal", view: "table", path: "/production/bom", codes: ["51"], perm: "bom.manage", planned: P },
          { key: "consumption-actual", label: "Tiêu hao thực tế", desc: "Từ kiểm kho", icon: "scale", view: "table", path: "/production/actual-consumption", codes: ["52"], perm: "bom.manage", planned: P },
          { key: "consumption-compare", label: "Đối chiếu định mức", desc: "Định mức vs thực tế", icon: "bar-chart-3", view: "report", path: "/production/compare", codes: ["53"], perm: "bom.manage", planned: P },
        ],
      },
      {
        key: "orders", label: "Lệnh & gia công",
        functions: [
          { key: "production-order", label: "Lệnh sản xuất", desc: "Chỉ phụ kiện", icon: "factory", view: "table", path: "/production/orders", codes: ["49", "50"], perm: "production.manage", planned: P },
          { key: "processing-job", label: "Gia công thuê", desc: "Tôn của khách, tính tiền công + NVL xưởng", icon: "hammer", view: "table", path: "/production/processing", codes: ["54", "55"], perm: "processing.manage", planned: P },
        ],
      },
    ],
  },

  {
    key: "accounting", label: "Kế toán", icon: "wallet", type: "accordion",
    categories: [
      {
        key: "cash", label: "Thu chi & quỹ",
        functions: [
          { key: "receipt-list", label: "Phiếu thu", desc: "Lập & danh sách phiếu thu", icon: "banknote", view: "table", path: "/accounting/receipts", codes: ["56", "57"], perm: "receipt.manage", planned: P },
          { key: "payment-list", label: "Phiếu chi", desc: "Lập & danh sách phiếu chi", icon: "coins", view: "table", path: "/accounting/payments", codes: ["58", "59"], perm: "payment.manage", planned: P },
          { key: "cashbook", label: "Sổ quỹ tiền mặt", desc: "", icon: "wallet", view: "table", path: "/accounting/cashbook", codes: ["60"], perm: "cashbook.view", planned: P },
          { key: "bankbook", label: "Sổ tiền gửi ngân hàng", desc: "", icon: "landmark", view: "table", path: "/accounting/bankbook", codes: ["61"], perm: "cashbook.view", planned: P },
          { key: "expense", label: "Chi phí hoạt động", desc: "Lương, dầu, điện, sửa xe…", icon: "calculator", view: "table", path: "/accounting/expenses", codes: ["66"], perm: "expense.manage", planned: P },
        ],
      },
      {
        key: "debt", label: "Công nợ",
        functions: [
          { key: "debt-summary", label: "Công nợ tổng hợp", desc: "Lọc KH/nhóm, kèm số dư chiết khấu tích lũy", icon: "scale", view: "table", path: "/accounting/debts", codes: ["62", "63"], perm: "debt.view", planned: P },
          { key: "debt-adjust", label: "Điều chỉnh công nợ", desc: "Hàng lỗi, bẹp, móp; sổ chiết khấu tích lũy", icon: "percent", view: "table", path: "/accounting/debt-adjustments", codes: ["64"], perm: "debt.adjust", planned: P },
          { key: "debt-transfer", label: "Gộp / chuyển công nợ", desc: "", icon: "arrow-left-right", view: "table", path: "/accounting/debt-transfers", codes: ["65"], perm: "debt.adjust", planned: P },
        ],
      },
    ],
  },

  {
    key: "reports", label: "Báo cáo", icon: "bar-chart-3", type: "accordion",
    categories: [
      {
        key: "management", label: "Báo cáo quản trị",
        functions: [
          { key: "rp-order-profit", label: "Lãi từng đơn", desc: "Lãi âm bôi đỏ", icon: "bar-chart-3", view: "report", path: "/reports/order-profit", codes: ["67"], perm: "profit.view", planned: P },
          { key: "rp-period-pnl", label: "Lãi lỗ toàn xưởng", desc: "DT − giá vốn − chiết khấu tích lũy − chi phí", icon: "bar-chart-3", view: "report", path: "/reports/period-pnl", codes: ["68"], perm: "profit.view", planned: P },
          { key: "rp-by-customer", label: "Bán hàng theo khách", desc: "", icon: "users", view: "report", path: "/reports/by-customer", codes: ["69"], perm: "report.view", planned: P },
          { key: "rp-by-group", label: "Bán hàng theo nhóm khách", desc: "", icon: "users", view: "report", path: "/reports/by-group", codes: ["70"], perm: "report.view", planned: P },
          { key: "rp-issue-by-order", label: "Xuất kho theo đơn", desc: "", icon: "package", view: "report", path: "/reports/issue-by-order", codes: ["71"], perm: "report.view", planned: P },
          { key: "rp-production", label: "Báo cáo sản xuất", desc: "", icon: "factory", view: "report", path: "/reports/production", codes: ["72"], perm: "report.view", planned: P },
          { key: "rp-debt-check", label: "Đối chiếu công nợ", desc: "", icon: "scale", view: "report", path: "/reports/debt-reconciliation", codes: ["73"], perm: "report.view", planned: P },
        ],
      },
    ],
  },

  {
    key: "period", label: "Kỳ & số đầu kỳ", icon: "calendar-check", type: "accordion",
    categories: [
      {
        key: "opening", label: "Số đầu kỳ",
        functions: [
          { key: "open-stock", label: "Tồn kho đầu kỳ", desc: "Kèm giá vốn theo lô", icon: "warehouse", view: "table", path: "/period/opening-stock", codes: ["K1"], perm: "data.import", planned: P },
          { key: "open-debt", label: "Công nợ đầu kỳ", desc: "Khách & NCC", icon: "scale", view: "table", path: "/period/opening-debt", codes: ["K2"], perm: "data.import", planned: P },
          { key: "open-cash", label: "Số dư quỹ đầu kỳ", desc: "", icon: "wallet", view: "table", path: "/period/opening-cash", codes: ["K3"], perm: "data.import", planned: P },
          { key: "open-material", label: "Tồn NVL đầu kỳ", desc: "", icon: "layers", view: "table", path: "/period/opening-materials", codes: ["K4"], perm: "data.import", planned: P },
        ],
      },
      {
        key: "closing", label: "Kết sổ",
        functions: [
          { key: "period-close", label: "Kết sổ cuối kỳ", desc: "Checklist điều kiện, chỉ giám đốc; tra cứu kỳ cũ", icon: "calendar-check", view: "form", path: "/period/close", codes: ["K5"], perm: "period.close", planned: P },
        ],
      },
    ],
  },

  {
    key: "system", label: "Hệ thống", icon: "settings", type: "accordion",
    categories: [
      {
        key: "access", label: "Người dùng & phân quyền",
        functions: [
          { key: "user-list", label: "Người dùng", desc: "Tài khoản, khoá/mở khoá, cấp lại mật khẩu", icon: "users", view: "table", path: "/system/users", codes: ["1", "2", "4"], perm: "user.view" },
          { key: "role-list", label: "Nhóm quyền", desc: "Cấu hình quyền động tới từng chức năng + phạm vi dữ liệu", icon: "shield", view: "table", path: "/system/roles", codes: ["3"], perm: "role.manage" },
          { key: "audit-log", label: "Nhật ký thao tác", desc: "Số cũ / số mới, không xóa được", icon: "scroll-text", view: "table", path: "/system/audit-log", codes: ["5"], perm: "audit.view" },
        ],
      },
      {
        key: "config", label: "Cấu hình",
        functions: [
          { key: "company", label: "Công ty & mẫu in", desc: "Thông tin công ty, bật/tắt mẫu in", icon: "building-2", view: "form", path: "/system/company", codes: ["6"], perm: "company.manage", planned: P },
          // 1 Function duy nhất cho mọi danh mục nhỏ; các loại nằm ở mini-sidebar trong trang (?section=) — catalog-settings.md
          { key: "catalog-settings", label: "Cài đặt danh mục", desc: "Nhóm khách, kho, xe & lái xe, tuyến, loại thu chi, ngân hàng, kiểu gia công", icon: "sliders-horizontal", view: "catalog", path: "/system/catalog-settings", codes: ["8", "13", "14", "15", "16", "17", "18"], perm: "catalog.manage" },
        ],
      },
    ],
  },
];
