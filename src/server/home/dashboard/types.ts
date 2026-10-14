/**
 * DTO của dashboard trang chủ. Mọi tab (Bán hàng, Giao hàng, …) trả cùng một hình dạng để MỘT bộ giao diện
 * (`DashboardView`) vẽ được tất cả. Số tiền/số lượng là number đã tính xong ở server; thứ nhạy cảm (giá/vốn)
 * do từng loader quyết định có đưa vào hay không — thiếu quyền thì widget đó KHÔNG tồn tại (không trả 0 giả).
 */
export type DashFormat = "currency" | "count" | "percent" | "qty" | "hours";
export type DashTone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";

export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: DashFormat;
  icon: string;
  tone: DashTone;
  /** % thay đổi so với kỳ trước cùng độ dài; null = không có cơ sở so sánh. */
  delta?: number | null;
  /** true: số tăng là xấu (vd công nợ, chuyến trễ) → mũi tên đỏ khi tăng. */
  deltaInverted?: boolean;
  /** Dòng phụ thay cho delta (vd "Tỷ lệ thành công"). */
  caption?: string;
  href?: string;
}

export interface Slice { label: string; value: number; tone?: DashTone }

export interface BarSeries { name: string; values: number[]; tone: DashTone; format?: DashFormat }

export interface RankItem { label: string; sub?: string; value: number; href?: string }

export type CellTone = "success" | "warning" | "danger" | "info" | "neutral";
export interface Cell { text: string; href?: string; tone?: CellTone; align?: "right" }
export interface TableColumn { label: string; align?: "right" }

export interface StatusItem { label: string; /** null = chưa có dữ liệu → hiển thị "—" (không phải 0). */ value: number | null; tone: DashTone; icon: string; format?: DashFormat; caption?: string }

interface WidgetBase { key: string; title: string; /** Số cột (trên lưới 12) ở màn ≥1280px. */ span: 3 | 4 | 5 | 6 | 7 | 8 | 12; moreHref?: string }

export type Widget =
  | (WidgetBase & { kind: "bars"; labels: string[]; bars: BarSeries[]; line?: BarSeries; barFormat: DashFormat })
  | (WidgetBase & { kind: "donut"; slices: Slice[]; centerLabel: string; centerValue: number; format: DashFormat })
  | (WidgetBase & { kind: "rank"; items: RankItem[]; format: DashFormat })
  | (WidgetBase & { kind: "table"; columns: TableColumn[]; rows: Cell[][] })
  | (WidgetBase & { kind: "status"; items: StatusItem[] });

export interface Dashboard {
  kpis: Kpi[];
  widgets: Widget[];
  /** Ghi chú hiển thị cuối trang (vd phần chưa có dữ liệu). */
  notes?: string[];
  bankReceipts?: BankReceiptsOverview;
}

/** Hậu kiểm chứng từ nội bộ; chưa phải kết quả ghép với sao kê ngân hàng. */
export interface BankReceiptsOverview {
  accounts: { id: number; name: string; bankNo: string | null; recorded: string; reviewed: number; pending: number; returned: number; bookHref?: string }[];
  selectedAccount: number | null;
  recorded: string;
  reviewed: number;
  pending: number;
  returned: number;
  tasks: { id: number; code: string; at: string; partnerName: string | null; accountName: string; amount: string; status: "PENDING_REVIEW" | "RETURNED"; href?: string }[];
  tasksHref?: string;
  bookHref?: string;
}

export type DashTabKey = "sales" | "delivery" | "purchase" | "inventory" | "returns" | "production" | "accounting";
