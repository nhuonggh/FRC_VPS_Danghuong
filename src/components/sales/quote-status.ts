/** Không "use client": server page và client component đều đọc được (export từ file client sang server chỉ là tham chiếu, không đọc được thuộc tính). */
export const QUOTE_STATUS = {
  DRAFT: { label: "Nháp", tone: "neutral" as const },
  SENT: { label: "Đã gửi khách", tone: "info" as const },
  CONVERTED: { label: "Đã chuyển thành đơn", tone: "success" as const },
  CANCELLED: { label: "Đã hủy", tone: "danger" as const },
};
