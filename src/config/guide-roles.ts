export interface GuideRole {
  key: string;
  label: string;
  intro: string;
  tasks: readonly { fn: string; label: string }[];
}

/** Vai trò là lối đọc theo công việc, không dùng để suy ra hay cấp quyền. */
export const GUIDE_ROLES: readonly GuideRole[] = [
  { key: "sales", label: "Bán hàng", intro: "Theo dõi công việc từ khi khách hỏi mua đến khi giao hàng và nhận tiền.", tasks: [
    { fn: "customer-list", label: "Tìm hoặc thêm khách hàng" }, { fn: "stock-onhand", label: "Kiểm tra hàng còn trong kho" },
    { fn: "quote-list", label: "Lập báo giá nếu khách cần" }, { fn: "order-new", label: "Lập đơn khi khách chốt mua" },
    { fn: "deposit-list", label: "Ghi nhận tiền cọc nếu có" }, { fn: "order-list", label: "Theo dõi giao hàng và thanh toán" },
    { fn: "return-order", label: "Xử lý khi khách trả hàng" },
  ] },
  { key: "warehouse", label: "Thủ kho", intro: "Kiểm tra đúng mặt hàng, đúng số lượng và đối chiếu với hàng thực tế.", tasks: [
    { fn: "stock-onhand", label: "Xem số tồn trước khi chuẩn bị hàng" }, { fn: "order-list", label: "Xem đơn cần chuẩn bị hàng" },
    { fn: "roll-lookup", label: "Tra cứu cuộn khi cần" }, { fn: "stock-ledger", label: "Kiểm tra các lần nhập xuất" },
    { fn: "stock-min", label: "Theo dõi hàng dưới định mức" }, { fn: "stocktake-list", label: "Đếm hàng và lập phiếu kiểm kho" },
    { fn: "stock-adjust", label: "Ghi nhận hao hụt khi được giao" },
  ] },
  { key: "accountant", label: "Kế toán", intro: "Ghi nhận chứng từ, đối chiếu tiền và theo dõi khoản phải thu, phải trả.", tasks: [
    { fn: "purchase-list", label: "Kiểm tra phiếu nhập hàng" }, { fn: "trip-settle", label: "Đối soát tiền các chuyến giao" },
    { fn: "receipt-list", label: "Ghi nhận khoản thu" }, { fn: "payment-list", label: "Ghi nhận khoản chi" },
    { fn: "bankbook", label: "Đối chiếu tài khoản ngân hàng" }, { fn: "debt-summary", label: "Đối chiếu công nợ" },
    { fn: "discount-ledger", label: "Kiểm tra chiết khấu tích lũy" }, { fn: "expense", label: "Kiểm tra chi phí hoạt động" },
    { fn: "rp-debt-check", label: "Xem báo cáo đối chiếu công nợ" },
  ] },
  { key: "cashier", label: "Thủ quỹ", intro: "Kiểm tra tiền thực nhận, thực chi và đối chiếu số quỹ mỗi ngày.", tasks: [
    { fn: "cash-review", label: "Kiểm tra phiếu còn chờ" }, { fn: "receipt-list", label: "Lập và xem phiếu thu" },
    { fn: "payment-list", label: "Lập và xem phiếu chi" }, { fn: "trip-settle", label: "Kiểm tra và xác nhận tiền giao hàng" },
    { fn: "cashbook", label: "Đối chiếu tiền mặt và chốt quỹ khi được giao" }, { fn: "cashreport", label: "Xem báo cáo quỹ theo ngày và theo người kiểm tra" }, { fn: "bankbook", label: "Kiểm tra tiền ngân hàng" },
  ] },
  { key: "director", label: "Giám đốc", intro: "Xem tình hình hoạt động, kiểm tra các khoản cần xử lý và quản lý quyền sử dụng.", tasks: [
    { fn: "order-list", label: "Kiểm tra đơn hàng và việc giao, thu tiền" }, { fn: "debt-summary", label: "Theo dõi khoản phải thu, phải trả" },
    { fn: "stock-onhand", label: "Kiểm tra tồn kho" }, { fn: "rp-order-profit", label: "Xem lãi từng đơn" },
    { fn: "rp-period-pnl", label: "Xem lãi lỗ toàn xưởng" }, { fn: "user-list", label: "Quản lý tài khoản nhân viên" },
    { fn: "role-list", label: "Giao quyền phù hợp cho từng nhóm" }, { fn: "period-close", label: "Kiểm tra đầy đủ trước khi kết sổ" },
  ] },
];
