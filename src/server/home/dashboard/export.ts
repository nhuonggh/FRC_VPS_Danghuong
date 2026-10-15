import type { Dashboard } from "./types";
import { buildXlsxSheets, type XlsxSheet } from "@/server/export/xlsx";

function tableNumber(text: string): number | null {
  const value = text.replace(/\s*[₫%]\s*$/, "").trim();
  if (!/^-?\d+(?:\.\d{3})*(?:,\d+)?$/.test(value)) return null;
  return Number(value.replace(/\./g, "").replace(",", "."));
}

/** Export the selected overview, with chart series as numbers and shortlists explicitly named. */
export async function exportDashboard(data: Dashboard, metadata: Record<string, unknown>[]): Promise<Buffer> {
  const sheets: XlsxSheet[] = [{ name: "Thông tin", columns: [{ header: "Thông tin", key: "key", text: true, width: 30 }, { header: "Nội dung", key: "value", text: true, width: 90 }], rows: [...metadata,
    { key: "Phạm vi", value: "Số liệu tổng quan; các bảng gần đây và bảng xếp hạng giữ giới hạn ghi trên báo cáo. Để xuất toàn bộ chứng từ, dùng Kiểm tra hằng ngày." },
    { key: "Biểu đồ tháng", value: "Biểu đồ theo tháng phản ánh cả năm ghi trong tên biểu đồ, giống giao diện." },
    ...(data.notes ?? []).map((n) => ({ key: "Ghi chú", value: n })),
  ] }];
  sheets.push({ name: "Chỉ số", columns: [{ header: "Chỉ số", key: "label", text: true, width: 32 }, { header: "Giá trị", key: "value", numFmt: "#,##0.###", width: 24 }, { header: "Đơn vị", key: "unit", text: true }, { header: "Ghi chú", key: "note", text: true, width: 40 }], rows: data.kpis.map((k) => ({ label: k.label, value: k.value, unit: k.format === "currency" ? "VND" : k.format, note: k.caption ?? "" })) });
  for (const w of data.widgets) {
    const valueCol = { header: "Giá trị", key: "value", numFmt: "#,##0.###", width: 24 };
    const labelCol = { header: "Nội dung", key: "label", text: true, width: 36 };
    switch (w.kind) {
      case "bars": {
        const series = [...w.bars, ...(w.line ? [w.line] : [])];
        sheets.push({ name: w.title, columns: [labelCol, ...series.map((s, i) => ({ header: s.name, key: `s${i}`, numFmt: "#,##0.###", width: 24 }))], rows: w.labels.map((label, index) => ({ label, ...Object.fromEntries(series.map((s, i) => [`s${i}`, s.values[index] ?? 0])) })) });
        break;
      }
      case "donut": sheets.push({ name: w.title, columns: [labelCol, valueCol], rows: w.slices.map((s) => ({ label: s.label, value: s.value })) }); break;
      case "rank": sheets.push({ name: w.title, columns: [labelCol, valueCol], rows: w.items.map((i) => ({ label: i.label, value: i.value })) }); break;
      case "status": sheets.push({ name: w.title, columns: [labelCol, valueCol, { header: "Ghi chú", key: "note", text: true, width: 36 }], rows: w.items.map((i) => ({ label: i.label, value: i.value, note: i.caption ?? "" })) }); break;
      case "table": sheets.push({ name: w.title, columns: w.columns.map((c, i) => ({ header: c.label, key: `c${i}`, text: c.align !== "right", ...(c.align === "right" ? { numFmt: "#,##0.###" } : {}), width: 26 })), rows: w.rows.map((r) => Object.fromEntries(r.map((c, i) => [`c${i}`, w.columns[i]?.align === "right" ? tableNumber(c.text) ?? c.text : c.text]))) }); break;
    }
  }
  if (data.bankReceipts) {
    const b = data.bankReceipts;
    sheets.push({ name: "Tài khoản ngân hàng", columns: [{ header: "Tài khoản", key: "name", text: true, width: 36 }, { header: "Số tài khoản", key: "bankNo", text: true, width: 24 }, { header: "Tiền ghi sổ (VND)", key: "recorded", numFmt: "#,##0.00", width: 25 }, { header: "Đã kiểm", key: "reviewed" }, { header: "Chờ kiểm", key: "pending" }, { header: "Trả lại", key: "returned" }], rows: b.accounts });
    sheets.push({ name: "Phiếu cần xử lý (gần đây)", columns: [{ header: "Mã phiếu", key: "code", text: true }, { header: "Ngày", key: "at", text: true, width: 22 }, { header: "Đối tác", key: "partnerName", text: true, width: 30 }, { header: "Tài khoản", key: "accountName", text: true, width: 30 }, { header: "Số tiền (VND)", key: "amount", numFmt: "#,##0.00", width: 24 }, { header: "Trạng thái", key: "status", text: true }], rows: b.tasks });
  }
  return buildXlsxSheets(sheets);
}
