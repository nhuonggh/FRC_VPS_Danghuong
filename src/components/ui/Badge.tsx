import clsx from "clsx";

export type BadgeTone = "info" | "success" | "warning" | "tertiary" | "danger" | "neutral";

// Ý nghĩa → màu cố định, không đổi theo module
const TONES: Record<BadgeTone, string> = {
  info: "bg-info-soft text-info", // Mới / Đang xử lý
  success: "bg-success-soft text-success", // Đang hoạt động / Thành công
  warning: "bg-warning-soft text-warning", // Chờ / Đang thiết lập
  tertiary: "bg-tertiary-soft text-tertiary", // Hoàn tất
  danger: "bg-danger-soft text-danger", // Hủy / Từ chối / Lỗi
  neutral: "bg-hover text-fg-secondary", // Nháp / Vô hiệu
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", TONES[tone], className)}>
      {children}
    </span>
  );
}
