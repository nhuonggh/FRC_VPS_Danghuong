import { describe, expect, it } from "vitest";
import { ICONS } from "@/components/shell/icons";
import { CATALOG_SECTIONS, catalogSchema, resolveSection } from "@/config/catalog-sections";
describe("CATALOG_SECTIONS", () => {
  it("key/icon/mã phạm vi hợp lệ và phủ mã 8, 13–18", () => {
    expect(new Set(CATALOG_SECTIONS.map((x) => x.key)).size).toBe(CATALOG_SECTIONS.length);
    for (const section of CATALOG_SECTIONS) { expect(ICONS[section.icon]).toBeDefined(); expect(section.codes.length).toBeGreaterThan(0); }
    const codes = new Set(CATALOG_SECTIONS.flatMap((x) => x.codes));
    for (const code of ["8", "13", "14", "15", "16", "17", "18"]) expect(codes.has(code)).toBe(true);
  });
  it("deep-link sai về mục đầu, schema trim và validate tiếng Việt", () => {
    expect(resolveSection("khong-co").key).toBe(CATALOG_SECTIONS[0]!.key);
    const schema = catalogSchema(resolveSection("warehouses"));
    expect(schema.parse({ name: "  Kho 1 " })).toEqual({ name: "Kho 1" });
    expect(schema.safeParse({ name: " " }).success).toBe(false);
  });
});
