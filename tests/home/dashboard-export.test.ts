import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportDashboard } from "@/server/home/dashboard/export";

describe("overview Excel", () => {
  it("exports actual chart series and numeric table values while preserving document codes", async () => {
    const wb = new ExcelJS.Workbook();
    const buffer = await exportDashboard({ kpis: [{ key: "sum", label: "Tổng", value: 1234567, format: "currency", icon: "banknote", tone: "accent" }], widgets: [
      { key: "chart", title: "Theo tháng", kind: "bars", span: 12, labels: ["T1"], barFormat: "currency", bars: [{ name: "Thu", tone: "accent", values: [1200] }] },
      { key: "table", title: "Phiếu gần đây", kind: "table", span: 12, columns: [{ label: "Mã" }, { label: "Số tiền", align: "right" }], rows: [[{ text: "00123" }, { text: "1.234.567 ₫", align: "right" }]] },
    ] }, [{ key: "Thời gian", value: "Hôm nay" }]);
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("Theo tháng")!.getCell("B2").value).toBe(1200);
    expect(wb.getWorksheet("Phiếu gần đây")!.getCell("A2").value).toBe("00123");
    expect(wb.getWorksheet("Phiếu gần đây")!.getCell("B2").value).toBe(1234567);
    expect(wb.getWorksheet("Thông tin")!.getCell("B3").text).toContain("giới hạn");
  });
});
