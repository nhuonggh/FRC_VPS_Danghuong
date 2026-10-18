import { StatCard } from "./StatCard";

type Data = Record<string, string | number | undefined>;
export function OperationalStats({ kind, data, unit, values }: { kind: "undelivered" | "supplier" | "ledger" | "xnt" | "min"; data: Data; unit?: string; values?: Data }) {
  const specs: Record<typeof kind, { key: string; label: string; tone?: "warning" | "danger" | "success" }[]> = {
    undelivered: [{ key: "orders", label: "Đơn hàng" }, { key: "failed", label: "Điểm không giao được", tone: "danger" }, { key: "partial", label: "Điểm giao một phần", tone: "warning" }, { key: "trips", label: "Chuyến liên quan" }],
    supplier: [{ key: "total", label: "Tổng đơn đặt" }, { key: "sent", label: "Chờ nhận hàng", tone: "warning" }, { key: "partial", label: "Đã nhận một phần", tone: "warning" }, { key: "received", label: "Đã nhận đủ", tone: "success" }],
    ledger: [{ key: "opening", label: "Tồn đầu" }, { key: "incoming", label: "Nhập", tone: "success" }, { key: "outgoing", label: "Xuất", tone: "warning" }, { key: "closing", label: "Tồn cuối" }],
    xnt: [{ key: "total", label: "Mã hàng" }, { key: "incoming", label: "Mã có nhập" }, { key: "outgoing", label: "Mã có xuất" }, { key: "inStock", label: "Mã còn tồn" }],
    min: [{ key: "products", label: "Mã dưới định mức", tone: "warning" }, { key: "inStock", label: "Mã còn hàng" }, { key: "empty", label: "Mã hết / âm tồn", tone: "danger" }, { key: "pending", label: "Mã có xuất tạm", tone: "warning" }],
  };
  return <>{specs[kind].map((s) => <StatCard key={s.key} label={unit ? `${s.label} (${unit})` : s.label} value={data[s.key] ?? 0} maxFrac={kind === "ledger" ? 3 : 0} tone={kind === "ledger" && s.key === "closing" && Number(data.closing) < 0 ? "danger" : s.tone} />)}{values && [{ key: "openingValue", label: "Giá trị tồn đầu" }, { key: "inValue", label: "Giá trị nhập" }, { key: "outValue", label: "Giá trị xuất" }, { key: "closingValue", label: "Giá trị tồn cuối" }].map((s) => <StatCard key={s.key} label={s.label} value={values[s.key] ?? 0} money />)}</>;
}
