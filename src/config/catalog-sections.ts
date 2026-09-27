import { z } from "zod";

export type CatalogKey = "partner-groups" | "warehouses" | "vehicles" | "drivers" | "routes" | "expense-types" | "cash-accounts" | "processing-types";
export interface CatalogField { name: string; label: string; type: "text" | "checkbox" | "select"; required?: boolean; maxLength?: number; options?: readonly { value: string; label: string }[]; inTable?: boolean }
export interface CatalogSection { key: CatalogKey; label: string; singular: string; icon: string; codes: readonly string[]; entity: string; titleField: string; fields: readonly CatalogField[] }
const name = (label: string, maxLength = 80): CatalogField => ({ name: "name", label, type: "text", required: true, maxLength });

export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  { key: "partner-groups", label: "Nhóm khách hàng", singular: "nhóm khách hàng", icon: "users", codes: ["8"], entity: "PartnerGroup", titleField: "name", fields: [name("Tên nhóm", 60)] },
  { key: "warehouses", label: "Kho", singular: "kho", icon: "warehouse", codes: ["14"], entity: "Warehouse", titleField: "name", fields: [name("Tên kho", 60)] },
  { key: "vehicles", label: "Xe", singular: "xe", icon: "truck", codes: ["15"], entity: "Vehicle", titleField: "plate", fields: [{ name: "plate", label: "Biển số", type: "text", required: true, maxLength: 20 }] },
  { key: "drivers", label: "Lái xe & phụ xe", singular: "lái xe / phụ xe", icon: "users", codes: ["15"], entity: "Driver", titleField: "name", fields: [name("Họ tên"), { name: "isAssistant", label: "Là phụ xe", type: "checkbox", inTable: true }] },
  { key: "routes", label: "Tuyến giao hàng", singular: "tuyến giao hàng", icon: "arrow-left-right", codes: ["16"], entity: "Route", titleField: "name", fields: [name("Tên tuyến")] },
  { key: "expense-types", label: "Loại thu chi", singular: "loại thu chi", icon: "coins", codes: ["17"], entity: "ExpenseType", titleField: "name", fields: [name("Tên loại")] },
  { key: "cash-accounts", label: "Ngân hàng & quỹ", singular: "tài khoản quỹ", icon: "landmark", codes: ["18"], entity: "CashAccount", titleField: "name", fields: [name("Tên tài khoản"), { name: "type", label: "Loại", type: "select", options: [{ value: "CASH", label: "Tiền mặt" }, { value: "BANK", label: "Ngân hàng" }], inTable: true }, { name: "bankNo", label: "Số tài khoản", type: "text", maxLength: 40, inTable: true }] },
  { key: "processing-types", label: "Kiểu gia công", singular: "kiểu gia công", icon: "hammer", codes: ["13"], entity: "ProcessingType", titleField: "name", fields: [name("Tên kiểu gia công", 60), { name: "note", label: "Ghi chú", type: "text", maxLength: 200, inTable: true }] },
];
export const getSection = (key: string): CatalogSection | null => CATALOG_SECTIONS.find((x) => x.key === key) ?? null;
export const resolveSection = (key: string | undefined): CatalogSection => (key ? getSection(key) : null) ?? CATALOG_SECTIONS[0]!;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export function catalogSchema(section: CatalogSection) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of section.fields) {
    if (f.type === "checkbox") shape[f.name] = z.boolean();
    else if (f.type === "select") {
      const values = (f.options ?? []).map((x) => x.value) as [string, ...string[]];
      shape[f.name] = z.enum(values, { errorMap: () => ({ message: `Chọn ${lower(f.label)}.` }) });
    } else {
      const base = z.string({ required_error: `Nhập ${lower(f.label)}.` }).trim().max(f.maxLength ?? 80, `${f.label} quá dài.`);
      shape[f.name] = f.required ? base.min(1, `Nhập ${lower(f.label)}.`) : base;
    }
  }
  return z.object(shape);
}
