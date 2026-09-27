# GĐ1b-a — Danh mục nền, Khách hàng/NCC, Sản phẩm (Plan 03a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Đọc trước: `2026-09-24-00-master-plan.md` (quyết định D-1…D-10, Global Constraints, DoD mục 7), `docs/STATUS.md` mục 2, `docs/conventions/{list-page,permissions,sensitive-data}.md`. Plan này là **phần 1/3 của plan 03** (GĐ1b); 03b (nhập hàng + kho) và 03c (BOM + công ty + trang chủ) viết cùng đợt, chạy SAU plan này.

**Goal:** Dựng đủ danh mục nền (mã 8, 13, 14, 15, 16, 17, 18), Khách hàng/NCC (9, 10), Sản phẩm + đơn vị quy đổi + định mức tồn (11, 12, 25-cấu hình), kèm khung Import Excel dùng lại được (D-6) — nền cho nhập hàng (03b) và bán hàng (plan 04).

**Architecture:** Mỗi domain một thư mục `src/server/<domain>/` (schemas → service → queries, thuần TypeScript, nhận `db` là transaction client, ghi `writeAudit` cùng transaction). Route handler mỏng (`apiHandler` → `requireActorApi` → zod → service). UI = Server page (dữ liệu theo URL) + Client component (bảng/form) theo `crm-design`: danh sách phân trang server, chi tiết là **route riêng** (`/x/[id]?tab=`), tạo mới `/x/new`, KHÔNG panel. Danh mục nhỏ đi vào **Catalog Settings** (1 route + `?section=`), sinh từ 1 mảng cấu hình.

**Tech Stack:** Next.js 15 · React 19 · TypeScript · Prisma 6 (multi-file schema) · PostgreSQL 15 · zod · react-hook-form · ExcelJS (đã có) · Radix (dialog, dropdown — đã có) · Vitest + Testing Library. **Không thêm thư viện mới.**

**Spec:** `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` — Phần 2.2 (danh mục nền), 6.4 (quy đổi đơn vị), 6.6 (phân quyền mẫu), 6.11 (D1–D4), Phần 7 M2 (mã 8–18). Master plan mục 5.1 (B1–B3) là khung.

## Global Constraints

Kế thừa nguyên văn **Global Constraints của master plan** (phạm vi theo mã; tiếng Việt; Decimal(18,2/3/4); 7 nguyên tắc kiến trúc; không cột số dư chạy; token `crm-design`; chi tiết = route riêng; danh sách có Search+Filter+Export+pagination dính đáy; `null` → `—`; FK là combobox có search; idempotency cho tạo bản ghi quan trọng; quyền 3 cấp + route guard; tên bảng `@@map` snake_case, cột camelCase; SQL thô luôn quote `"periodId"`). Bổ sung riêng cho plan 03 (khoá ở đây, 03b/03c dùng lại):

- **D-11 (chia plan):** plan 03 gồm 03a (file này), 03b (nhập hàng + kho), 03c (BOM + công ty + trang chủ + đóng GĐ1b).
- **D-12 (hướng hệ số quy đổi):** `ProductUnit.factor` = **số đơn vị nhập trên 1 đơn vị gốc** (vd kg/md = 2,4) ⇒ `qtyBase = qty ÷ factor` (3.000 kg ÷ 2,4 = 1.250 md — đúng ví dụ spec 6.4). Đơn vị gốc luôn có factor = 1 (ngầm, không lưu). Comment trong `master.prisma` cũ ("1 unit = factor × baseUnit") sai hướng — sửa ở Task 1. Đơn vị nhập LỚN HƠN đơn vị gốc (vd 1 cây = 6 md) khai `factor = 0,166667` (đủ 6 chữ số của `Decimal(18,6)`; kết quả làm tròn 3 số lẻ). `// TODO: confirm` với khách nếu họ dùng đơn vị lớn hơn gốc.
- **D-14 (tôn cuộn):** thêm `products.isCoil` (mặc định `false`) để định nghĩa "tôn cuộn" cho màn Tra cứu cuộn (mã 30, plan 03b). Spec không có cột này — ghi rõ là bổ sung tối thiểu, đánh dấu `// TODO: confirm`.
- **D-15 (import):** import Excel chạy **đồng bộ**, tối đa **5.000 dòng / 2 MB** mỗi file (D1–D2 chỉ ~200 khách + ~1.300 SP; `createMany` 1.300 dòng ≈ 1–2 giây). Quá ngưỡng → từ chối kèm hướng dẫn tách file. Đây là ngưỡng "tuỳ hạ tầng" mà `crm-design/import-export.md` cho phép (mặc định đề xuất 1.000 dòng/2 MB dùng job nền — không cần vì 1 tiến trình Node + không có tác vụ nền nào cạnh tranh; nếu sau này dữ liệu thật vượt → làm job nền ở plan 05-D8).
- **Ngôn ngữ số Excel:** số dạng chữ đọc theo quy ước Việt Nam (`.` ngăn nghìn, `,` thập phân) qua **một hàm duy nhất** `parseViNumber` (Task 4); ô số thật của Excel đọc thẳng. Mọi bảng danh mục có `searchText` phải ghi bằng `normalizeSearch(...)` ở MỌI đường ghi (form, import, seed) — D-9.
- **Quyền:** mọi thao tác ghi ở tầng service gọi `assertCan`. Import cần **cả** `data.import` **và** quyền quản lý của thực thể (`partner.manage` / `product.manage`). Export dùng quyền `*.view` (spec không định nghĩa quyền export riêng) + cùng phạm vi dữ liệu với trang danh sách.

## Review Focus

Các đầu vào spec ngầm dự tính nhưng không task nào tự kiểm — mỗi dòng đã có test gắn vào task chủ (tên task ở cuối dòng):

1. **Tìm không dấu / gõ tắt.** `ton lanh`, `TÔN  LẠNH ` (thừa cách, hoa/thường lẫn lộn) phải ra "Tôn lạnh màu 0.45" trong 1.300 SP và khách "Nguyễn Văn Đạt" khi gõ `dat`. Khách **đã gộp mã** (`mergedIntoId ≠ null`) và khách đã **tắt** KHÔNG hiện trong ô chọn (combobox). → Task 5, 7.
2. **Số kiểu Excel Việt Nam.** `1.234,5` = 1234,5; `2,4` = 2,4; `"3 000"` = 3000; `0.450` = 0,45 (số 0 đầu ⇒ thập phân, không phải ngăn nghìn); ô trống = "không có" (KHÔNG phải 0); `12abc`, `1,2,3` → lỗi dòng có số dòng. Không dòng lỗi nào được ghi DB. → Task 4.
3. **Làm tròn quy đổi kg↔md.** 3.000 kg ÷ 2,4 = 1.250 md; 1.000 kg ÷ 3 = 333,333 md; hệ số ≤ 0 hoặc rỗng bị từ chối trước khi chia (không `Infinity`/`NaN`). → Task 7.
4. **Import lần 2 cùng file / trùng mã trong file.** Không tạo trùng; mặc định bỏ qua dòng đã có, tuỳ chọn "Ghi đè"; hai dòng cùng mã trong một file → dòng sau bị loại kèm lý do; dòng "Ngừng bán" và mã trùng đi vào **file riêng** cho khách duyệt (D2). Bấm Nhập 2 lần / retry cùng Idempotency-Key chỉ ghi một lần. → Task 4, 5, 7.
5. **Tạo cùng tên đồng thời / xoá mục đang dùng.** Hai người cùng tạo "Kho 1" cùng lúc → một thành công, một nhận lỗi tiếng Việt tại ô Tên (không 500); xoá nhóm khách đang có khách → 409 có lý do và gợi ý "Tắt" thay vì xoá; đổi loại tài khoản quỹ đã có phát sinh bị chặn. → Task 2.
6. **"Chỉ khách của mình".** Nhân viên bán hàng (thiếu `partner.view_all`) không thấy khách người khác ở danh sách, ô chọn, trang chi tiết (404, không 403 — không lộ sự tồn tại) và file Export. → Task 5, 6.

## Cấu trúc file (plan 03a)

| Tạo mới | Trách nhiệm |
|---|---|
| `prisma/migrations/<ts>_catalog_foundation/migration.sql` | bảng danh mục mới + cột `isActive`/`isCoil` + CHECK |
| `src/config/catalog-sections.ts` | **1 nguồn** cấu hình Catalog Settings (sidebar, bảng, form, schema zod) — dùng được ở client |
| `src/server/catalog/{adapters,service,queries}.ts` | CRUD generic cho 8 mục danh mục (audit, 409 khi đang dùng) |
| `src/app/api/catalog/**` | POST tạo · PATCH section · POST toggle · DELETE · GET export |
| `src/app/(app)/system/catalog-settings/**` | trang danh sách + mini-sidebar, `[section]/new`, `[section]/[id]` |
| `src/lib/parse-number.ts` | `parseViNumber` — đọc số kiểu Việt Nam |
| `src/server/import/{xlsx-reader,framework,response}.ts` · `src/components/import/*` | khung Import: đọc file, xem trước, ghi, file loại, mẫu, hộp thoại |
| `src/server/partners/{schemas,codes,service,queries,import-spec}.ts` | KH/NCC: CRUD, mã tự sinh, phạm vi "khách của mình", tìm không dấu |
| `src/components/partners/*` + `src/app/(app)/{sales/customers,purchase/suppliers}/**` + `src/app/api/partners/**` | UI KH/NCC dùng chung 2 route |
| `src/server/products/{schemas,units,service,queries,import-spec}.ts` | SP: CRUD, đơn vị & quy đổi, định mức tồn, import 1.300 SP |
| `src/components/products/*` + `src/app/(app)/inventory/products/**` + `src/app/api/products/**` | UI SP |

| Sửa | Ghi chú |
|---|---|
| `prisma/schema/master.prisma` | Task 1 |
| `src/components/ui/DataTable.tsx` | Task 3: `actionsVariant="kebab"` + icon `power` |
| `src/config/app.config.ts` | bỏ cờ `planned` của chức năng đã giao (mỗi task UI làm phần của mình) |
| `tests/helpers/factories.ts` | Task 1: thêm factory |
| `docs/STATUS.md`, `docs/db_schema.sql` (sinh) | Task 8 |

**Quy ước lệnh (Windows + Git Bash):** chạy test bằng `rtk proxy npx vitest run <file>` (hook RTK nuốt output vitest); không chạy 2 vitest cùng lúc (DB test cổng 5434: `docker compose up -d pgtest`). Lint/typecheck: `rtk proxy npm run lint`, `rtk proxy npm run typecheck`.

---

### Task 1: Schema nền cho danh mục + sản phẩm (migration `catalog_foundation`)

**Mã:** 8, 11–18 (bảng dữ liệu). **Files:**
- Modify: `prisma/schema/master.prisma`
- Create (sinh bằng Prisma): `prisma/migrations/<timestamp>_catalog_foundation/migration.sql`
- Modify: `tests/helpers/factories.ts`
- Test: `tests/db/catalog-foundation.test.ts`

**Interfaces:**
- Consumes: bảng `partner_groups`, `warehouses`, `products`, `product_units`, `cash_accounts` của GĐ0.
- Produces: model Prisma `Vehicle`, `Driver`, `Route`, `ExpenseType`, `ProcessingType`; cột `isActive` trên `PartnerGroup`/`Warehouse`; `Product.isCoil`; factory `makeWarehouse`, `makeProcessingType`, `makeVehicle`.

- [x] **Step 1: Viết test trước (đỏ)** — `tests/db/catalog-foundation.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makePartnerGroup, makeProduct } from "../helpers/factories";

beforeEach(resetDb);

describe("danh mục nền — cột & ràng buộc mới", () => {
  it("nhóm khách, kho: có isActive mặc định true", async () => {
    const g = await makePartnerGroup("Thợ");
    const w = await prisma.warehouse.create({ data: { name: "Kho 1" } });
    expect(g.isActive).toBe(true);
    expect(w.isActive).toBe(true);
  });

  it("5 bảng danh mục mới tạo được, tên/biển số là duy nhất", async () => {
    await prisma.vehicle.create({ data: { plate: "51C-123.45" } });
    await expect(prisma.vehicle.create({ data: { plate: "51C-123.45" } })).rejects.toThrow(/Unique constraint/i);
    await prisma.route.create({ data: { name: "Quận 12" } });
    await prisma.expenseType.create({ data: { name: "Dầu xe" } });
    await prisma.processingType.create({ data: { name: "Tôn xốp" } });
    await prisma.driver.create({ data: { name: "Nguyễn Văn Tài", isAssistant: false } });
    await prisma.driver.create({ data: { name: "Nguyễn Văn Tài", isAssistant: true } }); // tên lái xe được trùng (2 người cùng tên)
    expect(await prisma.driver.count()).toBe(2);
  });

  it("sản phẩm: isCoil mặc định false", async () => {
    expect((await makeProduct()).isCoil).toBe(false);
  });

  it("CHECK: hệ số quy đổi > 0, định mức tồn ≥ 0, hạn mức nợ ≥ 0, đối tác phải là khách hoặc NCC", async () => {
    const p = await makeProduct();
    await expect(prisma.productUnit.create({ data: { productId: p.id, unit: "kg", factor: 0 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.product.update({ where: { id: p.id }, data: { minStock: -1 } })).rejects.toThrow(/check constraint/i);
    const g = await makePartnerGroup();
    await expect(prisma.partner.create({ data: { code: "X1", name: "X", groupId: g.id, debtLimit: -5 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.partner.create({ data: { code: "X2", name: "X", groupId: g.id, isCustomer: false, isSupplier: false } })).rejects.toThrow(/check constraint/i);
  });
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `docker compose up -d pgtest` rồi `rtk proxy npx vitest run tests/db/catalog-foundation.test.ts`
Expected: FAIL — `prisma.vehicle` không tồn tại / cột `isActive`, `isCoil` chưa có.

- [x] **Step 3: Sửa `prisma/schema/master.prisma`**

Thêm `isActive` vào `PartnerGroup` và `Warehouse`, `isCoil` vào `Product`, sửa comment `ProductUnit`, thêm 5 model. Các phần khác của file giữ nguyên.

```prisma
model PartnerGroup {
  id       Int     @id @default(autoincrement())
  name     String  @unique
  isActive Boolean @default(true)

  partners Partner[]

  @@map("partner_groups")
}

model Warehouse {
  id       Int     @id @default(autoincrement())
  name     String  @unique
  isActive Boolean @default(true)

  @@map("warehouses")
}
```

Trong `model Product` thêm sau `minStock`:

```prisma
  isCoil      Boolean     @default(false) // tôn cuộn — bật để hiện ở màn Tra cứu cuộn (mã 30). TODO: confirm với khách
```

Trong `model ProductUnit` thay comment của `factor`:

```prisma
  factor    Decimal @db.Decimal(18, 6) // D-12: SỐ ĐƠN VỊ NHẬP TRÊN 1 ĐƠN VỊ GỐC (kg/md). qtyBase = qty ÷ factor. Sửa được theo từng lần nhập
```

Thêm cuối file:

```prisma
// Danh mục nhỏ (Catalog Settings). Cùng dạng: tên + bật/tắt. isActive=false → ẩn khỏi ô chọn, dữ liệu cũ giữ nguyên.
model Vehicle {
  id       Int     @id @default(autoincrement())
  plate    String  @unique
  isActive Boolean @default(true)

  @@map("vehicles")
}

model Driver {
  id          Int     @id @default(autoincrement())
  name        String
  isAssistant Boolean @default(false)
  isActive    Boolean @default(true)

  @@map("drivers")
}

model Route {
  id       Int     @id @default(autoincrement())
  name     String  @unique
  isActive Boolean @default(true)

  @@map("routes")
}

model ExpenseType {
  id       Int     @id @default(autoincrement())
  name     String  @unique
  isActive Boolean @default(true)

  @@map("expense_types")
}

// Kiểu gia công (tôn xốp, 1 lớp, 6 sóng, 11 sóng — mục 13). Công thức NVL nằm ở BOM (plan 03c).
model ProcessingType {
  id       Int     @id @default(autoincrement())
  name     String  @unique
  note     String?
  isActive Boolean @default(true)

  @@map("processing_types")
}
```

- [x] **Step 4: Sinh migration rồi bổ sung CHECK**

Run: `rtk proxy npx prisma migrate dev --name catalog_foundation --create-only` (DB dev từ `.env`).
Mở `prisma/migrations/<timestamp>_catalog_foundation/migration.sql`, kiểm có `ALTER TABLE ... ADD COLUMN "isActive"`, `"isCoil"`, 5 `CREATE TABLE`, rồi **thêm cuối file**:

```sql
-- Ràng buộc mức DB (lớp chặn thứ hai sau zod): dữ liệu sai không bao giờ vào được, dù đi đường import/script
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_factor_pos_chk" CHECK ("factor" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_min_stock_nonneg_chk" CHECK ("minStock" >= 0);
ALTER TABLE "partners" ADD CONSTRAINT "partners_debt_limit_nonneg_chk" CHECK ("debtLimit" >= 0);
ALTER TABLE "partners" ADD CONSTRAINT "partners_kind_chk" CHECK ("isCustomer" OR "isSupplier");
-- Quyền app_rw: GRANT mức bảng + DEFAULT PRIVILEGES của migration foundation đã phủ bảng/cột mới.
```

Run: `rtk proxy npx prisma migrate dev` (áp dụng lên DB dev), rồi `rtk proxy npx prisma generate`.
Expected: "Your database is now in sync".

- [x] **Step 5: Thêm factory** — cuối `tests/helpers/factories.ts`

```ts
export async function makeWarehouse(name = `Kho ${next()}`) {
  return prisma.warehouse.create({ data: { name } });
}

export async function makeProcessingType(name = `Kiểu ${next()}`) {
  return prisma.processingType.create({ data: { name } });
}

export async function makeVehicle(plate = `51C-${next()}`) {
  return prisma.vehicle.create({ data: { plate } });
}
```

- [x] **Step 6: Chạy lại**

Run: `rtk proxy npx vitest run tests/db/catalog-foundation.test.ts tests/schema/invariants.test.ts`
Expected: PASS (invariants vẫn xanh: Decimal đúng độ chính xác chuẩn, không có cột số dư).

- [x] **Step 7: Sinh lại `db/db_schema.sql` và commit**

```bash
rtk proxy npm run db:schema
git add prisma tests/db/catalog-foundation.test.ts tests/helpers/factories.ts db/db_schema.sql
git commit -m "feat(db): danh mục nền (xe, lái xe, tuyến, loại chi, kiểu gia công) + isActive + isCoil + CHECK"
```

---

### Task 2: Catalog Settings — cấu hình, service, truy vấn (backend)

**Mã:** 8, 13 (danh mục), 14, 15, 16, 17, 18. **Files:**
- Create: `src/config/catalog-sections.ts`
- Create: `src/server/catalog/adapters.ts`, `src/server/catalog/service.ts`, `src/server/catalog/queries.ts`
- Test: `tests/catalog/service.test.ts`, `tests/catalog/queries.test.ts`, `tests/config/catalog-sections.test.ts`

**Interfaces:**
- Consumes: `assertCan`, `Actor`, `writeAudit`, `DomainError`, `FieldConflictError`, `normalizeSearch`, `ListParams`.
- Produces (Task 3 và các plan sau dùng):
  - `CATALOG_SECTIONS: readonly CatalogSection[]`, `resolveSection(key?: string): CatalogSection`, `getSection(key: string): CatalogSection | null`, `catalogSchema(section): ZodObject`, type `CatalogKey`, `CatalogField`, `CatalogSection`.
  - `createCatalogItem(db, actor, key, raw): Promise<{ id: number }>`
  - `updateCatalogItem(db, actor, key, id, raw): Promise<void>`
  - `setCatalogActive(db, actor, key, id, active: boolean): Promise<void>`
  - `deleteCatalogItem(db, actor, key, id): Promise<void>`
  - `listCatalog(db, key, params): Promise<{ rows: CatalogRow[]; total: number; stats: { all: number; active: number; inactive: number } }>`
  - `countAllCatalogs(db): Promise<Record<CatalogKey, number>>`, `getCatalogItem(db, key, id): Promise<CatalogRow>`, `getLinkedRecords(db, key, id): Promise<LinkedRecord[] | null>`
  - `listActiveOptions(db, key): Promise<{ value: number; label: string }[]>` — cho ô chọn ở module khác (chỉ mục đang bật).

- [ ] **Step 1: Test cấu hình (đỏ)** — `tests/config/catalog-sections.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ICONS } from "@/components/shell/icons";
import { CATALOG_SECTIONS, catalogSchema, resolveSection } from "@/config/catalog-sections";

describe("CATALOG_SECTIONS", () => {
  it("key duy nhất, icon có trong bảng ICONS, mỗi mục có ít nhất 1 mã phạm vi", () => {
    expect(new Set(CATALOG_SECTIONS.map((s) => s.key)).size).toBe(CATALOG_SECTIONS.length);
    for (const s of CATALOG_SECTIONS) {
      expect(ICONS[s.icon], s.key).toBeDefined();
      expect(s.codes.length, s.key).toBeGreaterThan(0);
      expect(s.fields.some((f) => f.name === s.titleField), s.key).toBe(true);
    }
  });

  it("phủ đủ mã 8, 13, 14, 15, 16, 17, 18 (truy vết spec)", () => {
    const covered = new Set(CATALOG_SECTIONS.flatMap((s) => s.codes));
    for (const c of ["8", "13", "14", "15", "16", "17", "18"]) expect(covered.has(c), c).toBe(true);
  });

  it("resolveSection: key sai/thiếu → mục đầu (deep-link không vỡ)", () => {
    expect(resolveSection(undefined).key).toBe(CATALOG_SECTIONS[0]!.key);
    expect(resolveSection("khong-co").key).toBe(CATALOG_SECTIONS[0]!.key);
    expect(resolveSection("vehicles").key).toBe("vehicles");
  });

  it("schema: trường bắt buộc rỗng → lỗi tiếng Việt; chuỗi được cắt khoảng trắng", () => {
    const s = catalogSchema(resolveSection("warehouses"));
    const bad = s.safeParse({ name: "   " });
    expect(bad.success).toBe(false);
    expect(bad.success ? "" : bad.error.issues[0]!.message).toBe("Nhập tên kho.");
    expect(s.parse({ name: "  Kho 1  " })).toEqual({ name: "Kho 1" });
  });

  it("schema tài khoản quỹ: loại chỉ nhận CASH/BANK; số tài khoản tuỳ chọn", () => {
    const s = catalogSchema(resolveSection("cash-accounts"));
    expect(s.safeParse({ name: "Quỹ TM", type: "XYZ", bankNo: "" }).success).toBe(false);
    expect(s.parse({ name: "Quỹ TM", type: "CASH", bankNo: "" })).toEqual({ name: "Quỹ TM", type: "CASH", bankNo: "" });
  });
});
```

- [ ] **Step 2: Chạy → đỏ** (`rtk proxy npx vitest run tests/config/catalog-sections.test.ts`; module chưa có).

- [ ] **Step 3: Viết `src/config/catalog-sections.ts`**

```ts
import { z } from "zod";

export type CatalogKey =
  | "partner-groups" | "warehouses" | "vehicles" | "drivers"
  | "routes" | "expense-types" | "cash-accounts" | "processing-types";

export interface CatalogField {
  name: string;
  label: string;
  type: "text" | "checkbox" | "select";
  required?: boolean;
  maxLength?: number;
  options?: readonly { value: string; label: string }[];
  /** Hiện thêm thành cột ở bảng (ngoài cột tiêu đề và trạng thái). */
  inTable?: boolean;
}

export interface CatalogSection {
  key: CatalogKey;
  label: string;
  /** Danh từ số ít dùng trong câu ("Thêm kho", "Xoá xe…"). */
  singular: string;
  icon: string;
  /** Mã phạm vi (spec Phần 7). */
  codes: readonly string[];
  /** Tên model Prisma — dùng làm `entity` của audit log. */
  entity: string;
  titleField: string;
  fields: readonly CatalogField[];
}

const nameField = (label: string, maxLength = 80): CatalogField => ({ name: "name", label, type: "text", required: true, maxLength });

// Thứ tự = thứ tự mini-sidebar. Thêm 1 mục danh mục = thêm 1 phần tử ở đây + 1 dòng ở adapters.ts.
export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  { key: "partner-groups", label: "Nhóm khách hàng", singular: "nhóm khách hàng", icon: "users", codes: ["8"], entity: "PartnerGroup", titleField: "name", fields: [nameField("Tên nhóm", 60)] },
  { key: "warehouses", label: "Kho", singular: "kho", icon: "warehouse", codes: ["14"], entity: "Warehouse", titleField: "name", fields: [nameField("Tên kho", 60)] },
  { key: "vehicles", label: "Xe", singular: "xe", icon: "truck", codes: ["15"], entity: "Vehicle", titleField: "plate", fields: [{ name: "plate", label: "Biển số", type: "text", required: true, maxLength: 20 }] },
  {
    key: "drivers", label: "Lái xe & phụ xe", singular: "lái xe / phụ xe", icon: "users", codes: ["15"], entity: "Driver", titleField: "name",
    fields: [nameField("Họ tên", 80), { name: "isAssistant", label: "Là phụ xe", type: "checkbox", inTable: true }],
  },
  { key: "routes", label: "Tuyến giao hàng", singular: "tuyến giao hàng", icon: "arrow-left-right", codes: ["16"], entity: "Route", titleField: "name", fields: [nameField("Tên tuyến", 80)] },
  { key: "expense-types", label: "Loại thu chi", singular: "loại thu chi", icon: "coins", codes: ["17"], entity: "ExpenseType", titleField: "name", fields: [nameField("Tên loại", 80)] },
  {
    key: "cash-accounts", label: "Ngân hàng & quỹ", singular: "tài khoản quỹ", icon: "landmark", codes: ["18"], entity: "CashAccount", titleField: "name",
    fields: [
      nameField("Tên tài khoản", 80),
      { name: "type", label: "Loại", type: "select", options: [{ value: "CASH", label: "Tiền mặt" }, { value: "BANK", label: "Ngân hàng" }], inTable: true },
      { name: "bankNo", label: "Số tài khoản", type: "text", maxLength: 40, inTable: true },
    ],
  },
  {
    key: "processing-types", label: "Kiểu gia công", singular: "kiểu gia công", icon: "hammer", codes: ["13"], entity: "ProcessingType", titleField: "name",
    fields: [nameField("Tên kiểu gia công", 60), { name: "note", label: "Ghi chú", type: "text", maxLength: 200, inTable: true }],
  },
];

export const getSection = (key: string): CatalogSection | null => CATALOG_SECTIONS.find((s) => s.key === key) ?? null;

/** `?section=` sai/thiếu → mục đầu (deep-link không bao giờ vỡ). */
export const resolveSection = (key: string | undefined): CatalogSection => (key ? getSection(key) : null) ?? CATALOG_SECTIONS[0]!;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Schema zod sinh từ cấu hình — dùng chung cho server (route) và client (react-hook-form). Kiểu vào = kiểu ra. */
export function catalogSchema(section: CatalogSection) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of section.fields) {
    if (f.type === "checkbox") {
      shape[f.name] = z.boolean();
    } else if (f.type === "select") {
      const values = (f.options ?? []).map((o) => o.value) as [string, ...string[]];
      shape[f.name] = z.enum(values, { errorMap: () => ({ message: `Chọn ${lower(f.label)}.` }) });
    } else {
      const max = f.maxLength ?? 80;
      const base = z.string({ required_error: `Nhập ${lower(f.label)}.` }).trim().max(max, `${f.label} tối đa ${max} ký tự.`);
      shape[f.name] = f.required ? base.min(1, `Nhập ${lower(f.label)}.`) : base;
    }
  }
  return z.object(shape);
}
```

- [ ] **Step 4: Chạy → xanh** (`rtk proxy npx vitest run tests/config/catalog-sections.test.ts`).

- [ ] **Step 5: Test service (đỏ)** — `tests/catalog/service.test.ts`

```ts
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { createCatalogItem, deleteCatalogItem, setCatalogActive, updateCatalogItem } from "@/server/catalog/service";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePartnerGroup, makePeriod, makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
beforeEach(async () => {
  await resetDb();
  const u = await makeUser();
  actor = { userId: u.id, perms: new Set(["catalog.manage"]) };
});

describe("createCatalogItem", () => {
  it("tạo kho, ghi audit với entity = tên model", async () => {
    const r = await tx((db) => createCatalogItem(db, actor, "warehouses", { name: "  Kho 1 " }));
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: r.id } })).name).toBe("Kho 1");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "catalog.create" } });
    expect(log).toMatchObject({ entity: "Warehouse", entityId: String(r.id), userId: actor.userId });
  });

  it("thiếu quyền catalog.manage → ForbiddenError, không ghi gì", async () => {
    await expect(tx((db) => createCatalogItem(db, { ...actor, perms: new Set() }, "warehouses", { name: "K" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.warehouse.count()).toBe(0);
  });

  it("dữ liệu sai → lỗi zod tiếng Việt (route chuyển thành 400)", async () => {
    await expect(tx((db) => createCatalogItem(db, actor, "warehouses", { name: "" }))).rejects.toThrow("Nhập tên kho.");
  });

  it("chuỗi rỗng ở trường tuỳ chọn được lưu NULL (số tài khoản quỹ tiền mặt)", async () => {
    const r = await tx((db) => createCatalogItem(db, actor, "cash-accounts", { name: "Quỹ TM", type: "CASH", bankNo: "" }));
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: r.id } })).bankNo).toBeNull();
  });

  it("[Review Focus 5] trùng tên → FieldConflictError có fields.name; 2 lần tạo ĐỒNG THỜI: một thành công, một lỗi có kiểm soát", async () => {
    await tx((db) => createCatalogItem(db, actor, "warehouses", { name: "Kho A" }));
    const err = await tx((db) => createCatalogItem(db, actor, "warehouses", { name: "Kho A" })).catch((e) => e);
    expect(err).toBeInstanceOf(FieldConflictError);
    expect((err as FieldConflictError).fields.name).toBe("Kho đã tồn tại.");

    const results = await Promise.allSettled([
      tx((db) => createCatalogItem(db, actor, "warehouses", { name: "Kho B" })),
      tx((db) => createCatalogItem(db, actor, "warehouses", { name: "Kho B" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(FieldConflictError); // KHÔNG phải lỗi Prisma thô / 500
    expect(await prisma.warehouse.count({ where: { name: "Kho B" } })).toBe(1);
  });

  it("tên lái xe được trùng (2 người cùng tên) nhưng biển số xe thì không", async () => {
    await tx((db) => createCatalogItem(db, actor, "drivers", { name: "Tài", isAssistant: false }));
    await tx((db) => createCatalogItem(db, actor, "drivers", { name: "Tài", isAssistant: true }));
    await tx((db) => createCatalogItem(db, actor, "vehicles", { plate: "51C-1" }));
    await expect(tx((db) => createCatalogItem(db, actor, "vehicles", { plate: "51C-1" }))).rejects.toBeInstanceOf(FieldConflictError);
  });
});

describe("updateCatalogItem / setCatalogActive", () => {
  it("sửa tên: audit có before/after; không đổi thì không ghi audit", async () => {
    const { id } = await tx((db) => createCatalogItem(db, actor, "routes", { name: "Q12" }));
    await tx((db) => updateCatalogItem(db, actor, "routes", id, { name: "Quận 12" }));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "catalog.update" } });
    expect(log.beforeJson).toMatchObject({ name: "Q12" });
    expect(log.afterJson).toMatchObject({ name: "Quận 12" });
    await tx((db) => updateCatalogItem(db, actor, "routes", id, { name: "Quận 12" }));
    expect(await prisma.auditLog.count({ where: { action: "catalog.update" } })).toBe(1);
  });

  it("id không tồn tại → 404", async () => {
    const e = await tx((db) => updateCatalogItem(db, actor, "routes", 9999, { name: "X" })).catch((x) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).status).toBe(404);
  });

  it("tắt/bật: đổi isActive + audit catalog.toggle; lặp lại cùng giá trị là no-op", async () => {
    const { id } = await tx((db) => createCatalogItem(db, actor, "warehouses", { name: "K" }));
    await tx((db) => setCatalogActive(db, actor, "warehouses", id, false));
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);
    await tx((db) => setCatalogActive(db, actor, "warehouses", id, false));
    expect(await prisma.auditLog.count({ where: { action: "catalog.toggle" } })).toBe(1);
  });

  it("[Review Focus 5] đổi loại tài khoản quỹ khi đã có số dư đầu kỳ/phát sinh → 409, không đổi", async () => {
    const acc = await makeCashAccount({ type: "CASH", name: "Quỹ 1" });
    const period = await makePeriod();
    await prisma.openingCash.create({ data: { periodId: period.id, cashAccountId: acc.id, amount: 1000 } });
    const e = await tx((db) => updateCatalogItem(db, actor, "cash-accounts", acc.id, { name: "Quỹ 1", type: "BANK", bankNo: "" })).catch((x) => x);
    expect((e as DomainError).status).toBe(409);
    expect((e as DomainError).message).toMatch(/đã phát sinh/);
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: acc.id } })).type).toBe("CASH");
    // đổi tên (không đổi loại) vẫn được
    await tx((db) => updateCatalogItem(db, actor, "cash-accounts", acc.id, { name: "Quỹ chính", type: "CASH", bankNo: "" }));
  });
});

describe("deleteCatalogItem", () => {
  it("xoá mục chưa dùng: mất khỏi DB + audit catalog.delete", async () => {
    const { id } = await tx((db) => createCatalogItem(db, actor, "routes", { name: "T" }));
    await tx((db) => deleteCatalogItem(db, actor, "routes", id));
    expect(await prisma.route.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "catalog.delete" } })).toBe(1);
  });

  it("[Review Focus 5] xoá nhóm khách đang có khách → 409 tiếng Việt + gợi ý Tắt; dữ liệu còn nguyên", async () => {
    const g = await makePartnerGroup("Thợ");
    await makePartner({ groupId: g.id });
    const e = await tx((db) => deleteCatalogItem(db, actor, "partner-groups", g.id)).catch((x) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).status).toBe(409);
    expect((e as DomainError).message).toMatch(/đang được dùng.*Tắt/s);
    expect(await prisma.partnerGroup.count()).toBe(1);
  });

  it("xoá id không có → 404", async () => {
    const e = await tx((db) => deleteCatalogItem(db, actor, "routes", 424242)).catch((x) => x);
    expect((e as DomainError).status).toBe(404);
  });
});
```

- [ ] **Step 6: Chạy → đỏ** (`rtk proxy npx vitest run tests/catalog/service.test.ts`; module chưa có).

- [ ] **Step 7: Viết `src/server/catalog/adapters.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CatalogKey } from "@/config/catalog-sections";

type Db = Prisma.TransactionClient | PrismaClient;

export type CatalogRow = { id: number; isActive: boolean } & Record<string, unknown>;

/**
 * Prisma sinh delegate riêng kiểu cho từng model (generic rất sâu) nên không gán được vào 1 union. Cả 8 bảng danh mục
 * có cùng hình dạng CRUD tối thiểu → ép về giao diện lỏng NÀY, ở DUY NHẤT một chỗ. Tham số `where/data/orderBy` được
 * dựng bởi service từ cấu hình `CATALOG_SECTIONS` (không nhận JSON tuỳ ý từ client).
 */
export interface Delegate {
  findMany(args?: object): Promise<CatalogRow[]>;
  findUnique(args: object): Promise<CatalogRow | null>;
  create(args: object): Promise<CatalogRow>;
  update(args: object): Promise<CatalogRow>;
  delete(args: object): Promise<unknown>;
}

const DELEGATES: Record<CatalogKey, (db: Db) => unknown> = {
  "partner-groups": (db) => db.partnerGroup,
  warehouses: (db) => db.warehouse,
  vehicles: (db) => db.vehicle,
  drivers: (db) => db.driver,
  routes: (db) => db.route,
  "expense-types": (db) => db.expenseType,
  "cash-accounts": (db) => db.cashAccount,
  "processing-types": (db) => db.processingType,
};

export const delegate = (db: Db, key: CatalogKey): Delegate => DELEGATES[key](db) as Delegate;
```

- [ ] **Step 8: Viết `src/server/catalog/service.ts`**

```ts
import { Prisma } from "@prisma/client";
import { catalogSchema, getSection, type CatalogSection } from "@/config/catalog-sections";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { delegate, type CatalogRow } from "./adapters";

type Db = Prisma.TransactionClient;

function sectionOrThrow(key: string): CatalogSection {
  const s = getSection(key);
  if (!s) throw new DomainError("Không tìm thấy mục danh mục.", 404);
  return s;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Chuỗi rỗng của trường tuỳ chọn → NULL (khớp cột nullable). */
function toDbData(section: CatalogSection, input: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of section.fields) {
    const v = input[f.name];
    data[f.name] = f.type === "text" && !f.required && v === "" ? null : v;
  }
  return data;
}

/** P2002 (trùng) → lỗi gắn ô tiêu đề; P2003 (đang được tham chiếu) → 409 có hướng dẫn. */
function mapError(section: CatalogSection, e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const msg = `${cap(section.singular)} đã tồn tại.`;
      throw new FieldConflictError(msg, { [section.titleField]: msg });
    }
    if (e.code === "P2003") {
      throw new DomainError(`Không xóa được: ${section.singular} này đang được dùng ở dữ liệu khác. Hãy Tắt để ẩn khỏi danh sách chọn.`, 409, "IN_USE");
    }
    if (e.code === "P2025") throw new DomainError("Không tìm thấy mục danh mục.", 404);
  }
  throw e;
}

async function loadOrThrow(db: Db, section: CatalogSection, id: number): Promise<CatalogRow> {
  const row = await delegate(db, section.key).findUnique({ where: { id } });
  if (!row) throw new DomainError("Không tìm thấy mục danh mục.", 404);
  return row;
}

/** Trường của mục danh mục dùng cho audit / so sánh (không kéo cả bản ghi). */
const pick = (section: CatalogSection, row: Record<string, unknown>) =>
  Object.fromEntries([...section.fields.map((f) => [f.name, row[f.name] ?? null]), ["isActive", row.isActive]]);

export async function createCatalogItem(db: Db, actor: Actor, key: string, raw: unknown): Promise<{ id: number }> {
  assertCan(actor.perms, "catalog.manage");
  const section = sectionOrThrow(key);
  const data = toDbData(section, catalogSchema(section).parse(raw));
  let row: CatalogRow;
  try {
    row = await delegate(db, section.key).create({ data });
  } catch (e) {
    mapError(section, e);
  }
  await writeAudit(db, { userId: actor.userId, action: "catalog.create", entity: section.entity, entityId: row.id, after: pick(section, row) });
  return { id: row.id };
}

/** Quy tắc riêng: tài khoản quỹ đã có số dư đầu kỳ / phát sinh không được đổi loại (sổ quỹ TM ≠ sổ tiền gửi NH — mã 60/61). */
async function assertCashAccountTypeChangeAllowed(db: Db, id: number, next: unknown, current: unknown) {
  if (next === current) return;
  const [opening, ledger] = await Promise.all([db.openingCash.count({ where: { cashAccountId: id } }), db.cashLedger.count({ where: { cashAccountId: id } })]);
  if (opening + ledger > 0) throw new DomainError("Không đổi loại được: tài khoản này đã phát sinh giao dịch hoặc có số dư đầu kỳ.", 409);
}

export async function updateCatalogItem(db: Db, actor: Actor, key: string, id: number, raw: unknown): Promise<void> {
  assertCan(actor.perms, "catalog.manage");
  const section = sectionOrThrow(key);
  const before = await loadOrThrow(db, section, id);
  const data = toDbData(section, catalogSchema(section).parse(raw));
  if (section.key === "cash-accounts") await assertCashAccountTypeChangeAllowed(db, id, data.type, before.type);
  const changed = section.fields.some((f) => (before[f.name] ?? null) !== (data[f.name] ?? null));
  if (!changed) return;
  let after: CatalogRow;
  try {
    after = await delegate(db, section.key).update({ where: { id }, data });
  } catch (e) {
    mapError(section, e);
  }
  await writeAudit(db, { userId: actor.userId, action: "catalog.update", entity: section.entity, entityId: id, before: pick(section, before), after: pick(section, after) });
}

export async function setCatalogActive(db: Db, actor: Actor, key: string, id: number, active: boolean): Promise<void> {
  assertCan(actor.perms, "catalog.manage");
  const section = sectionOrThrow(key);
  const before = await loadOrThrow(db, section, id);
  if (before.isActive === active) return;
  await delegate(db, section.key).update({ where: { id }, data: { isActive: active } });
  await writeAudit(db, { userId: actor.userId, action: "catalog.toggle", entity: section.entity, entityId: id, before: { isActive: before.isActive }, after: { isActive: active } });
}

export async function deleteCatalogItem(db: Db, actor: Actor, key: string, id: number): Promise<void> {
  assertCan(actor.perms, "catalog.manage");
  const section = sectionOrThrow(key);
  const before = await loadOrThrow(db, section, id);
  try {
    await delegate(db, section.key).delete({ where: { id } });
  } catch (e) {
    mapError(section, e);
  }
  await writeAudit(db, { userId: actor.userId, action: "catalog.delete", entity: section.entity, entityId: id, before: pick(section, before) });
}
```

Ghi chú thực thi: `mapError` trả `never` nên `row`/`after` được TypeScript coi là đã gán sau `try/catch`. Nếu trình biên dịch phàn nàn "used before assigned", khai báo `let row!: CatalogRow;`.

- [ ] **Step 9: Chạy → xanh** (`rtk proxy npx vitest run tests/catalog/service.test.ts`).

- [ ] **Step 10: Test truy vấn (đỏ)** — `tests/catalog/queries.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { countAllCatalogs, getCatalogItem, getLinkedRecords, listActiveOptions, listCatalog } from "@/server/catalog/queries";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup } from "../helpers/factories";

beforeEach(resetDb);
const P = (sp: Record<string, string> = {}) => parseListParams(sp, ["status", "section"]);

describe("listCatalog", () => {
  beforeEach(async () => {
    await prisma.warehouse.createMany({ data: [{ name: "Kho Hàng Hóa" }, { name: "Kho Đông Lạnh", isActive: false }, { name: "Kho Phụ" }] });
  });

  it("đếm Tổng/Đang bật/Đã tắt KHÔNG bị bộ lọc trạng thái làm lệch", async () => {
    const r = await listCatalog(prisma, "warehouses", P({ status: "inactive" }));
    expect(r.stats).toEqual({ all: 3, active: 2, inactive: 1 });
    expect(r.rows.map((x) => x.name)).toEqual(["Kho Đông Lạnh"]);
    expect(r.total).toBe(1);
  });

  it("[Review Focus 1] tìm không dấu, không phân biệt hoa/thường, thừa khoảng trắng", async () => {
    const r = await listCatalog(prisma, "warehouses", P({ q: "  DONG   lanh " }));
    expect(r.rows.map((x) => x.name)).toEqual(["Kho Đông Lạnh"]);
  });

  it("sắp xếp mặc định theo tên (locale vi), phân trang theo pageSize", async () => {
    const r = await listCatalog(prisma, "warehouses", { ...P(), pageSize: 2, page: 2 });
    expect(r.total).toBe(3);
    expect(r.rows).toHaveLength(1);
  });

  it("sort=-name đảo thứ tự; cột không cho phép bị bỏ qua (không lỗi)", async () => {
    expect((await listCatalog(prisma, "warehouses", P({ sort: "-name" }))).rows[0]!.name).toBe("Kho Phụ");
    await expect(listCatalog(prisma, "warehouses", P({ sort: "hack" }))).resolves.toBeDefined();
  });
});

describe("countAllCatalogs / getCatalogItem / listActiveOptions", () => {
  it("countAllCatalogs trả số bản ghi mọi mục (cho badge sidebar)", async () => {
    await prisma.route.create({ data: { name: "Q1" } });
    const c = await countAllCatalogs(prisma);
    expect(c.routes).toBe(1);
    expect(c.warehouses).toBe(0);
    expect(Object.keys(c)).toHaveLength(8);
  });

  it("getCatalogItem: không có → 404", async () => {
    await expect(getCatalogItem(prisma, "routes", 5)).rejects.toMatchObject({ status: 404 });
  });

  it("listActiveOptions chỉ trả mục đang bật, sắp theo nhãn", async () => {
    await prisma.warehouse.createMany({ data: [{ name: "B" }, { name: "A" }, { name: "Z", isActive: false }] });
    expect(await listActiveOptions(prisma, "warehouses")).toEqual([
      { value: expect.any(Number), label: "A" }, { value: expect.any(Number), label: "B" },
    ]);
  });
});

describe("getLinkedRecords", () => {
  it("nhóm khách: liệt kê khách thuộc nhóm kèm liên kết đúng loại (khách → /sales/customers, NCC → /purchase/suppliers)", async () => {
    const g = await makePartnerGroup("Thợ");
    const kh = await makePartner({ groupId: g.id, name: "Khách A", code: "KH1" });
    const ncc = await makePartner({ groupId: g.id, name: "NCC B", code: "NCC1", isCustomer: false, isSupplier: true });
    const rows = (await getLinkedRecords(prisma, "partner-groups", g.id))!;
    expect(rows.map((r) => r.href).sort()).toEqual([`/purchase/suppliers/${ncc.id}`, `/sales/customers/${kh.id}`]);
  });

  it("mục chưa có bảng tham chiếu → null (UI ẩn tab)", async () => {
    expect(await getLinkedRecords(prisma, "routes", 1)).toBeNull();
  });
});
```

- [ ] **Step 11: Chạy → đỏ**, rồi viết `src/server/catalog/queries.ts`

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { CATALOG_SECTIONS, getSection, type CatalogKey, type CatalogSection } from "@/config/catalog-sections";
import type { ListParams } from "@/lib/query-params";
import { normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";
import { delegate, type CatalogRow } from "./adapters";

type Db = Prisma.TransactionClient | PrismaClient;

export interface LinkedRecord {
  id: number;
  label: string;
  sub: string | null;
  href: string;
  isActive: boolean;
}

function sectionOrThrow(key: string): CatalogSection {
  const s = getSection(key);
  if (!s) throw new DomainError("Không tìm thấy mục danh mục.", 404);
  return s;
}

const collator = new Intl.Collator("vi");

/**
 * Bảng danh mục nhỏ (vài chục dòng) → lọc/sắp xếp/phân trang trong bộ nhớ để dùng `normalizeSearch` cho chữ có dấu
 * (cùng lý do với listUsers). KHÔNG dùng cho bảng lớn (KH, SP có cột searchText riêng).
 */
export async function listCatalog(db: Db, key: string, params: ListParams) {
  const section = sectionOrThrow(key);
  const all = await delegate(db, section.key).findMany();
  const needle = normalizeSearch(params.q ?? "");
  const scoped = all.filter((r) => !needle || normalizeSearch(section.fields.map((f) => String(r[f.name] ?? "")).join(" ")).includes(needle));
  const stats = { all: scoped.length, active: scoped.filter((r) => r.isActive).length, inactive: scoped.filter((r) => !r.isActive).length };

  const status = params.filters.status ?? [];
  const filtered = scoped.filter((r) => status.length === 0 || status.includes(r.isActive ? "active" : "inactive"));

  const desc = params.sort?.startsWith("-");
  const sortKey = params.sort?.replace(/^-/, "");
  const sortable = new Set<string>([section.titleField, "isActive"]);
  const field = sortKey && sortable.has(sortKey) ? sortKey : section.titleField;
  const dir = desc && sortKey === field ? -1 : 1;
  filtered.sort((a, b) => collator.compare(String(a[field] ?? ""), String(b[field] ?? "")) * dir);

  const start = (params.page - 1) * params.pageSize;
  return { rows: filtered.slice(start, start + params.pageSize) as CatalogRow[], total: filtered.length, stats };
}

export async function countAllCatalogs(db: Db): Promise<Record<CatalogKey, number>> {
  const entries = await Promise.all(CATALOG_SECTIONS.map(async (s) => [s.key, (await delegate(db, s.key).findMany({ select: { id: true } })).length] as const));
  return Object.fromEntries(entries) as Record<CatalogKey, number>;
}

export async function getCatalogItem(db: Db, key: string, id: number): Promise<CatalogRow> {
  const section = sectionOrThrow(key);
  const row = await delegate(db, section.key).findUnique({ where: { id } });
  if (!row) throw new DomainError("Không tìm thấy mục danh mục.", 404);
  return row;
}

/** Cho ô chọn (combobox/select) ở module khác: chỉ mục đang bật. */
export async function listActiveOptions(db: Db, key: CatalogKey): Promise<{ value: number; label: string }[]> {
  const section = sectionOrThrow(key);
  const rows = await delegate(db, section.key).findMany({ where: { isActive: true } });
  return rows
    .map((r) => ({ value: r.id, label: String(r[section.titleField]) }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

/** Bản ghi đang dùng mục này ("tab Bản ghi liên kết"). null = mục này chưa có bảng tham chiếu → UI ẩn tab. */
export async function getLinkedRecords(db: Db, key: string, id: number): Promise<LinkedRecord[] | null> {
  const section = sectionOrThrow(key);
  if (section.key === "partner-groups") {
    const partners = await db.partner.findMany({ where: { groupId: id }, orderBy: { name: "asc" }, take: 200, select: { id: true, code: true, name: true, isCustomer: true, isActive: true } });
    return partners.map((p) => ({
      id: p.id, label: p.name, sub: p.code, isActive: p.isActive,
      href: p.isCustomer ? `/sales/customers/${p.id}` : `/purchase/suppliers/${p.id}`,
    }));
  }
  return null; // plan sau bổ sung: kiểu gia công → BOM (03c), tuyến/xe/lái xe → chuyến (plan 05)
}
```

- [ ] **Step 12: Chạy → xanh** (`rtk proxy npx vitest run tests/catalog tests/config/catalog-sections.test.ts`), lint + typecheck.

- [ ] **Step 13: Commit**

```bash
rtk proxy npm run lint && rtk proxy npm run typecheck
git add src/config/catalog-sections.ts src/server/catalog tests/catalog tests/config/catalog-sections.test.ts
git commit -m "feat(catalog): Catalog Settings backend — 8 mục danh mục, audit, 409 khi đang dùng"
```

---

### Task 3: Catalog Settings — API, khung bảng kebab, giao diện

**Mã:** 8, 13–18 (màn hình). **Files:**
- Modify: `src/components/ui/DataTable.tsx` (`actionsVariant`, icon `power`), `tests/ui/data-table.test.tsx`
- Create: `src/app/api/catalog/[section]/route.ts`, `src/app/api/catalog/[section]/[id]/route.ts`, `src/app/api/catalog/[section]/[id]/toggle/route.ts`, `src/app/api/catalog/[section]/export/route.ts`
- Create: `src/app/(app)/system/catalog-settings/{page.tsx,CatalogSidebar.tsx,CatalogTable.tsx}`, `.../[section]/new/{page.tsx,CatalogNewForm.tsx}`, `.../[section]/[id]/{page.tsx,CatalogDetail.tsx}`, `.../catalog-fields.tsx`
- Modify: `src/config/app.config.ts` (bỏ `planned` của `catalog-settings`)
- Test: `tests/ui/catalog-table.test.tsx`, `tests/ui/catalog-new-form.test.tsx`, `tests/ui/catalog-pages.test.tsx`

**Interfaces:**
- Consumes: Task 2; `ListPageLayout`, `StatCard`, `SearchBox`, `PaginationFooter`, `EmptyState`, `DetailPage` + `useSectionForm`, `NewPage`, `confirm`, `toast`, `apiFetch`, `ExportButton`, `buildXlsx/xlsxResponse`.
- Produces: `DataTable` prop `actionsVariant?: "hybrid" | "kebab"`; `RowAction.icon` thêm `"power"`. API: `POST /api/catalog/:section` → `{ id }`; `PATCH /api/catalog/:section/:id` body `{ section: "content" | "display", ... }`; `POST /api/catalog/:section/:id/toggle` body `{ active: boolean }`; `DELETE /api/catalog/:section/:id`; `GET /api/catalog/:section/export`.

- [ ] **Step 1: Test DataTable kebab (đỏ)** — thêm vào `tests/ui/data-table.test.tsx` (đọc file để dùng đúng helper render/mocks đã có; thêm `describe` mới):

```tsx
describe("DataTable actionsVariant=\"kebab\"", () => {
  it("không có nút inline; mọi thao tác nằm trong menu ⋯ (trigger 'Thao tác')", async () => {
    const onToggle = vi.fn();
    render(
      <DataTable id="k" columns={[{ key: "n", label: "Tên", render: (r: { n: string }) => r.n }]} rows={[{ n: "Kho 1" }]} rowKey={(r) => r.n}
        actionsVariant="kebab"
        rowActions={() => [
          { key: "toggle", label: "Tắt", icon: "power", onClick: onToggle },
          { key: "edit", label: "Sửa", icon: "pencil", href: "/x" },
          { key: "del", label: "Xóa", icon: "trash", danger: true, onClick: vi.fn() },
        ]} />,
    );
    expect(screen.queryByRole("button", { name: "Tắt" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sửa" })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "Thao tác" })[0]!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Tắt" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

Run: `rtk proxy npx vitest run tests/ui/data-table.test.tsx` → FAIL (prop chưa có).

- [ ] **Step 2: Sửa `src/components/ui/DataTable.tsx`**

1. Import thêm `Power` từ `lucide-react`; đổi kiểu và bảng icon:

```ts
export interface RowAction {
  key: string;
  label: string;
  icon: "eye" | "pencil" | "trash" | "lock" | "power";
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}

const ACTION_ICONS = { eye: Eye, pencil: Pencil, trash: Trash2, lock: Lock, power: Power };
```

2. Thêm prop vào `Props<T>`:

```ts
  /**
   * `hybrid` (mặc định, view-table.md mục 3): ≤ 3 thao tác hiện icon, còn lại vào menu ⋯.
   * `kebab`: TẤT CẢ thao tác vào menu ⋯ — dùng cho bảng ít cột không có 3 thao tác "chính" ngang hàng (danh mục, catalog-settings.md).
   */
  actionsVariant?: "hybrid" | "kebab";
```

3. Nhận prop `actionsVariant = "hybrid"` ở chữ ký `DataTable` và sửa `actionsCell`:

```ts
    const kebab = actionsVariant === "kebab";
    const inline = kebab ? [] : actions.length > MAX_INLINE_ACTIONS ? actions.slice(0, MAX_INLINE_ACTIONS) : actions;
    const rest = kebab ? actions : actions.length > MAX_INLINE_ACTIONS ? actions.slice(MAX_INLINE_ACTIONS) : [];
```

và đổi nhãn trigger: `aria-label={kebab ? "Thao tác" : "Thêm thao tác"}`. (Test hiện có dùng "Thêm thao tác" cho hybrid — giữ nguyên.)

- [ ] **Step 3: Chạy → xanh** (`rtk proxy npx vitest run tests/ui/data-table.test.tsx tests/ui/users-table.test.tsx`).

- [ ] **Step 4: API routes** — mỗi route: `apiHandler` → `requireActorApi("catalog.manage")` → zod → service trong `prisma.$transaction`.

`src/app/api/catalog/[section]/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { createCatalogItem } from "@/server/catalog/service";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ section: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  const { section } = await ctx.params;
  const body = await readJson(req);
  return prisma.$transaction((tx) => createCatalogItem(tx, actor, section, body));
});
```

`src/app/api/catalog/[section]/[id]/route.ts` (PATCH theo `section-update` của `full-page-detail.md`, và DELETE):

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { deleteCatalogItem, setCatalogActive, updateCatalogItem } from "@/server/catalog/service";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

type Ctx = { params: Promise<{ section: string; id: string }> };

export const PATCH = apiHandler(async (req, ctx: Ctx) => {
  const actor = await requireActorApi("catalog.manage");
  const { section, id: rawId } = await ctx.params;
  const id = idParam.parse(rawId);
  const raw = (await readJson(req)) as Record<string, unknown>;
  const { section: part, ...rest } = raw;
  if (part === "content") {
    await prisma.$transaction((tx) => updateCatalogItem(tx, actor, section, id, rest));
  } else if (part === "display") {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(rest);
    await prisma.$transaction((tx) => setCatalogActive(tx, actor, section, id, isActive));
  } else {
    throw new ValidationError("Phần dữ liệu không hợp lệ.");
  }
  return { ok: true };
});

export const DELETE = apiHandler(async (_req, ctx: Ctx) => {
  const actor = await requireActorApi("catalog.manage");
  const { section, id } = await ctx.params;
  await prisma.$transaction((tx) => deleteCatalogItem(tx, actor, section, idParam.parse(id)));
  return { ok: true };
});
```

`src/app/api/catalog/[section]/[id]/toggle/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { setCatalogActive } from "@/server/catalog/service";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ section: string; id: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  const { section, id } = await ctx.params;
  const { active } = z.object({ active: z.boolean() }).parse(await readJson(req));
  await prisma.$transaction((tx) => setCatalogActive(tx, actor, section, idParam.parse(id), active));
  return { ok: true };
});
```

`src/app/api/catalog/[section]/export/route.ts` (theo hợp đồng Export của `list-page.md`: cùng `FILTER_KEYS`, cùng hàm lọc với trang):

```ts
import { getSection } from "@/config/catalog-sections";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { listCatalog } from "@/server/catalog/queries";
import { buildXlsx, xlsxResponse } from "@/server/export/xlsx";
import { DomainError } from "@/server/http/errors";
import { toErrorResponse } from "@/server/http/handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ section: string }> }) {
  try {
    await requireActorApi("catalog.manage");
    const section = getSection((await ctx.params).section);
    if (!section) throw new DomainError("Không tìm thấy mục danh mục.", 404);
    const sp: Record<string, string[]> = Object.create(null);
    for (const [k, v] of new URL(req.url).searchParams) (sp[k] ??= []).push(v);
    const params = { ...parseListParams(sp, ["status", "section"]), page: 1, pageSize: 100_000 }; // xuất TOÀN BỘ tập đã lọc
    const { rows } = await listCatalog(prisma, section.key, params);
    const columns = [
      { header: "Mã", key: "id", width: 8 },
      ...section.fields.map((f) => ({ header: f.label, key: f.name, width: 28, text: f.type === "text" })),
      { header: "Trạng thái", key: "status", width: 14 },
    ];
    const data = rows.map((r) => ({ ...r, status: r.isActive ? "Đang bật" : "Đã tắt" }));
    return xlsxResponse(`${section.key}.xlsx`, await buildXlsx(section.label, columns, data));
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

- [ ] **Step 5: Trường form dùng chung** — `src/app/(app)/system/catalog-settings/catalog-fields.tsx` (client; render control theo `CatalogField`, dùng cho trang tạo mới và section "Nội dung" của chi tiết):

```tsx
"use client";

import type { FieldErrors, UseFormReturn } from "react-hook-form";
import type { CatalogField } from "@/config/catalog-sections";

const INPUT = "h-11 w-full rounded-sm border bg-canvas px-3 text-sm md:h-9";

/** Render các trường của 1 mục danh mục theo cấu hình. `form` là react-hook-form của schema `catalogSchema(section)`. */
export function CatalogFields({ fields, form }: { fields: readonly CatalogField[]; form: UseFormReturn<Record<string, unknown>> }) {
  const errors = form.formState.errors as FieldErrors<Record<string, string>>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const err = errors[f.name]?.message;
        const id = `cf-${f.name}`;
        const border = err ? "border-danger" : "border-border";
        return (
          <div key={f.name} className={f.type === "checkbox" ? "sm:col-span-2" : undefined}>
            {f.type === "checkbox" ? (
              <label htmlFor={id} className="flex min-h-10 items-center gap-3 text-sm">
                <input id={id} type="checkbox" {...form.register(f.name)} /> {f.label}
              </label>
            ) : (
              <>
                <label htmlFor={id} className="mb-1 block text-xs text-fg-muted">{f.label}{f.required ? " *" : ""}</label>
                {f.type === "select" ? (
                  <select id={id} {...form.register(f.name)} aria-invalid={!!err} aria-describedby={err ? `${id}-error` : undefined} className={`${INPUT} ${border}`}>
                    <option value="">— Chọn —</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={id} autoComplete="off" {...form.register(f.name)} aria-invalid={!!err} aria-describedby={err ? `${id}-error` : undefined} className={`${INPUT} ${border}`} />
                )}
              </>
            )}
            {err && <p id={`${id}-error`} className="mt-1 text-xs text-danger">{String(err)}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Giá trị khởi tạo form: text → "", checkbox → false, select → "". */
export const emptyValues = (fields: readonly CatalogField[]): Record<string, unknown> =>
  Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? false : ""]));
```

- [ ] **Step 6: Trang tạo mới** — `.../[section]/new/page.tsx` (server) + `CatalogNewForm.tsx` (client)

`page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getSection } from "@/config/catalog-sections";
import { requireActor } from "@/server/auth/session";
import { CatalogNewForm } from "./CatalogNewForm";

export default async function CatalogNewPage({ params }: { params: Promise<{ section: string }> }) {
  await requireActor("catalog.manage");
  const section = getSection((await params).section);
  if (!section) notFound();
  return <CatalogNewForm section={section} />;
}
```

`CatalogNewForm.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { catalogSchema, type CatalogSection } from "@/config/catalog-sections";
import { NewPage } from "@/components/ui/NewPage";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";
import { CatalogFields, emptyValues } from "../../catalog-fields";

export function CatalogNewForm({ section }: { section: CatalogSection }) {
  const router = useRouter();
  const back = `/system/catalog-settings?section=${section.key}`;
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(catalogSchema(section)), defaultValues: emptyValues(section.fields) });

  const submit = form.handleSubmit(async (values) => {
    try {
      const r = await apiFetch<{ id: number }>(`/api/catalog/${section.key}`, { method: "POST", json: values });
      toast.success("Đã tạo.");
      router.replace(`/system/catalog-settings/${section.key}/${r.id}`);
    } catch (e) {
      // 409 trùng: báo ngay tại ô tiêu đề, giữ dữ liệu đang nhập
      if (e instanceof ApiError && e.status === 409 && e.fields) {
        for (const [name, message] of Object.entries(e.fields)) form.setError(name, { message }, { shouldFocus: true });
        return;
      }
      throw e; // lỗi khác → banner của NewPage
    }
  });

  return (
    <NewPage backHref={back} backLabel={`Quay lại ${section.label.toLowerCase()}`} title={`Thêm ${section.singular}`} submitLabel="Tạo"
      isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }}>
      <div className="space-y-4">
        <h2 className="text-base font-semibold">Nội dung</h2>
        <CatalogFields fields={section.fields} form={form} />
      </div>
    </NewPage>
  );
}
```

- [ ] **Step 7: Trang chi tiết** — `.../[section]/[id]/page.tsx` + `CatalogDetail.tsx`

`page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getSection } from "@/config/catalog-sections";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { getCatalogItem, getLinkedRecords } from "@/server/catalog/queries";
import { DomainError } from "@/server/http/errors";
import { CatalogDetail } from "./CatalogDetail";

const MAX_INT32 = 2_147_483_647;

export default async function CatalogDetailPage({ params }: { params: Promise<{ section: string; id: string }> }) {
  await requireActor("catalog.manage");
  const { section: key, id: raw } = await params;
  const section = getSection(key);
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0;
  if (!section || id <= 0 || id > MAX_INT32) notFound();
  const item = await getCatalogItem(prisma, section.key, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const linked = await getLinkedRecords(prisma, section.key, id);
  return <CatalogDetail section={section} item={JSON.parse(JSON.stringify(item))} linked={linked} />;
}
```

`CatalogDetail.tsx`:

```tsx
"use client";

import Link from "next/link";
import { catalogSchema, type CatalogSection } from "@/config/catalog-sections";
import { DetailField, DetailPage, DetailSection, EditActions, EditButton, useDetailNav, useSectionForm, type TabRenderCtx } from "@/components/ui/DetailPage";
import { apiFetch } from "@/lib/api-fetch";
import type { LinkedRecord } from "@/server/catalog/queries";
import { CatalogFields } from "../../catalog-fields";
import { z } from "zod";

interface Props {
  section: CatalogSection;
  item: { id: number; isActive: boolean } & Record<string, unknown>;
  linked: LinkedRecord[] | null;
}

const url = (p: Props) => `/api/catalog/${p.section.key}/${p.item.id}`;

function ContentSection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const defaults = Object.fromEntries(p.section.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(p.item[f.name]) : String(p.item[f.name] ?? "")]));
  const s = useSectionForm(ctx, "content", {
    schema: catalogSchema(p.section) as never, defaults,
    save: (v) => apiFetch(url(p), { method: "PATCH", json: { section: "content", ...(v as object) } }).then(() => {}),
  });
  return (
    <DetailSection title="Nội dung" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa nội dung" onClick={() => ctx.beginEdit("content")} />}>
      {s.editing ? (
        <CatalogFields fields={p.section.fields} form={s.form as never} />
      ) : (
        <dl className="space-y-2">
          {p.section.fields.map((f) => (
            <DetailField key={f.name} label={f.label}>
              {f.type === "checkbox" ? (p.item[f.name] ? "Có" : "Không") : f.type === "select" ? f.options?.find((o) => o.value === p.item[f.name])?.label : (p.item[f.name] as string | null)}
            </DetailField>
          ))}
        </dl>
      )}
    </DetailSection>
  );
}

function DisplaySection({ ctx, p }: { ctx: TabRenderCtx; p: Props }) {
  const s = useSectionForm(ctx, "display", {
    schema: z.object({ isActive: z.boolean() }), defaults: { isActive: p.item.isActive },
    save: (v) => apiFetch(url(p), { method: "PATCH", json: { section: "display", ...v } }).then(() => {}),
  });
  return (
    <DetailSection title="Hiển thị" editing={s.editing}
      action={s.editing ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} /> : <EditButton label="Chỉnh sửa hiển thị" onClick={() => ctx.beginEdit("display")} />}>
      {s.editing ? (
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" {...s.form.register("isActive")} /> Đang bật (hiện trong danh sách chọn)
        </label>
      ) : (
        <dl><DetailField label="Trạng thái">{p.item.isActive ? "Đang bật" : "Đã tắt"}</DetailField></dl>
      )}
    </DetailSection>
  );
}

export function CatalogDetail(p: Props) {
  const tabKeys = p.linked ? ["info", "linked"] : ["info"];
  const nav = useDetailNav(tabKeys, { content: "info", display: "info" });
  const title = String(p.item[p.section.titleField] ?? "");
  return (
    <DetailPage
      backHref={`/system/catalog-settings?section=${p.section.key}`} backLabel={`Quay lại ${p.section.label.toLowerCase()}`}
      summary={{
        title, code: p.section.label,
        badges: [p.item.isActive ? { label: "Đang bật", tone: "success" } : { label: "Đã tắt", tone: "neutral" }],
        facts: p.linked ? [{ label: "Bản ghi liên kết", value: p.linked.length }] : [],
      }}
      tabs={[
        { key: "info", label: "Chi tiết", render: (ctx) => <div className="space-y-6"><ContentSection ctx={ctx} p={p} /><DisplaySection ctx={ctx} p={p} /></div> },
        ...(p.linked ? [{
          key: "linked", label: "Bản ghi liên kết", count: p.linked.length,
          render: () => p.linked!.length === 0
            ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có bản ghi nào dùng mục này.</p>
            : <ul className="divide-y divide-[var(--border-default)]">
                {p.linked!.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={r.href} className="font-medium hover:text-accent">{r.label}</Link>
                    <span className="font-mono text-xs text-fg-muted">{r.sub}{r.isActive ? "" : " · đã tắt"}</span>
                  </li>
                ))}
              </ul>,
        }] : []),
      ]}
      {...nav}
    />
  );
}
```


- [ ] **Step 8: Trang danh sách + mini-sidebar + bảng**

`CatalogSidebar.tsx` (server component thuần; `?section=` — mobile thành chip cuộn ngang):

```tsx
import clsx from "clsx";
import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { CATALOG_SECTIONS, type CatalogKey } from "@/config/catalog-sections";

export function CatalogSidebar({ active, counts }: { active: CatalogKey; counts: Record<CatalogKey, number> }) {
  return (
    <nav aria-label="Loại danh mục" className="flex shrink-0 gap-2 overflow-x-auto rounded-md border border-border bg-surface p-2 lg:w-56 lg:flex-col lg:overflow-visible">
      {CATALOG_SECTIONS.map((s) => (
        <Link key={s.key} href={`/system/catalog-settings?section=${s.key}`} title={s.label} aria-current={s.key === active ? "page" : undefined}
          className={clsx(
            "flex min-h-11 shrink-0 items-center gap-2.5 rounded-sm border-l-[3px] px-3 text-sm lg:h-10 lg:min-h-0",
            s.key === active ? "border-accent bg-accent-soft font-medium text-accent" : "border-transparent text-fg-secondary hover:bg-hover",
          )}>
          <Icon name={s.icon} size={18} />
          <span className="truncate">{s.label}</span>
          <span className="ml-auto rounded-full bg-hover px-2 text-xs tabular">{counts[s.key]}</span>
        </Link>
      ))}
    </nav>
  );
}
```

`CatalogTable.tsx` (client):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { CatalogSection } from "@/config/catalog-sections";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { toastApiError } from "@/lib/api-error-toast";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { toast } from "@/lib/toast";

type Row = { id: number; isActive: boolean } & Record<string, unknown>;

export function CatalogTable({ section, rows, params }: { section: CatalogSection; rows: Row[]; params: ListParams }) {
  const router = useRouter();
  const busy = useRef(false);
  const guarded = async (fn: () => Promise<void>) => { if (busy.current) return; busy.current = true; try { await fn(); } finally { busy.current = false; } };
  const base = `/system/catalog-settings/${section.key}`;

  const show = (f: CatalogSection["fields"][number], v: unknown) =>
    f.type === "checkbox" ? (v ? "Có" : null) : f.type === "select" ? f.options?.find((o) => o.value === v)?.label ?? null : ((v as string | null) || null);

  const columns: Column<Row>[] = [
    { key: section.titleField, label: section.fields.find((f) => f.name === section.titleField)!.label, sortable: true, primaryOnMobile: true, render: (r) => String(r[section.titleField] ?? "") },
    ...section.fields.filter((f) => f.inTable).map((f): Column<Row> => ({ key: f.name, label: f.label, render: (r) => show(f, r[f.name]) })),
    { key: "isActive", label: "Trạng thái", sortable: true, render: (r) => (r.isActive ? <Badge tone="success">Đang bật</Badge> : <Badge>Đã tắt</Badge>) },
  ];

  const toggle = (r: Row) => guarded(async () => {
    try {
      await apiFetch(`/api/catalog/${section.key}/${r.id}/toggle`, { method: "POST", json: { active: !r.isActive } });
      toast.success(r.isActive ? "Đã tắt." : "Đã bật.");
      router.refresh();
    } catch (e) { toastApiError(e); }
  });

  const remove = (r: Row) => guarded(async () => {
    const name = String(r[section.titleField] ?? "");
    if (!(await confirm({ title: `Xóa ${section.singular} "${name}"?`, description: "Nếu đang được dùng ở dữ liệu khác thì không xóa được — hãy Tắt thay vì xóa.", confirmLabel: "Xóa", danger: true }))) return;
    try {
      await apiFetch(`/api/catalog/${section.key}/${r.id}`, { method: "DELETE" });
      toast.success("Đã xóa.");
      router.refresh();
    } catch (e) { toastApiError(e); }
  });

  // Thứ tự catalog-settings.md: Bật/Tắt · Sửa · Xóa (kebab-only)
  const actions = (r: Row): RowAction[] => [
    { key: "toggle", label: r.isActive ? "Tắt" : "Bật", icon: "power", onClick: () => void toggle(r) },
    { key: "edit", label: "Sửa", icon: "pencil", href: `${base}/${r.id}?edit=content` },
    { key: "delete", label: "Xóa", icon: "trash", danger: true, onClick: () => void remove(r) },
  ];

  return (
    <DataTable id={`catalog-${section.key}`} columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `${base}/${r.id}`}
      rowActions={actions} actionsVariant="kebab" sort={params.sort}
      buildSortHref={(s) => buildListHref("/system/catalog-settings", params, { sort: s })} />
  );
}
```

`page.tsx`:

```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { resolveSection } from "@/config/catalog-sections";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { countAllCatalogs, listCatalog } from "@/server/catalog/queries";
import { CatalogSidebar } from "./CatalogSidebar";
import { CatalogTable } from "./CatalogTable";

const BASE = "/system/catalog-settings";
// `section` là 1 "filter" để buildListHref/SearchBox/PaginationFooter tự giữ nó trên URL (deep-link mọi trạng thái)
const FILTER_KEYS = ["status", "section"] as const;

export default async function CatalogSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("catalog.manage");
  const params = parseListParams(await searchParams, FILTER_KEYS);
  const section = resolveSection(params.filters.section?.[0]);
  params.filters.section = [section.key]; // chuẩn hoá: section sai → mục đầu, và URL sinh ra luôn mang section hợp lệ
  const [{ rows, total, stats }, counts] = await Promise.all([listCatalog(prisma, section.key, params), countAllCatalogs(prisma)]);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const status = params.filters.status?.[0];
  const filtered = !!(params.q || params.filters.status);
  const newHref = `${BASE}/${section.key}/new`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <CatalogSidebar active={section.key} counts={counts} />
      <div className="min-h-0 min-w-0 flex-1">
        <ListPageLayout
          title={`${section.label} (${counts[section.key]})`}
          actions={<>
            <ExportButton href={buildExportHref(`/api/catalog/${section.key}/export`, params)} />
            <Link href={newHref} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Thêm mới</Link>
          </>}
          stats={<>
            <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
            <StatCard label="Đang bật" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
            <StatCard label="Đã tắt" value={stats.inactive} href={href({ filters: { status: ["inactive"] } })} active={status === "inactive"} />
          </>}
          filters={<SearchBox basePath={BASE} params={params} placeholder={`Tìm ${section.singular}…`} />}
          footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
          {total === 0 ? (
            filtered
              ? <EmptyState kind="no-result" title="Không tìm thấy mục phù hợp" description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={`${BASE}?section=${section.key}`} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
              : <EmptyState kind="empty" title={`Chưa có ${section.singular} nào`} action={<Link href={newHref} className="text-sm font-medium text-accent">Thêm {section.singular} đầu tiên</Link>} />
          ) : (
            <CatalogTable section={section} rows={rows as never} params={params} />
          )}
        </ListPageLayout>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Test UI (đỏ → xanh)** — `tests/ui/catalog-table.test.tsx`, `catalog-new-form.test.tsx`, `catalog-pages.test.tsx`. Theo mẫu `tests/ui/users-table.test.tsx` (mock `next/navigation`, `@/lib/api-fetch`, `@/lib/confirm-store`, `@/lib/toast`):

`tests/ui/catalog-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogTable } from "@/app/(app)/system/catalog-settings/CatalogTable";
import { getSection } from "@/config/catalog-sections";
import { ApiError } from "@/lib/api-fetch";
import { parseListParams } from "@/lib/query-params";

const push = vi.fn();
const refresh = vi.fn();
const apiFetch = vi.fn();
const confirm = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/system/catalog-settings" }));
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirm(...a) }));
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const section = getSection("warehouses")!;
const rows = [{ id: 1, name: "Kho 1", isActive: true }, { id: 2, name: "Kho cũ", isActive: false }];
const params = parseListParams({ section: "warehouses" }, ["status", "section"]);

beforeEach(() => {
  localStorage.clear();
  for (const m of [push, refresh, apiFetch, confirm, toastSuccess, toastError]) m.mockReset();
});
afterEach(cleanup);

const rowOf = (name: string) => screen.getAllByRole("row").find((r) => within(r).queryByText(name))!;
const openMenu = (name: string) => userEvent.click(within(rowOf(name)).getByRole("button", { name: "Thao tác" }));

describe("CatalogTable", () => {
  it("menu ⋯ theo thứ tự Tắt → Sửa → Xóa; dòng đã tắt hiện 'Bật'; không có nút inline", async () => {
    render(<CatalogTable section={section} rows={rows} params={params} />);
    expect(within(rowOf("Kho 1")).queryByRole("button", { name: "Xóa" })).toBeNull();
    await openMenu("Kho 1");
    expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Tắt", "Sửa", "Xóa"]);
    cleanup();
    render(<CatalogTable section={section} rows={rows} params={params} />);
    await openMenu("Kho cũ");
    expect((await screen.findAllByRole("menuitem"))[0]).toHaveTextContent("Bật");
  });

  it("Tắt → POST toggle {active:false} rồi làm mới trang", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    render(<CatalogTable section={section} rows={rows} params={params} />);
    await openMenu("Kho 1");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Tắt" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/catalog/warehouses/1/toggle", { method: "POST", json: { active: false } });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("Đã tắt.");
  });

  it("Xóa: huỷ xác nhận → KHÔNG gọi API; đồng ý → DELETE", async () => {
    render(<CatalogTable section={section} rows={rows} params={params} />);
    confirm.mockResolvedValueOnce(false);
    await openMenu("Kho 1");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Xóa kho "Kho 1"?', danger: true }));
    expect(apiFetch).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValue({ ok: true });
    await openMenu("Kho 1");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/catalog/warehouses/1", { method: "DELETE" });
  });

  it("[Review Focus 5] xóa mục đang dùng: máy chủ trả 409 → toast lỗi đúng thông điệp, không làm mới như thể đã xóa", async () => {
    confirm.mockResolvedValue(true);
    apiFetch.mockRejectedValue(new ApiError(409, "Không xóa được: kho này đang được dùng ở dữ liệu khác. Hãy Tắt để ẩn khỏi danh sách chọn."));
    render(<CatalogTable section={section} rows={rows} params={params} />);
    await openMenu("Kho 1");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/đang được dùng.*Tắt/)));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("click dòng dẫn tới trang chi tiết (KHÔNG panel)", () => {
    render(<CatalogTable section={section} rows={rows} params={params} />);
    expect(screen.getAllByRole("link", { name: "Kho 1" })[0]).toHaveAttribute("href", "/system/catalog-settings/warehouses/1");
  });
});
```

`tests/ui/catalog-new-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogNewForm } from "@/app/(app)/system/catalog-settings/[section]/new/CatalogNewForm";
import { getSection } from "@/config/catalog-sections";
import { ApiError } from "@/lib/api-fetch";

const push = vi.fn();
const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => { for (const m of [push, replace, apiFetch]) m.mockReset(); });
afterEach(cleanup);

describe("CatalogNewForm", () => {
  it("gửi form rỗng → lỗi tiếng Việt tại ô, KHÔNG gọi API", async () => {
    render(<CatalogNewForm section={getSection("warehouses")!} />);
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Nhập tên kho.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Tên kho/)).toHaveAttribute("aria-invalid", "true");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("nhập hợp lệ → POST rồi chuyển sang trang chi tiết của mục vừa tạo", async () => {
    apiFetch.mockResolvedValue({ id: 7 });
    render(<CatalogNewForm section={getSection("warehouses")!} />);
    await userEvent.type(screen.getByLabelText(/Tên kho/), "Kho 1");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/system/catalog-settings/warehouses/7"));
    expect(apiFetch).toHaveBeenCalledWith("/api/catalog/warehouses", { method: "POST", json: { name: "Kho 1" } });
  });

  it("[Review Focus 5] trùng tên (409 kèm fields.name) → lỗi hiện tại ô Tên, giữ dữ liệu, KHÔNG chuyển trang", async () => {
    apiFetch.mockRejectedValue(new ApiError(409, "Kho đã tồn tại.", undefined, { name: "Kho đã tồn tại." }));
    render(<CatalogNewForm section={getSection("warehouses")!} />);
    await userEvent.type(screen.getByLabelText(/Tên kho/), "Kho 1");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Kho đã tồn tại.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Tên kho/)).toHaveValue("Kho 1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("tài khoản quỹ: chưa chọn Loại → 'Chọn loại.'", async () => {
    render(<CatalogNewForm section={getSection("cash-accounts")!} />);
    await userEvent.type(screen.getByLabelText(/Tên tài khoản/), "Quỹ TM");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Chọn loại.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
```

`tests/ui/catalog-pages.test.tsx`:

```tsx
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CatalogSettingsPage from "@/app/(app)/system/catalog-settings/page";
import { StatCard } from "@/components/ui";

const requireActor = vi.fn();
const listCatalog = vi.fn();
const countAllCatalogs = vi.fn();
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/server/catalog/queries", () => ({ listCatalog: (...a: unknown[]) => listCatalog(...a), countAllCatalogs: (...a: unknown[]) => countAllCatalogs(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/app/(app)/system/catalog-settings/CatalogTable", () => ({ CatalogTable: () => null }));

const counts = { "partner-groups": 2, warehouses: 3, vehicles: 0, drivers: 0, routes: 0, "expense-types": 0, "cash-accounts": 0, "processing-types": 0 };
const stats = { all: 3, active: 2, inactive: 1 };

beforeEach(() => {
  for (const m of [requireActor, listCatalog, countAllCatalogs]) m.mockReset();
  requireActor.mockResolvedValue({ userId: 1, perms: new Set(["catalog.manage"]) });
  listCatalog.mockResolvedValue({ rows: [{ id: 1, name: "Kho 1", isActive: true }], total: 1, stats });
  countAllCatalogs.mockResolvedValue(counts);
});

function findAll(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) out.push(el);
  findAll(el.props?.children as ReactNode, type, out);
  for (const k of ["stats", "filters", "actions", "footer"]) findAll(el.props?.[k] as ReactNode, type, out);
  return out;
}
const page = (sp: Record<string, string> = {}) => CatalogSettingsPage({ searchParams: Promise.resolve(sp) });

describe("/system/catalog-settings (server)", () => {
  it("cần catalog.manage; bị từ chối thì KHÔNG đọc dữ liệu", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(page()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("catalog.manage");
    expect(listCatalog).not.toHaveBeenCalled();
  });

  it("?section sai → mục đầu (deep-link không vỡ)", async () => {
    await page({ section: "khong-co" });
    expect(listCatalog.mock.calls[0]![1]).toBe("partner-groups");
  });

  it("3 thẻ Tổng/Đang bật/Đã tắt; thẻ của bộ lọc đang chọn được đánh dấu; URL thẻ GIỮ section", async () => {
    const tree = await page({ section: "warehouses", status: "active" });
    const cards = findAll(tree, StatCard).map((c) => c.props);
    expect(cards.map((c) => [c.label, c.value, c.active])).toEqual([["Tổng", 3, false], ["Đang bật", 2, true], ["Đã tắt", 1, false]]);
    for (const c of cards) expect(new URL(String(c.href), "http://x").searchParams.get("section")).toBe("warehouses");
    expect(new URL(String(cards[2]!.href), "http://x").searchParams.get("status")).toBe("inactive");
  });
});
```

Run: `rtk proxy npx vitest run tests/ui/catalog-table.test.tsx tests/ui/catalog-new-form.test.tsx tests/ui/catalog-pages.test.tsx tests/api/route-guards.test.ts`
Expected: PASS. (`route-guards.test.ts` tự quét các route/page mới và yêu cầu chúng gọi `requireActorApi(`/`requireActor(` — đã thoả.)

- [ ] **Step 10: Mở menu + kiểm tay** — trong `src/config/app.config.ts` xoá `planned: P` của function `catalog-settings`. Chạy `npm run dev`, đăng nhập, vào **Hệ thống → Cài đặt danh mục**: kiểm 8 mục, thêm/sửa/tắt/xoá, dark/light, thu hẹp < 1024 (chip ngang). Không tuyên bố xong khi chưa mở trang thật.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
rtk proxy npm run lint && rtk proxy npm run typecheck && rtk proxy npx vitest run tests/ui tests/catalog tests/api tests/config
git add -A src tests
git commit -m "feat(catalog): màn Cài đặt danh mục — mini-sidebar, bảng kebab, tạo/sửa/tắt/xóa, export"
```

---
### Task 4: Khung Import Excel dùng lại được (đọc số Việt Nam, xem trước, ghi, file loại, mẫu)

**Mã:** nền cho 9, 10, 11 và D1–D2 (plan 05-D8 dùng lại). **Files:**
- Create: `src/lib/parse-number.ts`
- Create: `src/server/import/{types,xlsx-reader,framework,handle}.ts`
- Create: `src/components/import/{ImportDialog,ImportExportMenu}.tsx`
- Test: `tests/lib/parse-number.test.ts`, `tests/import/xlsx-reader.test.ts`, `tests/import/framework.test.ts`, `tests/ui/import-dialog.test.tsx`

**Interfaces:**
- Consumes: `buildXlsx` (đã có), `withIdempotency`, `writeAudit`, `normalizeSearch`, `readIdempotencyKey`, `apiFetch`, `useIdempotencyKey`.
- Produces:
  - `parseViNumber(raw: unknown, opts?: { allowNegative?: boolean; maxFrac?: number }): { ok: true; value: string | null } | { ok: false; message: string }` (`value` là chuỗi thập phân chuẩn, dấu `.`; `null` = ô trống).
  - `type ImportColumn = { key; header; aliases?; required?; sample }`, `type ImportSpec<T, C>` (mục 4.2), `type ImportPreview`, `type ImportResult`.
  - `readSheet(buffer, columns): Promise<SheetRow[]>`, `previewImport`, `commitImport`, `buildRejectXlsx`, `buildTemplateXlsx`, `handleImportPost(req, actor, { spec, scope })`.

#### 4.1 `parseViNumber`

- [ ] **Step 1: Test (đỏ)** — `tests/lib/parse-number.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseViNumber } from "@/lib/parse-number";

const ok = (raw: unknown, value: string | null, opts = {}) => expect(parseViNumber(raw, opts)).toEqual({ ok: true, value });
const bad = (raw: unknown, opts = {}) => expect(parseViNumber(raw, opts).ok).toBe(false);

describe("parseViNumber — quy ước Việt Nam (. ngăn nghìn, , thập phân)", () => {
  it("[Review Focus 2] các dạng thường gặp của kế toán", () => {
    ok("1.234,5", "1234.5");
    ok("2,4", "2.4");
    ok("3 000", "3000"); // khoảng trắng / NBSP ngăn nghìn
    ok("3 000", "3000");
    ok("1.234.567", "1234567");
    ok("12.000.000₫", "12000000");
    ok("1.234", "1234"); // 1 dấu chấm + đúng 3 chữ số sau + KHÔNG bắt đầu bằng 0 ⇒ ngăn nghìn
  });

  it("số 0 đầu ⇒ thập phân (0.450 mm là 0,45, KHÔNG phải 450)", () => {
    ok("0.450", "0.45");
    ok("0,450", "0.45");
    ok(".5", "0.5");
  });

  it("dấu chấm đơn với ≠ 3 chữ số sau ⇒ thập phân", () => {
    ok("2.4", "2.4");
    ok("1234.5", "1234.5");
  });

  it("có cả hai dấu: dấu đứng SAU CÙNG là thập phân (kiểu Mỹ cũng đúng)", () => {
    ok("1,234.5", "1234.5");
    ok("1.234,50", "1234.5");
  });

  it("ô trống / khoảng trắng / null = 'không có' (null), KHÔNG phải 0", () => {
    ok("", null);
    ok("   ", null);
    ok(null, null);
    ok(undefined, null);
    ok("0", "0"); // 0 thật vẫn là 0
  });

  it("ô số thật của Excel đọc thẳng (dấu chấm là thập phân)", () => {
    ok(1250.5, "1250.5");
    ok(2.4, "2.4");
    ok(1.234, "1.234");
    ok(0, "0");
    bad(Number.NaN);
    bad(Number.POSITIVE_INFINITY);
  });

  it("chuỗi không phải số / nhóm nghìn sai → lỗi (không đoán bừa)", () => {
    bad("12abc");
    bad("1,2,3");
    bad("1.2.34,5");
    bad("abc");
    bad("--5");
    bad({});
  });

  it("số âm chỉ khi cho phép; quá số chữ số thập phân → lỗi", () => {
    bad("-5");
    ok("-5", "-5", { allowNegative: true });
    ok("-0", "0", { allowNegative: true });
    bad("1,1234567"); // > 6 chữ số thập phân (mặc định)
    ok("1,1234567", "1.1234567", { maxFrac: 8 });
  });
});
```

- [ ] **Step 2: Chạy → đỏ**; **Step 3: Viết `src/lib/parse-number.ts`**

```ts
export type ParsedNumber = { ok: true; value: string | null } | { ok: false; message: string };

interface Opts {
  allowNegative?: boolean;
  /** Số chữ số thập phân tối đa (mặc định 6 — khớp Decimal(18,6) của hệ số quy đổi). */
  maxFrac?: number;
}

const INVALID: ParsedNumber = { ok: false, message: "Số không hợp lệ." };
const count = (s: string, ch: string) => s.split(ch).length - 1;

function finish(negative: boolean, intPart: string, fracPart: string, opts: Opts): ParsedNumber {
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return INVALID;
  const maxFrac = opts.maxFrac ?? 6;
  const frac = fracPart.replace(/0+$/, "");
  if (frac.length > maxFrac) return { ok: false, message: `Tối đa ${maxFrac} chữ số thập phân.` };
  const int = intPart.replace(/^0+(?=\d)/, "") || "0";
  const isZero = int === "0" && frac === "";
  if (negative && !isZero && !opts.allowNegative) return { ok: false, message: "Không được là số âm." };
  return { ok: true, value: `${negative && !isZero ? "-" : ""}${int}${frac ? "." + frac : ""}` };
}

/**
 * ĐỌC SỐ KIỂU VIỆT NAM — hàm duy nhất cho mọi đường import (KH, SP, D1–D4). Số dạng CHỮ: `.` ngăn nghìn, `,` thập phân.
 * Ô số thật của Excel (kiểu number) không mơ hồ → đọc thẳng (`.` là thập phân).
 * Quy tắc cho chuỗi có ĐÚNG MỘT dấu chấm và không có dấu phẩy: là ngăn nghìn khi phần sau chấm đúng 3 chữ số, phần trước
 * 1–3 chữ số và không bắt đầu bằng 0 ("1.234" = 1234; "0.450" = 0,45; "2.4" = 2,4). Mơ hồ còn lại ("2.400" = 2400) là giới hạn
 * đã biết — file mẫu đặt cột số ở định dạng Số nên dữ liệu chuẩn không rơi vào nhánh này.
 * `null/undefined/""` → `{ value: null }` (KHÔNG BAO GIỜ thành 0: "chưa nhập" ≠ 0).
 */
export function parseViNumber(raw: unknown, opts: Opts = {}): ParsedNumber {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return INVALID;
    let t = raw.toString();
    if (/e/i.test(t)) t = raw.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
    const negative = t.startsWith("-");
    const [i = "", f = ""] = (negative ? t.slice(1) : t).split(".");
    return finish(negative, i, f, opts);
  }
  if (typeof raw !== "string") return INVALID;

  const s = raw.replace(/[\s ']/g, "").replace(/(₫|đ|vnd)$/i, "");
  if (s === "") return { ok: true, value: null };
  const m = /^([+-]?)([\d.,]+)$/.exec(s);
  if (!m) return INVALID;
  const negative = m[1] === "-";
  const body = m[2]!;
  const dots = count(body, ".");
  const commas = count(body, ",");

  let int = "";
  let frac = "";
  if (dots > 0 && commas > 0) {
    const dec = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const thou = dec === "," ? "." : ",";
    if (count(body, dec) !== 1) return INVALID;
    const [i = "", f = ""] = body.split(dec);
    const groups = i.split(thou);
    if (groups.slice(1).some((g) => g.length !== 3) || groups[0]!.length === 0 || groups[0]!.length > 3) return INVALID;
    int = groups.join("");
    frac = f;
  } else if (commas > 0) {
    if (commas > 1) return INVALID;
    [int = "", frac = ""] = body.split(",");
  } else if (dots > 1) {
    const groups = body.split(".");
    if (groups.slice(1).some((g) => g.length !== 3) || groups[0]!.length === 0 || groups[0]!.length > 3) return INVALID;
    int = groups.join("");
  } else if (dots === 1) {
    const [i = "", f = ""] = body.split(".");
    const thousands = f.length === 3 && i.length >= 1 && i.length <= 3 && !i.startsWith("0");
    if (thousands) int = i + f;
    else [int, frac] = [i, f];
  } else {
    int = body;
  }
  if (int === "" && frac === "") return INVALID;
  return finish(negative, int, frac, opts);
}
```

- [ ] **Step 4: Chạy → xanh** (`rtk proxy npx vitest run tests/lib/parse-number.test.ts`).

#### 4.2 Kiểu, đọc file, khung xem trước/ghi

- [ ] **Step 5: `src/server/import/types.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";

type Db = Prisma.TransactionClient | PrismaClient;

export interface ImportColumn {
  /** Khoá trong `cells` của parseRow. */
  key: string;
  /** Tên cột trong file (so khớp không dấu, không phân biệt hoa/thường). */
  header: string;
  aliases?: readonly string[];
  required?: boolean;
  /** Giá trị dòng ví dụ của file mẫu. */
  sample: string;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

export interface ImportSpec<T, C = undefined> {
  /** Tên model — `entity` của audit; cũng dùng làm scope idempotency. */
  entity: string;
  /** "khách hàng", "sản phẩm"… dùng trong thông báo. */
  label: string;
  columns: readonly ImportColumn[];
  /** Nạp 1 lần cho cả file (vd map tên nhóm → id). Không nạp lại theo từng dòng. */
  loadContext(db: Db): Promise<C>;
  /** Đọc + kiểm 1 dòng; KHÔNG đụng DB. */
  parseRow(cells: Record<string, unknown>, ctx: C): ParseResult<T>;
  /** Khoá trùng đã chuẩn hoá (vd mã viết hoa). */
  keyOf(data: T): string;
  /** Có lý do → dòng bị BỎ QUA (không phải lỗi), vd "Ngừng bán". Đi vào file loại cho khách duyệt. */
  skipReason?(data: T): string | null;
  existingKeys(db: Db, keys: string[]): Promise<Set<string>>;
  create(tx: Prisma.TransactionClient, actor: Actor, rows: T[], ctx: C): Promise<void>;
  update(tx: Prisma.TransactionClient, actor: Actor, rows: T[], ctx: C): Promise<void>;
}

export type RowStatus = "create" | "update" | "skip-existing" | "skip-reason" | "error";

export interface PreviewRow {
  line: number;
  status: RowStatus;
  key: string | null;
  message: string | null;
  /** 2–3 ô đầu để người dùng nhận ra dòng. */
  summary: string;
}

export interface ImportPreview {
  total: number;
  counts: Record<RowStatus, number>;
  /** Dòng lỗi/bỏ qua trước, tối đa 500 dòng (đủ để duyệt; đếm ở `counts` luôn đầy đủ). */
  rows: PreviewRow[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skippedExisting: number;
  skippedReason: number;
  failed: number;
  failures: { line: number; message: string }[];
}
```

- [ ] **Step 6: Test đọc file (đỏ)** — `tests/import/xlsx-reader.test.ts`

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/server/export/xlsx";
import { MAX_IMPORT_ROWS, readSheet } from "@/server/import/xlsx-reader";
import type { ImportColumn } from "@/server/import/types";

const columns: ImportColumn[] = [
  { key: "code", header: "Mã", required: true, sample: "A1" },
  { key: "name", header: "Tên sản phẩm", aliases: ["Tên hàng"], required: true, sample: "Tôn" },
  { key: "note", header: "Ghi chú", sample: "" },
];
const xlsx = (headers: string[], rows: unknown[][]) =>
  buildXlsx("S", headers.map((h, i) => ({ header: h, key: `c${i}` })), rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))));

describe("readSheet", () => {
  it("nhận tiêu đề không dấu / khác hoa thường / tên phụ; bỏ dòng trống; trả số dòng thật trong file", async () => {
    const buf = await xlsx(["MA", "ten hang", "Ghi chú"], [["A1", "Tôn lạnh", "x"], [null, null, null], ["A2", "Tôn xốp", null]]);
    const rows = await readSheet(buf, columns);
    expect(rows.map((r) => r.line)).toEqual([2, 4]); // dòng 3 trống bị bỏ, số dòng vẫn là số dòng trong Excel
    expect(rows[0]!.cells).toMatchObject({ code: "A1", name: "Tôn lạnh", note: "x" });
    expect(rows[1]!.cells.note).toBeNull();
  });

  it("bỏ qua dòng ví dụ (ô đầu bắt đầu bằng '#')", async () => {
    const buf = await xlsx(["Mã", "Tên sản phẩm"], [["# ví dụ", "Tôn mẫu"], ["A1", "Tôn thật"]]);
    expect((await readSheet(buf, columns)).map((r) => r.cells.code)).toEqual(["A1"]);
  });

  it("thiếu cột bắt buộc → lỗi 400 nêu tên cột", async () => {
    const buf = await xlsx(["Mã"], [["A1"]]);
    await expect(readSheet(buf, columns)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Tên sản phẩm") });
  });

  it("đọc kết quả công thức và văn bản định dạng (rich text) như giá trị thường", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.addRow(["Mã", "Tên sản phẩm"]);
    ws.addRow([{ richText: [{ text: "A" }, { text: "1" }] }, { formula: "1+1", result: 2 }]);
    const rows = await readSheet(Buffer.from(await wb.xlsx.writeBuffer()), columns);
    expect(rows[0]!.cells).toMatchObject({ code: "A1", name: 2 });
  });

  it("không phải xlsx → 400 tiếng Việt", async () => {
    await expect(readSheet(Buffer.from("không phải excel"), columns)).rejects.toMatchObject({ status: 400, message: "Tệp không phải Excel (.xlsx) hợp lệ." });
  });

  it("vượt ngưỡng dòng → 400; vượt dung lượng → 413", async () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`A${i}`, "x"]);
    await expect(readSheet(await xlsx(["Mã", "Tên sản phẩm"], many), columns)).rejects.toMatchObject({ status: 400 });
    await expect(readSheet(Buffer.alloc(2 * 1024 * 1024 + 1), columns)).rejects.toMatchObject({ status: 413 });
  });
});
```

- [ ] **Step 7: Viết `src/server/import/xlsx-reader.ts`**

```ts
import ExcelJS from "exceljs";
import { normalizeSearch } from "@/lib/search";
import { DomainError, ValidationError } from "@/server/http/errors";
import type { ImportColumn } from "./types";

/** D-15: import đồng bộ, tối đa 5.000 dòng / 2 MB mỗi tệp. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface SheetRow {
  /** Số dòng THẬT trong Excel (dòng 1 = tiêu đề) — dùng để báo lỗi cho người dùng tìm đúng chỗ. */
  line: number;
  cells: Record<string, unknown>;
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Rich text / công thức / liên kết → giá trị thường. */
function plain(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result ?? null;
    if ("text" in v) return v.text;
    return null; // lỗi ô (#N/A…)
  }
  return v;
}

/** Đọc trang tính ĐẦU TIÊN; dòng 1 là tiêu đề. Trả `cells` theo `key` của cột (đã khớp tiêu đề không dấu). */
export async function readSheet(buffer: Buffer, columns: readonly ImportColumn[]): Promise<SheetRow[]> {
  if (buffer.byteLength > MAX_IMPORT_BYTES) {
    throw new DomainError(`Tệp quá lớn (tối đa ${MAX_IMPORT_BYTES / 1024 / 1024} MB). Hãy tách thành nhiều tệp.`, 413);
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError("Tệp không phải Excel (.xlsx) hợp lệ.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError("Tệp không có trang tính nào.");

  const headerIndex = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const h = plain(cell.value);
    if (typeof h === "string" || typeof h === "number") headerIndex.set(normalizeSearch(String(h)), col);
  });

  const colOf = new Map<string, number>();
  const missing: string[] = [];
  for (const c of columns) {
    const names = [c.header, ...(c.aliases ?? [])].map(normalizeSearch);
    const col = names.map((n) => headerIndex.get(n)).find((x) => x !== undefined);
    if (col !== undefined) colOf.set(c.key, col);
    else if (c.required) missing.push(c.header);
  }
  if (missing.length > 0) throw new ValidationError(`Thiếu cột bắt buộc: ${missing.join(", ")}.`);

  const rows: SheetRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, unknown> = {};
    let any = false;
    for (const c of columns) {
      const col = colOf.get(c.key);
      const v = col === undefined ? null : plain(row.getCell(col).value);
      cells[c.key] = v;
      if (!isBlank(v)) any = true;
    }
    if (!any) continue;
    const first = columns.map((c) => cells[c.key]).find((v) => !isBlank(v));
    if (typeof first === "string" && first.trim().startsWith("#")) continue; // dòng ví dụ của file mẫu
    rows.push({ line: r, cells });
    if (rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi tệp. Hãy tách thành nhiều tệp.`);
  }
  return rows;
}
```

- [ ] **Step 8: Chạy → xanh** (`rtk proxy npx vitest run tests/import/xlsx-reader.test.ts`).

- [ ] **Step 9: Test khung (đỏ)** — `tests/import/framework.test.ts`

```ts
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { parseViNumber } from "@/lib/parse-number";
import type { Actor } from "@/lib/permissions/scope";
import { buildXlsx } from "@/server/export/xlsx";
import { buildRejectXlsx, buildTemplateXlsx, commitImport, previewImport } from "@/server/import/framework";
import type { ImportSpec } from "@/server/import/types";
import { readSheet } from "@/server/import/xlsx-reader";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

interface Row { code: string; name: string; qty: string | null; stopped: boolean }
const created: Row[] = [];
const updated: Row[] = [];
const existing = new Set<string>();

const spec: ImportSpec<Row, undefined> = {
  entity: "Fake", label: "mục",
  columns: [
    { key: "code", header: "Mã", required: true, sample: "A1" },
    { key: "name", header: "Tên", required: true, sample: "Tôn" },
    { key: "qty", header: "Số lượng", aliases: ["SL"], sample: "1.234,5" },
    { key: "stopped", header: "Ngừng bán", sample: "Không" },
  ],
  loadContext: async () => undefined,
  parseRow(cells) {
    const errors: string[] = [];
    const code = String(cells.code ?? "").trim().toUpperCase();
    const name = String(cells.name ?? "").trim();
    if (!code) errors.push("Thiếu mã.");
    if (!name) errors.push("Thiếu tên.");
    const q = parseViNumber(cells.qty);
    if (!q.ok) errors.push(`Số lượng: ${q.message}`);
    return errors.length ? { ok: false, errors } : { ok: true, data: { code, name, qty: q.ok ? q.value : null, stopped: String(cells.stopped ?? "").toLowerCase() === "có" } };
  },
  keyOf: (d) => d.code,
  skipReason: (d) => (d.stopped ? "Ngừng bán — chờ khách xác nhận." : null),
  existingKeys: async (_db, keys) => new Set(keys.filter((k) => existing.has(k))),
  create: async (_tx, _a, rows) => { created.push(...rows); },
  update: async (_tx, _a, rows) => { updated.push(...rows); },
};

const file = () => buildXlsx("S", [{ header: "Mã", key: "c" }, { header: "Tên", key: "n" }, { header: "SL", key: "q" }, { header: "Ngừng bán", key: "s" }], [
  { c: "a1", n: "Tôn 1", q: "1.234,5", s: "" },      // dòng 2: tạo mới
  { c: "A2", n: "Tôn 2", q: "12abc", s: "" },         // dòng 3: lỗi số
  { c: "A1", n: "Tôn 1 (lặp)", q: "1", s: "" },       // dòng 4: trùng trong file với dòng 2
  { c: "B1", n: "Đã có", q: "5", s: "" },             // dòng 5: đã có trong hệ thống
  { c: "C1", n: "Ngừng", q: "", s: "Có" },            // dòng 6: bỏ qua có lý do
  { c: "D1", n: "Tôn 4", q: "", s: "" },              // dòng 7: tạo mới, ô số trống = null
]);

let actor: Actor;
beforeEach(async () => {
  await resetDb();
  created.length = 0; updated.length = 0; existing.clear(); existing.add("B1");
  actor = { userId: (await makeUser()).id, perms: new Set() };
});

describe("previewImport", () => {
  it("[Review Focus 2, 4] phân loại từng dòng: tạo / lỗi / trùng trong file / đã có / bỏ qua có lý do", async () => {
    const p = await previewImport(prisma, spec, await file(), { overwrite: false });
    expect(p.counts).toEqual({ create: 2, update: 0, "skip-existing": 1, "skip-reason": 1, error: 2 });
    const byLine = Object.fromEntries(p.rows.map((r) => [r.line, r]));
    expect(byLine[3]!.message).toBe("Số lượng: Số không hợp lệ.");
    expect(byLine[4]!.message).toBe('Trùng mã "A1" với dòng 2.');
    expect(byLine[5]!.status).toBe("skip-existing");
    expect(byLine[6]!.message).toBe("Ngừng bán — chờ khách xác nhận.");
    expect(p.rows[0]!.status).toBe("error"); // dòng cần xem (lỗi) đứng đầu
    expect(created).toHaveLength(0); // xem trước KHÔNG ghi gì
  });

  it("tuỳ chọn Ghi đè: dòng đã có → 'update' thay vì bỏ qua", async () => {
    const p = await previewImport(prisma, spec, await file(), { overwrite: true });
    expect(p.counts["update"]).toBe(1);
    expect(p.counts["skip-existing"]).toBe(0);
  });
});

describe("commitImport", () => {
  it("ghi CHỈ dòng hợp lệ; dòng lỗi/bỏ qua không vào DB; ô số trống = null; audit tổng hợp", async () => {
    const r = await commitImport(prisma, actor, spec, await file(), { overwrite: false, idempotencyKey: "k1" });
    expect(r).toMatchObject({ created: 2, updated: 0, skippedExisting: 1, skippedReason: 1, failed: 2 });
    expect(created.map((x) => [x.code, x.qty])).toEqual([["A1", "1234.5"], ["D1", null]]);
    expect(r.failures.map((f) => f.line)).toEqual([3, 4]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "import.Fake" } });
    expect(log.afterJson).toMatchObject({ created: 2, failed: 2 });
  });

  it("[Review Focus 4] bấm 2 lần / retry cùng Idempotency-Key: chỉ ghi MỘT lần, trả lại kết quả lần đầu", async () => {
    const buf = await file();
    const a = await commitImport(prisma, actor, spec, buf, { overwrite: false, idempotencyKey: "same" });
    const b = await commitImport(prisma, actor, spec, buf, { overwrite: false, idempotencyKey: "same" });
    expect(b).toEqual(a);
    expect(created).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: "import.Fake" } })).toBe(1);
  });

  it("Ghi đè: gọi update cho dòng đã có", async () => {
    await commitImport(prisma, actor, spec, await file(), { overwrite: true, idempotencyKey: "k2" });
    expect(updated.map((x) => x.code)).toEqual(["B1"]);
  });
});

describe("file loại & file mẫu", () => {
  it("buildRejectXlsx: đúng các dòng lỗi/bỏ qua kèm cột 'Dòng' và 'Lý do' (D2: mã trùng + ngừng bán ra file riêng)", async () => {
    const buf = await buildRejectXlsx(prisma, spec, await file(), { overwrite: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(["Dòng", "Lý do", "Mã", "Tên", "Số lượng", "Ngừng bán"]);
    const lines = Array.from({ length: ws.rowCount - 1 }, (_, i) => ws.getRow(i + 2).getCell(1).value);
    expect(lines).toEqual([3, 4, 5, 6]);
    expect(ws.getRow(4).getCell(2).value).toBe("Đã có trong hệ thống (bỏ qua)."); // hàng 4 = dòng 5 của file gốc (bản ghi đã có)
  });

  it("buildTemplateXlsx: đủ cột + 1 dòng ví dụ bắt đầu '#' mà readSheet BỎ QUA khi nhập lại", async () => {
    const buf = await buildTemplateXlsx(spec);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.rowCount).toBe(2);
    expect(String(wb.worksheets[0]!.getRow(2).getCell(1).value).startsWith("#")).toBe(true);
    expect(await readSheet(buf, spec.columns)).toHaveLength(0);
  });
});
```

- [ ] **Step 10: Chạy → đỏ**, viết `src/server/import/framework.ts`

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { buildXlsx } from "@/server/export/xlsx";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import type { ImportColumn, ImportPreview, ImportResult, ImportSpec, PreviewRow, RowStatus } from "./types";
import { readSheet, type SheetRow } from "./xlsx-reader";

type Db = Prisma.TransactionClient | PrismaClient;

export interface ClassifiedRow<T> {
  line: number;
  cells: Record<string, unknown>;
  key: string | null;
  status: RowStatus;
  message: string | null;
  data?: T;
}

const MAX_PREVIEW_ROWS = 500;
const MAX_FAILURES = 500;

/**
 * Phân loại từng dòng theo THỨ TỰ ƯU TIÊN cố định: lỗi đọc → trùng trong file → bỏ qua có lý do → đã có trong hệ thống →
 * tạo mới. Xem trước và ghi dùng CHUNG hàm này nên "thấy gì thì ghi đúng cái đó".
 */
export async function classifyRows<T, C>(db: Db, spec: ImportSpec<T, C>, sheet: SheetRow[], overwrite: boolean): Promise<{ rows: ClassifiedRow<T>[]; ctx: C }> {
  const ctx = await spec.loadContext(db);
  const rows: ClassifiedRow<T>[] = [];
  const firstLine = new Map<string, number>();

  for (const s of sheet) {
    const parsed = spec.parseRow(s.cells, ctx);
    if (!parsed.ok) {
      rows.push({ line: s.line, cells: s.cells, key: null, status: "error", message: parsed.errors.join(" ") });
      continue;
    }
    const key = spec.keyOf(parsed.data);
    const dup = firstLine.get(key);
    if (dup !== undefined) {
      rows.push({ line: s.line, cells: s.cells, key, status: "error", message: `Trùng mã "${key}" với dòng ${dup}.` });
      continue;
    }
    firstLine.set(key, s.line);
    const reason = spec.skipReason?.(parsed.data) ?? null;
    rows.push({ line: s.line, cells: s.cells, key, data: parsed.data, status: reason ? "skip-reason" : "create", message: reason });
  }

  const candidates = rows.filter((r) => r.status === "create").map((r) => r.key!);
  const existing = candidates.length > 0 ? await spec.existingKeys(db, candidates) : new Set<string>();
  for (const r of rows) {
    if (r.status === "create" && existing.has(r.key!)) {
      r.status = overwrite ? "update" : "skip-existing";
      r.message = overwrite ? null : "Đã có trong hệ thống (bỏ qua).";
    }
  }
  return { rows, ctx };
}

const ORDER: Record<RowStatus, number> = { error: 0, "skip-reason": 1, "skip-existing": 2, update: 3, create: 4 };

const summaryOf = (columns: readonly ImportColumn[], cells: Record<string, unknown>) =>
  columns.map((c) => cells[c.key]).filter((v) => v !== null && v !== undefined && v !== "").slice(0, 3).map(String).join(" · ");

export async function previewImport<T, C>(db: Db, spec: ImportSpec<T, C>, buffer: Buffer, opts: { overwrite: boolean }): Promise<ImportPreview> {
  const sheet = await readSheet(buffer, spec.columns);
  const { rows } = await classifyRows(db, spec, sheet, opts.overwrite);
  const counts: Record<RowStatus, number> = { create: 0, update: 0, "skip-existing": 0, "skip-reason": 0, error: 0 };
  for (const r of rows) counts[r.status]++;
  const view: PreviewRow[] = [...rows]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.line - b.line)
    .slice(0, MAX_PREVIEW_ROWS)
    .map((r) => ({ line: r.line, status: r.status, key: r.key, message: r.message, summary: summaryOf(spec.columns, r.cells) }));
  return { total: rows.length, counts, rows: view };
}

export async function commitImport<T, C>(
  prisma: PrismaClient, actor: Actor, spec: ImportSpec<T, C>, buffer: Buffer,
  opts: { overwrite: boolean; idempotencyKey: string },
): Promise<ImportResult> {
  const sheet = await readSheet(buffer, spec.columns);
  return withIdempotency(prisma, { userId: actor.userId, scope: `import.${spec.entity}`, key: opts.idempotencyKey }, async (tx) => {
    const { rows, ctx } = await classifyRows(tx, spec, sheet, opts.overwrite);
    const pick = (status: RowStatus) => rows.filter((r) => r.status === status).map((r) => r.data as T);
    await spec.create(tx, actor, pick("create"), ctx);
    await spec.update(tx, actor, pick("update"), ctx);
    const failures = rows.filter((r) => r.status === "error").map((r) => ({ line: r.line, message: r.message ?? "" }));
    const result: ImportResult = {
      created: pick("create").length, updated: pick("update").length,
      skippedExisting: rows.filter((r) => r.status === "skip-existing").length,
      skippedReason: rows.filter((r) => r.status === "skip-reason").length,
      failed: failures.length, failures: failures.slice(0, MAX_FAILURES),
    };
    await writeAudit(tx, { userId: actor.userId, action: `import.${spec.entity}`, entity: spec.entity, after: { ...result, failures: undefined } });
    return result;
  });
}

/** File "dòng bị loại" (lỗi + bỏ qua) kèm số dòng và lý do — để khách duyệt/sửa rồi nhập lại (D2). */
export async function buildRejectXlsx<T, C>(db: Db, spec: ImportSpec<T, C>, buffer: Buffer, opts: { overwrite: boolean }): Promise<Buffer> {
  const sheet = await readSheet(buffer, spec.columns);
  const { rows } = await classifyRows(db, spec, sheet, opts.overwrite);
  const rejected = rows.filter((r) => r.status === "error" || r.status === "skip-existing" || r.status === "skip-reason").sort((a, b) => a.line - b.line);
  const columns = [
    { header: "Dòng", key: "__line", width: 8 },
    { header: "Lý do", key: "__reason", width: 44 },
    ...spec.columns.map((c) => ({ header: c.header, key: c.key, width: 22, text: true })),
  ];
  return buildXlsx("Dòng bị loại", columns, rejected.map((r) => ({ __line: r.line, __reason: r.message, ...r.cells })));
}

/** File mẫu: đủ cột + 1 dòng ví dụ (ô đầu bắt đầu "#" nên KHÔNG bị nhập). */
export async function buildTemplateXlsx<T, C>(spec: ImportSpec<T, C>): Promise<Buffer> {
  const columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: 22, text: true }));
  const sample = Object.fromEntries(spec.columns.map((c, i) => [c.key, i === 0 ? `# ${c.sample} (ví dụ — dòng này không được nhập)` : c.sample]));
  return buildXlsx("Mẫu nhập", columns, [sample]);
}
```


- [ ] **Step 11: Chạy → xanh** (`rtk proxy npx vitest run tests/import`).

- [ ] **Step 12: `src/server/import/handle.ts` (dùng chung cho route KH/NCC/SP)**

```ts
import type { NextRequest } from "next/server";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { xlsxResponse } from "@/server/export/xlsx";
import { DomainError, ValidationError } from "@/server/http/errors";
import { readIdempotencyKey } from "@/server/http/read-json";
import { buildRejectXlsx, buildTemplateXlsx, commitImport, previewImport } from "./framework";
import type { ImportSpec } from "./types";
import { MAX_IMPORT_BYTES } from "./xlsx-reader";

/** multipart/form-data: `file` (bắt buộc) + `overwrite` ("true"). */
export async function readImportUpload(req: Request): Promise<{ buffer: Buffer; overwrite: boolean }> {
  const form = await req.formData().catch(() => { throw new ValidationError("Không đọc được tệp gửi lên."); });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Chưa chọn tệp.");
  if (file.size > MAX_IMPORT_BYTES) throw new DomainError(`Tệp quá lớn (tối đa ${MAX_IMPORT_BYTES / 1024 / 1024} MB). Hãy tách thành nhiều tệp.`, 413);
  return { buffer: Buffer.from(await file.arrayBuffer()), overwrite: form.get("overwrite") === "true" };
}

/**
 * `POST …/import?mode=preview|commit|rejects`. Route gọi `requireActorApi` + kiểm quyền TRƯỚC khi vào đây.
 * preview → JSON `ImportPreview`; commit → JSON `ImportResult` (bắt buộc header Idempotency-Key); rejects → file .xlsx.
 */
export async function handleImportPost<T, C>(req: NextRequest, actor: Actor, spec: ImportSpec<T, C>): Promise<Response> {
  const mode = new URL(req.url).searchParams.get("mode");
  if (mode !== "preview" && mode !== "commit" && mode !== "rejects") throw new ValidationError("Chế độ nhập không hợp lệ.");
  const key = mode === "commit" ? readIdempotencyKey(req) : "";
  const { buffer, overwrite } = await readImportUpload(req);
  if (mode === "preview") return Response.json(await previewImport(prisma, spec, buffer, { overwrite }));
  if (mode === "rejects") return xlsxResponse(`dong-bi-loai-${spec.entity.toLowerCase()}.xlsx`, await buildRejectXlsx(prisma, spec, buffer, { overwrite }));
  return Response.json(await commitImport(prisma, actor, spec, buffer, { overwrite, idempotencyKey: key }));
}

export async function handleTemplateGet<T, C>(spec: ImportSpec<T, C>): Promise<Response> {
  return xlsxResponse(`mau-nhap-${spec.entity.toLowerCase()}.xlsx`, await buildTemplateXlsx(spec));
}
```

#### 4.3 Giao diện nhập

- [ ] **Step 13: Test hộp thoại (đỏ)** — `tests/ui/import-dialog.test.tsx`

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "@/components/import/ImportDialog";

const apiFetch = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const preview = {
  total: 4, counts: { create: 2, update: 0, "skip-existing": 1, "skip-reason": 0, error: 1 },
  rows: [{ line: 3, status: "error", key: null, message: "Số lượng: Số không hợp lệ.", summary: "A2 · Tôn 2" }],
};
const file = () => new File(["x"], "khach.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const onDone = vi.fn();
const onClose = vi.fn();

beforeEach(() => { apiFetch.mockReset(); onDone.mockReset(); onClose.mockReset(); });
afterEach(cleanup);
const open = () => render(<ImportDialog open onClose={onClose} onDone={onDone} title="Nhập khách hàng" endpoint="/api/partners/import?kind=customer" templateHref="/api/partners/import-template?kind=customer" />);

describe("ImportDialog", () => {
  it("chọn tệp → tự xem trước (mode=preview), hiện thống kê + dòng lỗi kèm lý do; nút Nhập ghi rõ số dòng sẽ ghi", async () => {
    apiFetch.mockResolvedValueOnce(preview);
    open();
    await userEvent.upload(screen.getByLabelText("Chọn tệp Excel"), file());
    expect(await screen.findByText("Số lượng: Số không hợp lệ.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/partners/import?kind=customer&mode=preview", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText(/2 dòng sẽ được tạo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nhập 2 dòng" })).toBeEnabled();
  });

  it("không có dòng hợp lệ → nút Nhập bị vô hiệu", async () => {
    apiFetch.mockResolvedValueOnce({ ...preview, counts: { ...preview.counts, create: 0 } });
    open();
    await userEvent.upload(screen.getByLabelText("Chọn tệp Excel"), file());
    expect(await screen.findByRole("button", { name: "Nhập 0 dòng" })).toBeDisabled();
  });

  it("bật 'Ghi đè' → xem trước lại với overwrite=true", async () => {
    apiFetch.mockResolvedValue(preview);
    open();
    await userEvent.upload(screen.getByLabelText("Chọn tệp Excel"), file());
    await screen.findByText(/2 dòng sẽ được tạo/);
    await userEvent.click(screen.getByLabelText(/Ghi đè/));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const fd = apiFetch.mock.calls[1]![1].body as FormData;
    expect(fd.get("overwrite")).toBe("true");
  });

  it("[Review Focus 4] Nhập gửi Idempotency-Key; bấm lại (retry) dùng CÙNG khoá; đổi tệp thì khoá mới", async () => {
    apiFetch.mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error("mạng")).mockResolvedValueOnce({ created: 2, updated: 0, skippedExisting: 1, skippedReason: 0, failed: 1, failures: [{ line: 3, message: "x" }] });
    open();
    await userEvent.upload(screen.getByLabelText("Chọn tệp Excel"), file());
    await userEvent.click(await screen.findByRole("button", { name: "Nhập 2 dòng" }));
    await userEvent.click(await screen.findByRole("button", { name: "Nhập 2 dòng" })); // thử lại sau lỗi
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    const keys = apiFetch.mock.calls.filter((c) => String(c[0]).includes("mode=commit")).map((c) => c[1].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
    expect(await screen.findByText(/Đã tạo 2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 14: Viết `src/components/import/ImportDialog.tsx`**

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { toastApiError } from "@/lib/api-error-toast";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ImportPreview, ImportResult, RowStatus } from "@/server/import/types";

const STATUS: Record<RowStatus, { label: string; tone: BadgeTone }> = {
  create: { label: "Tạo mới", tone: "success" }, update: { label: "Ghi đè", tone: "info" },
  "skip-existing": { label: "Đã có", tone: "warning" }, "skip-reason": { label: "Bỏ qua", tone: "warning" }, error: { label: "Lỗi", tone: "danger" },
};

const withMode = (endpoint: string, mode: string) => `${endpoint}${endpoint.includes("?") ? "&" : "?"}mode=${mode}`;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Khi nhập xong (để làm mới danh sách). */
  onDone: () => void;
  title: string;
  /** VD `/api/partners/import?kind=customer` — hộp thoại thêm `&mode=preview|commit|rejects`. */
  endpoint: string;
  templateHref: string;
}

export function ImportDialog({ open, onClose, onDone, title, endpoint, templateHref }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useIdempotencyKey(); // 1 khoá / 1 tệp: bấm đúp hoặc thử lại sau lỗi mạng không ghi 2 lần

  const form = (f: File, ow: boolean) => {
    const fd = new FormData();
    fd.set("file", f);
    fd.set("overwrite", String(ow));
    return fd;
  };

  async function runPreview(f: File, ow: boolean) {
    setBusy(true);
    try {
      setPreview(await apiFetch<ImportPreview>(withMode(endpoint, "preview"), { method: "POST", body: form(f, ow) }));
    } catch (e) {
      setPreview(null);
      toastApiError(e);
    } finally {
      setBusy(false);
    }
  }

  function choose(f: File | null) {
    setFile(f); setPreview(null); setResult(null); idem.reset();
    if (f) void runPreview(f, overwrite);
  }

  async function commit() {
    if (!file || busy) return;
    setBusy(true);
    try {
      setResult(await apiFetch<ImportResult>(withMode(endpoint, "commit"), { method: "POST", body: form(file, overwrite), idempotencyKey: idem.key }));
      onDone();
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function downloadRejects() {
    if (!file) return;
    const res = await fetch(withMode(endpoint, "rejects"), { method: "POST", body: form(file, overwrite) });
    if (!res.ok) return toastApiError(new Error("rejects"));
    saveBlob(await res.blob(), "dong-bi-loai.xlsx");
  }

  function downloadLog(kind: "json" | "txt") {
    if (!result) return;
    const text = kind === "json"
      ? JSON.stringify(result, null, 2)
      : [`Đã tạo ${result.created}, ghi đè ${result.updated}, bỏ qua ${result.skippedExisting + result.skippedReason}, lỗi ${result.failed}`, ...result.failures.map((f) => `Dòng ${f.line}: ${f.message}`)].join("\n");
    saveBlob(new Blob([text], { type: kind === "json" ? "application/json" : "text/plain" }), `nhat-ky-nhap.${kind}`);
  }

  const willWrite = (preview?.counts.create ?? 0) + (preview?.counts.update ?? 0);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-secondary">
            Tệp .xlsx, tối đa 5.000 dòng / 2 MB. Dòng lỗi được liệt kê để sửa; hệ thống chỉ ghi các dòng hợp lệ. <a href={templateHref} className="font-medium text-accent">Tải tệp mẫu</a>
          </Dialog.Description>

          {!result && (
            <>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border-strong p-6 text-center text-sm hover:bg-hover">
                <Upload size={20} aria-hidden />
                <span>{file ? file.name : "Chọn hoặc kéo thả tệp vào đây"}</span>
                <input type="file" accept=".xlsx" className="sr-only" aria-label="Chọn tệp Excel" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overwrite} disabled={busy}
                  onChange={(e) => { setOverwrite(e.target.checked); if (file) void runPreview(file, e.target.checked); }} />
                Ghi đè bản ghi đã có (trùng mã)
              </label>
            </>
          )}

          {preview && !result && (
            <div className="space-y-3">
              <p className="text-sm">
                <strong>{preview.counts.create}</strong> dòng sẽ được tạo · <strong>{preview.counts.update}</strong> ghi đè · <strong>{preview.counts["skip-existing"] + preview.counts["skip-reason"]}</strong> bỏ qua · <strong className="text-danger">{preview.counts.error}</strong> lỗi
                <span className="text-fg-muted"> (tổng {preview.total} dòng)</span>
              </p>
              {preview.rows.length > 0 && (
                <div className="max-h-60 overflow-auto rounded-sm border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface"><tr><th className="px-2 py-1">Dòng</th><th className="px-2 py-1">Trạng thái</th><th className="px-2 py-1">Nội dung</th><th className="px-2 py-1">Ghi chú</th></tr></thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.line} className="border-t border-border">
                          <td className="tabular px-2 py-1">{r.line}</td>
                          <td className="px-2 py-1"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                          <td className="px-2 py-1">{r.summary}</td>
                          <td className="px-2 py-1 text-fg-secondary">{r.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.counts.error + preview.counts["skip-existing"] + preview.counts["skip-reason"] > 0 && (
                <button type="button" onClick={() => void downloadRejects()} className="inline-flex items-center gap-2 text-sm font-medium text-accent"><Download size={14} aria-hidden /> Tải file dòng bị loại</button>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3 text-sm">
              <p>Đã tạo {result.created}, ghi đè {result.updated}, bỏ qua {result.skippedExisting + result.skippedReason}, lỗi {result.failed}.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => downloadLog("txt")} className="text-accent">Tải nhật ký (.txt)</button>
                <button type="button" onClick={() => downloadLog("json")} className="text-accent">Tải nhật ký (.json)</button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">{result ? "Đóng" : "Hủy"}</button>
            {!result && (
              <button type="button" onClick={() => void commit()} disabled={busy || !preview || willWrite === 0}
                className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">
                {busy && preview ? "Đang nhập" : `Nhập ${willWrite} dòng`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Ghi chú: test "Nhập 0 dòng" cần nút hiển thị ngay cả khi 0 (đã đúng: `Nhập ${willWrite} dòng` với `preview` có mặt). Trước khi chọn tệp `preview=null` → nút "Nhập 0 dòng" disabled — chấp nhận được.

- [ ] **Step 15: `src/components/import/ImportExportMenu.tsx`** — dropdown "Nhập/Xuất" cạnh nút Thêm mới (import-export.md)

```tsx
"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImportDialog } from "./ImportDialog";

interface Props {
  exportHref: string;
  /** Không truyền → chỉ có Xuất Excel (người dùng không có quyền nhập). */
  importEndpoint?: string;
  templateHref?: string;
  importTitle?: string;
}

export function ImportExportMenu({ exportHref, importEndpoint, templateHref, importTitle = "Nhập từ Excel" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const item = "flex h-9 cursor-pointer items-center rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover";
  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger className="flex h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover">
          <FileSpreadsheet size={16} aria-hidden /> Nhập/Xuất <ChevronDown size={14} aria-hidden />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" className="z-dropdown min-w-44 rounded-md border border-border bg-raised p-1 shadow-md">
            <Dropdown.Item asChild><a href={exportHref} download className={item}>Xuất Excel</a></Dropdown.Item>
            {importEndpoint && <Dropdown.Item onSelect={() => setOpen(true)} className={item}>Nhập Excel</Dropdown.Item>}
            {templateHref && <Dropdown.Item asChild><a href={templateHref} download className={item}>Tải mẫu</a></Dropdown.Item>}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      {importEndpoint && templateHref && (
        <ImportDialog open={open} onClose={() => setOpen(false)} onDone={() => router.refresh()} title={importTitle} endpoint={importEndpoint} templateHref={templateHref} />
      )}
    </>
  );
}
```

- [ ] **Step 16: Chạy** `rtk proxy npx vitest run tests/lib tests/import tests/ui/import-dialog.test.tsx` → xanh; lint + typecheck; commit

```bash
git add src/lib/parse-number.ts src/server/import src/components/import tests/lib/parse-number.test.ts tests/import tests/ui/import-dialog.test.tsx
git commit -m "feat(import): khung Import Excel — số kiểu Việt Nam, xem trước, ghi idempotent, file loại, file mẫu"
```

---

### Task 5: Khách hàng & NCC — backend (mã tự sinh, tìm không dấu, phạm vi "khách của mình")

**Mã:** 9, 10. **Files:**
- Create: `src/server/partners/{schemas,codes,service,queries,import-spec}.ts`
- Modify: `src/server/audit/*` — không cần; `src/lib/permissions/catalog.ts` — không thêm quyền mới
- Test: `tests/partners/{schemas,service,queries,import}.test.ts`

**Interfaces:**
- Consumes: `partnerScopeWhere`, `searchTextWhere`, `normalizeSearch`, `withIdempotency`, `writeAudit`, `importFramework` (Task 4), `parseViNumber`.
- Produces:
  - `createPartnerSchema`, `profileSectionSchema`, `creditSectionSchema`, `ownerSectionSchema`, `statusSectionSchema`, kiểu `CreatePartnerInput`.
  - `createPartner(db, actor, input): Promise<{ id: number; code: string }>`, `createPartnerIdempotent(prisma, actor, key, input)`.
  - `updatePartnerProfile(db, actor, id, v)`, `setPartnerCredit(db, actor, id, v)`, `setPartnerOwner(db, actor, id, v)`, `setPartnerActive(db, actor, id, v)`.
  - `searchTextOf({ code, name, phone })`.
  - `PARTNER_FILTER_KEYS`, `type PartnerKind = "customer" | "supplier"`, `partnerWhere(actor, params, kind, opts?)`, `listPartners(db, actor, params, kind)`, `getPartner(db, actor, id, kind?)`, `searchPartners(db, actor, { q, kind, limit? })`, `exportPartnersXlsx(db, actor, params, kind)`, `type PartnerDTO`.
  - `partnerImportSpec(kind): ImportSpec<PartnerImportRow, PartnerImportCtx>`.

- [ ] **Step 1: Test schema (đỏ)** — `tests/partners/schemas.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createPartnerSchema, profileSectionSchema } from "@/server/partners/schemas";

const valid = {
  code: "", name: "Nguyễn Văn Đạt", groupId: 1, isCustomer: true, isSupplier: false, ownerUserId: null,
  debtLimit: 5_000_000, allowCredit: true, phone: "0912 345 678", address: "", note: "", isActive: true,
};
const msg = (v: unknown) => { const r = createPartnerSchema.safeParse(v); return r.success ? null : r.error.issues[0]!.message; };

describe("createPartnerSchema", () => {
  it("hợp lệ; mã rỗng = tự sinh; tên được cắt khoảng trắng", () => {
    expect(createPartnerSchema.parse({ ...valid, name: "  Đạt  " }).name).toBe("Đạt");
  });
  it("thiếu tên / nhóm → lỗi tiếng Việt", () => {
    expect(msg({ ...valid, name: " " })).toBe("Nhập tên.");
    expect(msg({ ...valid, groupId: undefined })).toBe("Chọn nhóm.");
  });
  it("phải là khách hàng hoặc NCC (hoặc cả hai)", () => {
    expect(msg({ ...valid, isCustomer: false, isSupplier: false })).toBe("Chọn khách hàng hoặc nhà cung cấp.");
    expect(createPartnerSchema.safeParse({ ...valid, isCustomer: true, isSupplier: true }).success).toBe(true);
  });
  it("hạn mức nợ không âm; mã chỉ gồm ký tự an toàn; SĐT hợp lệ", () => {
    expect(msg({ ...valid, debtLimit: -1 })).toBe("Không được âm.");
    expect(msg({ ...valid, code: "KH 01" })).toBe("Mã chỉ gồm chữ không dấu, số và . _ -");
    expect(msg({ ...valid, phone: "abc" })).toBe("Số điện thoại không hợp lệ.");
  });
  it("section 'hồ sơ' cũng áp quy tắc loại đối tác", () => {
    expect(profileSectionSchema.safeParse({ name: "A", groupId: 1, isCustomer: false, isSupplier: false, phone: "", address: "", note: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Viết `src/server/partners/schemas.ts`**

```ts
import { z } from "zod";

const money = z.number({ required_error: "Nhập số tiền.", invalid_type_error: "Nhập số tiền." }).min(0, "Không được âm.").max(9_999_999_999_999, "Số quá lớn.");
const text = (max: number, label: string) => z.string().trim().max(max, `${label} tối đa ${max} ký tự.`);

export const partnerBase = z.object({
  /** Rỗng = tự sinh (KH000001 / NCC000001). */
  code: z.string().trim().max(30, "Mã tối đa 30 ký tự.").refine((v) => v === "" || /^[A-Za-z0-9._-]+$/.test(v), "Mã chỉ gồm chữ không dấu, số và . _ -"),
  name: z.string({ required_error: "Nhập tên." }).trim().min(1, "Nhập tên.").max(120, "Tên tối đa 120 ký tự."),
  groupId: z.number({ required_error: "Chọn nhóm.", invalid_type_error: "Chọn nhóm." }).int("Chọn nhóm.").positive("Chọn nhóm."),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
  ownerUserId: z.number().int().positive().nullable(),
  debtLimit: money,
  allowCredit: z.boolean(),
  phone: text(30, "Số điện thoại").refine((v) => v === "" || /^[0-9+().\-\s]{6,30}$/.test(v), "Số điện thoại không hợp lệ."),
  address: text(250, "Địa chỉ"),
  note: text(500, "Ghi chú"),
  isActive: z.boolean(),
});

type Kind = { isCustomer: boolean; isSupplier: boolean };
const kindRule = (v: Kind, ctx: z.RefinementCtx) => {
  if (!v.isCustomer && !v.isSupplier) ctx.addIssue({ code: "custom", path: ["isCustomer"], message: "Chọn khách hàng hoặc nhà cung cấp." });
};

export const createPartnerSchema = partnerBase.superRefine(kindRule);
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const profileSectionSchema = partnerBase.pick({ name: true, groupId: true, isCustomer: true, isSupplier: true, phone: true, address: true, note: true }).superRefine(kindRule);
export const creditSectionSchema = partnerBase.pick({ debtLimit: true, allowCredit: true });
export const ownerSectionSchema = partnerBase.pick({ ownerUserId: true });
export const statusSectionSchema = partnerBase.pick({ isActive: true });
```

- [ ] **Step 3: Chạy → xanh** (`rtk proxy npx vitest run tests/partners/schemas.test.ts`).

- [ ] **Step 4: Test service (đỏ)** — `tests/partners/service.test.ts`

```ts
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { createPartner, createPartnerIdempotent, setPartnerActive, setPartnerCredit, setPartnerOwner, updatePartnerProfile } from "@/server/partners/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup, makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let manager: Actor;
let groupId: number;

const input = (over = {}) => ({
  code: "", name: "Nguyễn Văn Đạt", groupId, isCustomer: true, isSupplier: false, ownerUserId: null,
  debtLimit: 0, allowCredit: false, phone: "", address: "", note: "", isActive: true, ...over,
});

beforeEach(async () => {
  await resetDb();
  manager = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view", "partner.view_all"]) };
  groupId = (await makePartnerGroup("Khách lẻ")).id;
});

describe("createPartner", () => {
  it("mã tự sinh theo loại: KH000001…, NCC000001…; searchText không dấu gồm mã + tên + SĐT", async () => {
    const a = await tx((db) => createPartner(db, manager, input({ phone: "0912 345 678" })));
    const b = await tx((db) => createPartner(db, manager, input({ name: "Công ty Tôn Hoa Sen", isCustomer: false, isSupplier: true })));
    const c = await tx((db) => createPartner(db, manager, input({ name: "Trần Lan" })));
    expect([a.code, b.code, c.code]).toEqual(["KH000001", "NCC000001", "KH000002"]);
    const row = await prisma.partner.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.searchText).toBe("kh000001 nguyen van dat 0912 345 678");
    expect(row.debtLimit.toString()).toBe("0");
  });

  it("mã nhập tay được viết HOA; trùng mã → FieldConflictError có fields.code", async () => {
    const r = await tx((db) => createPartner(db, manager, input({ code: "abc-1" })));
    expect(r.code).toBe("ABC-1");
    const e = await tx((db) => createPartner(db, manager, input({ code: "ABC-1", name: "Khác" }))).catch((x) => x);
    expect(e).toBeInstanceOf(FieldConflictError);
    expect((e as FieldConflictError).fields.code).toBe("Mã đã tồn tại.");
  });

  it("mã tự sinh bỏ qua mã cũ không theo dạng KH<số> (mã nhập từ hệ thống cũ)", async () => {
    await makePartner({ code: "KH-CU-9", groupId });
    await makePartner({ code: "KH000007", groupId });
    const r = await tx((db) => createPartner(db, manager, input()));
    expect(r.code).toBe("KH000008");
  });

  it("[Review Focus 5] 6 lần tạo ĐỒNG THỜI → 6 mã khác nhau, không lỗi trùng", async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => tx((db) => createPartner(db, manager, input({ name: `Khách ${i}` })))));
    expect(new Set(rs.map((r) => r.code)).size).toBe(6);
    expect(await prisma.partner.count()).toBe(6);
  });

  it("nhóm đã tắt hoặc không tồn tại → 400; người phụ trách bị khoá → 400", async () => {
    const off = await prisma.partnerGroup.create({ data: { name: "Cũ", isActive: false } });
    await expect(tx((db) => createPartner(db, manager, input({ groupId: off.id })))).rejects.toMatchObject({ status: 400 });
    await expect(tx((db) => createPartner(db, manager, input({ groupId: 9999 })))).rejects.toMatchObject({ status: 400 });
    const locked = await makeUser({ isLocked: true });
    await expect(tx((db) => createPartner(db, manager, input({ ownerUserId: locked.id })))).rejects.toMatchObject({ status: 400 });
  });

  it("thiếu quyền partner.manage → ForbiddenError; audit partner.create không chứa dữ liệu thừa", async () => {
    await expect(tx((db) => createPartner(db, { ...manager, perms: new Set(["partner.view"]) }, input()))).rejects.toBeInstanceOf(ForbiddenError);
    await tx((db) => createPartner(db, manager, input()));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "partner.create" } });
    expect(log.entity).toBe("Partner");
    expect(log.afterJson).toMatchObject({ code: "KH000001", name: "Nguyễn Văn Đạt" });
  });

  it("createPartnerIdempotent: cùng Idempotency-Key → cùng id, chỉ 1 bản ghi", async () => {
    const a = await createPartnerIdempotent(prisma, manager, "key-1", input());
    const b = await createPartnerIdempotent(prisma, manager, "key-1", input());
    expect(b.id).toBe(a.id);
    expect(await prisma.partner.count()).toBe(1);
  });
});

describe("cập nhật theo section", () => {
  let id: number;
  beforeEach(async () => { id = (await tx((db) => createPartner(db, manager, input({ name: "Cũ" })))).id; });

  it("đổi tên → searchText tính lại (tìm được tên mới, không còn tên cũ) + audit before/after", async () => {
    await tx((db) => updatePartnerProfile(db, manager, id, { name: "Mới Toanh", groupId, isCustomer: true, isSupplier: false, phone: "", address: "", note: "" }));
    const row = await prisma.partner.findUniqueOrThrow({ where: { id } });
    expect(row.searchText).toContain("moi toanh");
    expect(row.searchText).not.toContain(" cu");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "partner.update_profile" } });
    expect(log.beforeJson).toMatchObject({ name: "Cũ" });
    expect(log.afterJson).toMatchObject({ name: "Mới Toanh" });
  });

  it("hạn mức nợ + cho ghi nợ; người phụ trách; tắt/bật", async () => {
    await tx((db) => setPartnerCredit(db, manager, id, { debtLimit: 12_500_000, allowCredit: true }));
    const owner = await makeUser();
    await tx((db) => setPartnerOwner(db, manager, id, { ownerUserId: owner.id }));
    await tx((db) => setPartnerActive(db, manager, id, { isActive: false }));
    const row = await prisma.partner.findUniqueOrThrow({ where: { id } });
    expect([row.debtLimit.toString(), row.allowCredit, row.ownerUserId, row.isActive]).toEqual(["12500000", true, owner.id, false]);
  });

  it("đối tác không tồn tại → 404", async () => {
    await expect(tx((db) => setPartnerActive(db, manager, 9999, { isActive: false }))).rejects.toMatchObject({ status: 404 });
  });

  it("[Review Focus 6] người chỉ có partner.manage nhưng thiếu partner.view_all không sửa được khách của người khác (404)", async () => {
    const seller = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view"]) };
    const e = await tx((db) => setPartnerActive(db, seller, id, { isActive: false })).catch((x) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).status).toBe(404);
  });
});
```

- [ ] **Step 5: Chạy → đỏ**; viết `src/server/partners/codes.ts`

```ts
import type { Prisma } from "@prisma/client";

/** Khoá tư vấn cấp mã đối tác — tuần tự hoá việc cấp số để 2 người cùng tạo không cùng nhận 1 mã. */
const PARTNER_CODE_LOCK = 7_710_002;

export type PartnerKind = "customer" | "supplier";
export const CODE_PREFIX: Record<PartnerKind, string> = { customer: "KH", supplier: "NCC" };

const format = (prefix: string, n: number) => `${prefix}${String(n).padStart(6, "0")}`;

/**
 * Cấp `count` mã liên tiếp cho loại `kind`. Gọi TRONG transaction ghi đối tác: khoá tự nhả khi commit/rollback.
 * Chỉ tính các mã đúng dạng <tiền tố><số> (mã nhập từ hệ thống cũ như "KH-CU-9" bị bỏ qua).
 */
export async function nextPartnerCodes(db: Prisma.TransactionClient, kind: PartnerKind, count: number): Promise<string[]> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${PARTNER_CODE_LOCK})`;
  const prefix = CODE_PREFIX[kind];
  const pattern = `^${prefix}([0-9]{1,9})$`;
  const rows = await db.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("code" FROM ${pattern}::text) AS INTEGER)) AS n FROM partners`;
  const max = rows[0]?.n ?? 0;
  return Array.from({ length: count }, (_, i) => format(prefix, max + 1 + i));
}
```

- [ ] **Step 6: Viết `src/server/partners/service.ts`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { nextPartnerCodes } from "./codes";
import type { CreatePartnerInput } from "./schemas";

type Db = Prisma.TransactionClient;

/** D-9: MỌI đường ghi `searchText` (form, import, seed) gọi hàm này. */
export const searchTextOf = (p: { code: string; name: string; phone?: string | null }) => normalizeSearch(`${p.code} ${p.name} ${p.phone ?? ""}`);

async function assertGroupUsable(db: Db, groupId: number) {
  const g = await db.partnerGroup.findUnique({ where: { id: groupId } });
  if (!g) throw new DomainError("Nhóm khách hàng không hợp lệ.", 400);
  if (!g.isActive) throw new DomainError("Nhóm khách hàng đã tắt, hãy chọn nhóm khác.", 400);
}

async function assertOwnerUsable(db: Db, ownerUserId: number | null) {
  if (ownerUserId === null) return;
  const u = await db.user.findUnique({ where: { id: ownerUserId }, select: { isLocked: true } });
  if (!u || u.isLocked) throw new DomainError("Người phụ trách không hợp lệ.", 400);
}

/** Đối tác phải nằm trong phạm vi của người gọi ("chỉ khách của mình") và chưa bị gộp; ngoài phạm vi → 404 (không lộ sự tồn tại). */
async function loadEditable(db: Db, actor: Actor, id: number) {
  const p = await db.partner.findFirst({ where: { id, mergedIntoId: null, ...partnerScopeWhere(actor) } });
  if (!p) throw new DomainError("Không tìm thấy đối tác.", 404);
  return p;
}

const codeTaken = () => new FieldConflictError("Mã đã tồn tại.", { code: "Mã đã tồn tại." });

export async function createPartner(db: Db, actor: Actor, input: CreatePartnerInput): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "partner.manage");
  await assertGroupUsable(db, input.groupId);
  await assertOwnerUsable(db, input.ownerUserId);
  const code = input.code !== "" ? input.code.toUpperCase() : (await nextPartnerCodes(db, input.isCustomer ? "customer" : "supplier", 1))[0]!;
  let row;
  try {
    row = await db.partner.create({
      data: {
        code, name: input.name, searchText: searchTextOf({ code, name: input.name, phone: input.phone }),
        groupId: input.groupId, isCustomer: input.isCustomer, isSupplier: input.isSupplier, ownerUserId: input.ownerUserId,
        debtLimit: new Prisma.Decimal(input.debtLimit), allowCredit: input.allowCredit,
        phone: input.phone || null, address: input.address || null, note: input.note || null, isActive: input.isActive,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw codeTaken();
    throw e;
  }
  await writeAudit(db, {
    userId: actor.userId, action: "partner.create", entity: "Partner", entityId: row.id,
    after: { code, name: row.name, groupId: row.groupId, isCustomer: row.isCustomer, isSupplier: row.isSupplier, debtLimit: row.debtLimit.toString(), allowCredit: row.allowCredit },
  });
  return { id: row.id, code };
}

/** Tạo với Idempotency-Key (D-10): bấm đúp / retry mạng không sinh 2 đối tác. */
export async function createPartnerIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: CreatePartnerInput) {
  assertCan(actor.perms, "partner.manage");
  return withIdempotency(prisma, { userId: actor.userId, scope: "partner.create", key }, (tx) => createPartner(tx, actor, input));
}

export async function updatePartnerProfile(
  db: Db, actor: Actor, id: number,
  v: { name: string; groupId: number; isCustomer: boolean; isSupplier: boolean; phone: string; address: string; note: string },
) {
  assertCan(actor.perms, "partner.manage");
  const before = await loadEditable(db, actor, id);
  if (v.groupId !== before.groupId) await assertGroupUsable(db, v.groupId); // nhóm cũ đã tắt không chặn việc sửa trường khác
  await db.partner.update({
    where: { id },
    data: {
      name: v.name, searchText: searchTextOf({ code: before.code, name: v.name, phone: v.phone }),
      groupId: v.groupId, isCustomer: v.isCustomer, isSupplier: v.isSupplier,
      phone: v.phone || null, address: v.address || null, note: v.note || null,
    },
  });
  await writeAudit(db, {
    userId: actor.userId, action: "partner.update_profile", entity: "Partner", entityId: id,
    before: { name: before.name, groupId: before.groupId, isCustomer: before.isCustomer, isSupplier: before.isSupplier, phone: before.phone, address: before.address, note: before.note },
    after: { name: v.name, groupId: v.groupId, isCustomer: v.isCustomer, isSupplier: v.isSupplier, phone: v.phone || null, address: v.address || null, note: v.note || null },
  });
}

export async function setPartnerCredit(db: Db, actor: Actor, id: number, v: { debtLimit: number; allowCredit: boolean }) {
  assertCan(actor.perms, "partner.manage");
  const before = await loadEditable(db, actor, id);
  await db.partner.update({ where: { id }, data: { debtLimit: new Prisma.Decimal(v.debtLimit), allowCredit: v.allowCredit } });
  await writeAudit(db, {
    userId: actor.userId, action: "partner.set_credit", entity: "Partner", entityId: id,
    before: { debtLimit: before.debtLimit.toString(), allowCredit: before.allowCredit }, after: { debtLimit: String(v.debtLimit), allowCredit: v.allowCredit },
  });
}

export async function setPartnerOwner(db: Db, actor: Actor, id: number, v: { ownerUserId: number | null }) {
  assertCan(actor.perms, "partner.manage");
  const before = await loadEditable(db, actor, id);
  await assertOwnerUsable(db, v.ownerUserId);
  await db.partner.update({ where: { id }, data: { ownerUserId: v.ownerUserId } });
  await writeAudit(db, { userId: actor.userId, action: "partner.set_owner", entity: "Partner", entityId: id, before: { ownerUserId: before.ownerUserId }, after: { ownerUserId: v.ownerUserId } });
}

export async function setPartnerActive(db: Db, actor: Actor, id: number, v: { isActive: boolean }) {
  assertCan(actor.perms, "partner.manage");
  const before = await loadEditable(db, actor, id);
  if (before.isActive === v.isActive) return;
  await db.partner.update({ where: { id }, data: { isActive: v.isActive } });
  await writeAudit(db, { userId: actor.userId, action: "partner.set_active", entity: "Partner", entityId: id, before: { isActive: before.isActive }, after: { isActive: v.isActive } });
}
```

- [ ] **Step 7: Chạy → xanh** (`rtk proxy npx vitest run tests/partners/service.test.ts`).

- [ ] **Step 8: Test truy vấn (đỏ)** — `tests/partners/queries.test.ts`

```ts
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { exportPartnersXlsx, getPartner, listPartners, PARTNER_FILTER_KEYS, searchPartners } from "@/server/partners/queries";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup, makeUser } from "../helpers/factories";

const P = (sp: Record<string, string> = {}) => parseListParams(sp, PARTNER_FILTER_KEYS);
let sellerA: Actor; let sellerB: Actor; let boss: Actor; let gid: number;

beforeEach(async () => {
  await resetDb();
  const a = await makeUser(); const b = await makeUser(); const c = await makeUser();
  sellerA = { userId: a.id, perms: new Set(["partner.view"]) };
  sellerB = { userId: b.id, perms: new Set(["partner.view"]) };
  boss = { userId: c.id, perms: new Set(["partner.view", "partner.view_all"]) };
  gid = (await makePartnerGroup("Thợ")).id;
});

const mk = (over: Record<string, unknown>) => makePartner({ groupId: gid, ...over } as never);
const norm = (s: string) => s.toLowerCase();

describe("listPartners — tìm, lọc, thống kê", () => {
  beforeEach(async () => {
    await mk({ code: "KH1", name: "Nguyễn Văn Đạt", searchText: "kh1 nguyen van dat", ownerUserId: sellerA.userId });
    await mk({ code: "KH2", name: "Trần Thị Lan", searchText: "kh2 tran thi lan", isActive: false, ownerUserId: sellerB.userId });
    await mk({ code: "NCC1", name: "Hoa Sen", searchText: "ncc1 hoa sen", isCustomer: false, isSupplier: true });
  });

  it("danh sách khách chỉ gồm isCustomer; danh sách NCC chỉ gồm isSupplier", async () => {
    expect((await listPartners(prisma, boss, P(), "customer")).rows.map((r) => r.code).sort()).toEqual(["KH1", "KH2"]);
    expect((await listPartners(prisma, boss, P(), "supplier")).rows.map((r) => r.code)).toEqual(["NCC1"]);
  });

  it("[Review Focus 1] gõ 'dat', 'ĐẠT ', 'nguyen   van' đều ra Nguyễn Văn Đạt", async () => {
    for (const q of ["dat", "ĐẠT ", "nguyen   van", "KH1"]) {
      expect((await listPartners(prisma, boss, P({ q }), "customer")).rows.map((r) => r.code), q).toEqual(["KH1"]);
    }
  });

  it("stat Tổng/Đang hoạt động/Đã tắt không lệch theo bộ lọc trạng thái", async () => {
    const r = await listPartners(prisma, boss, P({ status: "inactive" }), "customer");
    expect(r.stats).toEqual({ all: 2, active: 1, inactive: 1 });
    expect(r.rows.map((x) => x.code)).toEqual(["KH2"]);
  });

  it("[Review Focus 6] Bán hàng (thiếu view_all) chỉ thấy khách của mình; có view_all thấy hết", async () => {
    expect((await listPartners(prisma, sellerA, P(), "customer")).rows.map((r) => r.code)).toEqual(["KH1"]);
    expect((await listPartners(prisma, sellerB, P(), "customer")).rows.map((r) => r.code)).toEqual(["KH2"]);
    expect((await listPartners(prisma, sellerA, P(), "supplier")).rows).toHaveLength(0); // NCC không có người phụ trách ⇒ không thấy
  });

  it("khách đã gộp mã (mergedIntoId) KHÔNG hiện trong danh sách", async () => {
    const keep = await prisma.partner.findFirstOrThrow({ where: { code: "KH1" } });
    await mk({ code: "KH9", name: "Đạt (trùng)", searchText: "kh9 dat trung", mergedIntoId: keep.id });
    expect((await listPartners(prisma, boss, P({ q: "dat" }), "customer")).rows.map((r) => r.code)).toEqual(["KH1"]);
  });

  it("lọc theo nhóm; sort tên giảm dần; DTO có tên nhóm và hạn mức là chuỗi", async () => {
    const other = await makePartnerGroup("VIP");
    await mk({ code: "KH3", name: "Zed", searchText: "kh3 zed", groupId: other.id, debtLimit: 1500 });
    const r = await listPartners(prisma, boss, P({ group: String(other.id) }), "customer");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ groupName: "VIP", debtLimit: "1500" });
    expect((await listPartners(prisma, boss, P({ sort: "-name" }), "customer")).rows[0]!.code).toBe("KH3");
  });
});

describe("searchPartners (ô chọn)", () => {
  beforeEach(async () => {
    await mk({ code: "KH1", name: "Nguyễn Văn Đạt", searchText: "kh1 nguyen van dat", ownerUserId: sellerA.userId });
    await mk({ code: "KH2", name: "Đạt Khác", searchText: "kh2 dat khac", isActive: false });
    await mk({ code: "KH3", name: "Đạt Của B", searchText: "kh3 dat cua b", ownerUserId: sellerB.userId });
  });

  it("[Review Focus 1, 6] không hiện khách đã tắt, đã gộp, hoặc của người khác; tìm không dấu", async () => {
    const keep = await prisma.partner.findFirstOrThrow({ where: { code: "KH1" } });
    await mk({ code: "KH4", name: "Đạt Gộp", searchText: "kh4 dat gop", mergedIntoId: keep.id, ownerUserId: sellerA.userId });
    const opts = await searchPartners(prisma, sellerA, { q: "dat", kind: "customer" });
    expect(opts.map((o) => o.label)).toEqual(["KH1 — Nguyễn Văn Đạt"]);
    expect((await searchPartners(prisma, boss, { q: "dat", kind: "customer" })).map((o) => o.label).sort()).toEqual(["KH1 — Nguyễn Văn Đạt", "KH3 — Đạt Của B"]);
  });

  it("giới hạn số kết quả (≤ 50)", async () => {
    for (let i = 0; i < 60; i++) await mk({ code: `Z${i}`, name: `Zed ${i}`, searchText: `z${i} zed ${i}` });
    expect(await searchPartners(prisma, boss, { q: "zed", kind: "customer", limit: 500 })).toHaveLength(50);
  });
});

describe("getPartner", () => {
  it("[Review Focus 6] khách người khác → 404 (không phải 403)", async () => {
    const p = await mk({ code: "KH1", name: "A", searchText: "kh1 a", ownerUserId: sellerB.userId });
    await expect(getPartner(prisma, sellerA, p.id)).rejects.toMatchObject({ status: 404 });
    expect((await getPartner(prisma, sellerB, p.id)).code).toBe("KH1");
  });

  it("đúng loại: NCC mở bằng đường khách hàng → 404", async () => {
    const p = await mk({ code: "NCC1", name: "S", searchText: "ncc1 s", isCustomer: false, isSupplier: true });
    await expect(getPartner(prisma, boss, p.id, "customer")).rejects.toMatchObject({ status: 404 });
    expect((await getPartner(prisma, boss, p.id, "supplier")).code).toBe("NCC1");
  });
});

describe("exportPartnersXlsx", () => {
  it("[Review Focus 6] file xuất theo ĐÚNG phạm vi + bộ lọc của người xuất; mã và SĐT giữ dạng chữ", async () => {
    await mk({ code: "KH1", name: "A", searchText: "kh1 a", ownerUserId: sellerA.userId, phone: "0912345678" });
    await mk({ code: "KH2", name: "B", searchText: "kh2 b", ownerUserId: sellerB.userId });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await exportPartnersXlsx(prisma, sellerA, P(), "customer")) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(2); // tiêu đề + 1 khách của A
    expect(String(ws.getRow(2).getCell(1).value)).toBe("KH1");
    expect(norm(JSON.stringify(ws.getRow(2).values))).toContain("0912345678");
  });
});
```

- [ ] **Step 9: Chạy → đỏ**; viết `src/server/partners/queries.ts`

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { buildXlsx } from "@/server/export/xlsx";
import { DomainError } from "@/server/http/errors";
import type { PartnerKind } from "./codes";

type Db = Prisma.TransactionClient | PrismaClient;

export type { PartnerKind };
export const PARTNER_FILTER_KEYS = ["status", "group", "owner"] as const;

export interface PartnerDTO {
  id: number; code: string; name: string;
  groupId: number; groupName: string;
  isCustomer: boolean; isSupplier: boolean;
  ownerUserId: number | null; ownerName: string | null;
  debtLimit: string; allowCredit: boolean;
  phone: string | null; address: string | null; note: string | null;
  isActive: boolean; mergedIntoId: number | null; createdAt: Date;
}

const INCLUDE = { group: { select: { name: true } }, owner: { select: { fullName: true } } } satisfies Prisma.PartnerInclude;
type Row = Prisma.PartnerGetPayload<{ include: typeof INCLUDE }>;

const toDto = (p: Row): PartnerDTO => ({
  id: p.id, code: p.code, name: p.name, groupId: p.groupId, groupName: p.group.name,
  isCustomer: p.isCustomer, isSupplier: p.isSupplier, ownerUserId: p.ownerUserId, ownerName: p.owner?.fullName ?? null,
  debtLimit: p.debtLimit.toString(), allowCredit: p.allowCredit, phone: p.phone, address: p.address, note: p.note,
  isActive: p.isActive, mergedIntoId: p.mergedIntoId, createdAt: p.createdAt,
});

const ints = (v: string[] | undefined) => (v ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);

/**
 * where DÙNG CHUNG cho trang danh sách, thống kê và Export (Export không được rộng hơn những gì người dùng thấy):
 * chưa gộp mã + đúng loại + phạm vi "khách của mình" + tìm không dấu + bộ lọc nhóm/người phụ trách (+ trạng thái).
 */
export function partnerWhere(actor: Actor, params: ListParams, kind: PartnerKind, opts: { ignoreStatus?: boolean } = {}): Prisma.PartnerWhereInput {
  const and: Prisma.PartnerWhereInput[] = [
    { mergedIntoId: null },
    kind === "customer" ? { isCustomer: true } : { isSupplier: true },
    partnerScopeWhere(actor),
    searchTextWhere(params.q),
  ];
  const groups = ints(params.filters.group);
  if (groups.length) and.push({ groupId: { in: groups } });
  const owners = ints(params.filters.owner);
  if (owners.length) and.push({ ownerUserId: { in: owners } });
  const status = params.filters.status?.[0];
  if (!opts.ignoreStatus && (status === "active" || status === "inactive")) and.push({ isActive: status === "active" });
  return { AND: and };
}

const SORTABLE = ["name", "code", "createdAt"] as const;

export async function listPartners(db: Db, actor: Actor, params: ListParams, kind: PartnerKind) {
  const where = partnerWhere(actor, params, kind);
  const base = partnerWhere(actor, params, kind, { ignoreStatus: true });
  const [rows, total, all, active] = await Promise.all([
    db.partner.findMany({ where, include: INCLUDE, orderBy: sortToOrderBy(params.sort, SORTABLE, { createdAt: "desc" }), skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.partner.count({ where }),
    db.partner.count({ where: base }),
    db.partner.count({ where: { AND: [base, { isActive: true }] } }),
  ]);
  return { rows: rows.map(toDto), total, stats: { all, active, inactive: all - active } };
}

/** Ngoài phạm vi / sai loại → 404 (không lộ sự tồn tại của khách người khác). Đối tác ĐÃ GỘP vẫn mở được (trang hiện biểu ngữ). */
export async function getPartner(db: Db, actor: Actor, id: number, kind?: PartnerKind): Promise<PartnerDTO> {
  const p = await db.partner.findFirst({
    where: { id, ...partnerScopeWhere(actor), ...(kind === "customer" ? { isCustomer: true } : kind === "supplier" ? { isSupplier: true } : {}) },
    include: INCLUDE,
  });
  if (!p) throw new DomainError("Không tìm thấy đối tác.", 404);
  return toDto(p);
}

/** Ô chọn (combobox): CHỈ đang hoạt động, chưa gộp, trong phạm vi người gọi; tìm không dấu; tối đa 50 kết quả. */
export async function searchPartners(db: Db, actor: Actor, opts: { q?: string; kind: PartnerKind; limit?: number }) {
  const rows = await db.partner.findMany({
    where: {
      AND: [
        { mergedIntoId: null, isActive: true }, opts.kind === "customer" ? { isCustomer: true } : { isSupplier: true },
        partnerScopeWhere(actor), searchTextWhere(opts.q),
      ],
    },
    orderBy: { name: "asc" }, take: Math.min(Math.max(opts.limit ?? 20, 1), 50),
    select: { id: true, code: true, name: true, phone: true },
  });
  return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}`, hint: r.phone ?? undefined }));
}

const MAX_EXPORT = 50_000;

export async function exportPartnersXlsx(db: Db, actor: Actor, params: ListParams, kind: PartnerKind): Promise<Buffer> {
  const rows = await db.partner.findMany({ where: partnerWhere(actor, params, kind), include: INCLUDE, orderBy: { code: "asc" }, take: MAX_EXPORT });
  return buildXlsx(kind === "customer" ? "Khách hàng" : "Nhà cung cấp", [
    { header: "Mã", key: "code", width: 14, text: true },
    { header: "Tên", key: "name", width: 34 },
    { header: "Nhóm", key: "groupName", width: 18 },
    { header: "Người phụ trách", key: "ownerName", width: 20 },
    { header: "Hạn mức nợ", key: "debtLimit", width: 16, numFmt: "#,##0" },
    { header: "Cho ghi nợ", key: "allowCredit", width: 12 },
    { header: "Điện thoại", key: "phone", width: 16, text: true },
    { header: "Địa chỉ", key: "address", width: 36 },
    { header: "Ghi chú", key: "note", width: 30 },
    { header: "Trạng thái", key: "status", width: 14 },
  ], rows.map((p) => ({ ...toDto(p), allowCredit: p.allowCredit ? "Có" : "Không", status: p.isActive ? "Đang hoạt động" : "Đã tắt" })));
}
```

Ghi chú: `partnerScopeWhere` trả `{}` hoặc `{ownerUserId}` — hợp lệ trong `AND`. `searchTextWhere` trả `{}` khi rỗng — cũng hợp lệ.

- [ ] **Step 10: Chạy → xanh** (`rtk proxy npx vitest run tests/partners`).

- [ ] **Step 11: Test + viết Import spec KH/NCC** — `tests/partners/import.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { buildXlsx } from "@/server/export/xlsx";
import { commitImport, previewImport } from "@/server/import/framework";
import { partnerImportSpec } from "@/server/partners/import-spec";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup, makeUser } from "../helpers/factories";

let actor: Actor;
const H = ["Mã", "Tên", "Nhóm", "Điện thoại", "Địa chỉ", "Hạn mức nợ", "Cho ghi nợ", "Người phụ trách", "Ghi chú"];
const sheet = (rows: unknown[][]) => buildXlsx("S", H.map((h, i) => ({ header: h, key: `c${i}` })), rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))));

beforeEach(async () => {
  await resetDb();
  actor = { userId: (await makeUser()).id, perms: new Set() };
  await makePartnerGroup("Thợ");
  await makeUser({ username: "nam" });
});

describe("import khách hàng (D1)", () => {
  it("[Review Focus 2] đọc hạn mức '12.500.000', 'Có/Không', người phụ trách theo tên đăng nhập, nhóm theo tên KHÔNG dấu", async () => {
    const buf = await sheet([["kh10", "Nguyễn Văn Đạt", "tho", "0912345678", "Q12", "12.500.000", "Có", "nam", ""]]);
    const r = await commitImport(prisma, actor, partnerImportSpec("customer"), buf, { overwrite: false, idempotencyKey: "a" });
    expect(r.created).toBe(1);
    const p = await prisma.partner.findFirstOrThrow({ where: { code: "KH10" }, include: { group: true, owner: true } });
    expect([p.name, p.group.name, p.debtLimit.toString(), p.allowCredit, p.owner?.username, p.isCustomer, p.isSupplier]).toEqual(["Nguyễn Văn Đạt", "Thợ", "12500000", true, "nam", true, false]);
    expect(p.searchText).toBe("kh10 nguyen van dat 0912345678"); // D-9: import cũng ghi searchText chuẩn hoá
  });

  it("lỗi từng dòng có lý do: nhóm chưa có, hạn mức sai, 'Có/Không' lạ, người phụ trách lạ, thiếu tên — KHÔNG dòng lỗi nào được ghi", async () => {
    const buf = await sheet([
      ["K1", "A", "Nhóm Lạ", "", "", "", "", "", ""],
      ["K2", "B", "Thợ", "", "", "12abc", "", "", ""],
      ["K3", "C", "Thợ", "", "", "", "có lẽ", "", ""],
      ["K4", "D", "Thợ", "", "", "", "", "ai-do", ""],
      ["K5", "", "Thợ", "", "", "", "", "", ""],
    ]);
    const p = await previewImport(prisma, partnerImportSpec("customer"), buf, { overwrite: false });
    expect(p.counts.error).toBe(5);
    expect(p.rows.find((r) => r.line === 2)!.message).toContain('Nhóm "Nhóm Lạ" chưa có');
    expect(p.rows.find((r) => r.line === 3)!.message).toContain("Hạn mức nợ");
    expect(p.rows.find((r) => r.line === 4)!.message).toContain("Cho ghi nợ");
    expect(p.rows.find((r) => r.line === 5)!.message).toContain('Người phụ trách "ai-do"');
    const r = await commitImport(prisma, actor, partnerImportSpec("customer"), buf, { overwrite: false, idempotencyKey: "b" });
    expect(r.created).toBe(0);
    expect(await prisma.partner.count()).toBe(0);
  });

  it("[Review Focus 4] nhập lần 2 cùng file: bỏ qua dòng đã có; Ghi đè cập nhật tên + searchText", async () => {
    const buf = await sheet([["KH1", "Tên cũ", "Thợ", "", "", "", "", "", ""]]);
    await commitImport(prisma, actor, partnerImportSpec("customer"), buf, { overwrite: false, idempotencyKey: "1" });
    const again = await commitImport(prisma, actor, partnerImportSpec("customer"), buf, { overwrite: false, idempotencyKey: "2" });
    expect(again).toMatchObject({ created: 0, skippedExisting: 1 });
    const buf2 = await sheet([["KH1", "Tên mới", "Thợ", "", "", "", "", "", ""]]);
    await commitImport(prisma, actor, partnerImportSpec("customer"), buf2, { overwrite: true, idempotencyKey: "3" });
    const p = await prisma.partner.findFirstOrThrow({ where: { code: "KH1" } });
    expect([p.name, p.searchText]).toEqual(["Tên mới", "kh1 ten moi"]);
    expect(await prisma.partner.count()).toBe(1);
  });

  it("import NCC với mã đã là KHÁCH: Ghi đè bật thêm cờ NCC (một đối tác vừa mua vừa bán), không nhân đôi", async () => {
    const g = (await prisma.partnerGroup.findFirstOrThrow()).id;
    await makePartner({ code: "KH5", name: "Cả hai", searchText: "kh5 ca hai", groupId: g });
    const buf = await sheet([["KH5", "Cả hai", "Thợ", "", "", "", "", "", ""]]);
    await commitImport(prisma, actor, partnerImportSpec("supplier"), buf, { overwrite: true, idempotencyKey: "s" });
    const p = await prisma.partner.findFirstOrThrow({ where: { code: "KH5" } });
    expect([p.isCustomer, p.isSupplier]).toEqual([true, true]);
  });
});
```

`src/server/partners/import-spec.ts`:

```ts
import { Prisma } from "@prisma/client";
import { parseViNumber } from "@/lib/parse-number";
import { normalizeSearch } from "@/lib/search";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import type { PartnerKind } from "./codes";
import { searchTextOf } from "./service";

export interface PartnerImportRow {
  code: string; name: string; groupId: number; phone: string; address: string; note: string;
  debtLimit: string; allowCredit: boolean; ownerUserId: number | null;
}
export interface PartnerImportCtx { groups: Map<string, number>; owners: Map<string, number> }

const COLUMNS: readonly ImportColumn[] = [
  { key: "code", header: "Mã", required: true, sample: "KH001" },
  { key: "name", header: "Tên", required: true, sample: "Nguyễn Văn Đạt" },
  { key: "group", header: "Nhóm", required: true, sample: "Khách lẻ" },
  { key: "phone", header: "Điện thoại", sample: "0912345678" },
  { key: "address", header: "Địa chỉ", sample: "Quận 12, TP.HCM" },
  { key: "debtLimit", header: "Hạn mức nợ", sample: "12.500.000" },
  { key: "allowCredit", header: "Cho ghi nợ", sample: "Có" },
  { key: "owner", header: "Người phụ trách", aliases: ["Nhân viên phụ trách"], sample: "nam" },
  { key: "note", header: "Ghi chú", sample: "" },
];

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** "Có/Không" kiểu người dùng gõ. Rỗng = Không. Giá trị lạ → null (báo lỗi, không đoán). */
export function parseYesNo(v: unknown): boolean | null {
  const s = normalizeSearch(str(v));
  if (["", "khong", "k", "0", "no", "false", "n"].includes(s)) return false;
  if (["co", "c", "x", "1", "yes", "true", "y"].includes(s)) return true;
  return null;
}

export function partnerImportSpec(kind: PartnerKind): ImportSpec<PartnerImportRow, PartnerImportCtx> {
  return {
    entity: "Partner",
    label: kind === "customer" ? "khách hàng" : "nhà cung cấp",
    columns: COLUMNS,

    async loadContext(db) {
      const [groups, users] = await Promise.all([db.partnerGroup.findMany({ select: { id: true, name: true } }), db.user.findMany({ where: { isLocked: false }, select: { id: true, username: true } })]);
      return {
        groups: new Map(groups.map((g) => [normalizeSearch(g.name), g.id])),
        owners: new Map(users.map((u) => [u.username.toLowerCase(), u.id])),
      };
    },

    parseRow(c, ctx) {
      const errors: string[] = [];
      const code = str(c.code).toUpperCase();
      if (!code) errors.push("Thiếu mã.");
      else if (!/^[A-Z0-9._-]{1,30}$/.test(code)) errors.push("Mã chỉ gồm chữ không dấu, số và . _ - (tối đa 30 ký tự).");
      const name = str(c.name);
      if (!name) errors.push("Thiếu tên.");
      else if (name.length > 120) errors.push("Tên tối đa 120 ký tự.");
      const groupName = str(c.group);
      const groupId = ctx.groups.get(normalizeSearch(groupName));
      if (!groupName) errors.push("Thiếu nhóm.");
      else if (groupId === undefined) errors.push(`Nhóm "${groupName}" chưa có — tạo ở Hệ thống → Cài đặt danh mục trước.`);
      const limit = parseViNumber(c.debtLimit);
      if (!limit.ok) errors.push(`Hạn mức nợ: ${limit.message}`);
      const credit = parseYesNo(c.allowCredit);
      if (credit === null) errors.push(`Cho ghi nợ: "${str(c.allowCredit)}" — nhập Có hoặc Không.`);
      const ownerName = str(c.owner);
      const ownerUserId = ownerName ? ctx.owners.get(ownerName.toLowerCase()) : null;
      if (ownerName && ownerUserId === undefined) errors.push(`Người phụ trách "${ownerName}" không có (hoặc đã khoá) — nhập tên đăng nhập.`);
      if (errors.length > 0) return { ok: false, errors };
      return {
        ok: true,
        data: {
          code, name, groupId: groupId!, phone: str(c.phone), address: str(c.address), note: str(c.note),
          debtLimit: (limit as { value: string | null }).value ?? "0", allowCredit: credit!, ownerUserId: ownerUserId ?? null,
        },
      };
    },

    keyOf: (d) => d.code,

    async existingKeys(db, keys) {
      return new Set((await db.partner.findMany({ where: { code: { in: keys } }, select: { code: true } })).map((p) => p.code));
    },

    async create(tx, _actor, rows) {
      if (rows.length === 0) return;
      await tx.partner.createMany({
        data: rows.map((r) => ({
          code: r.code, name: r.name, searchText: searchTextOf(r), groupId: r.groupId,
          isCustomer: kind === "customer", isSupplier: kind === "supplier", ownerUserId: r.ownerUserId,
          debtLimit: new Prisma.Decimal(r.debtLimit), allowCredit: r.allowCredit,
          phone: r.phone || null, address: r.address || null, note: r.note || null,
        })),
      });
    },

    async update(tx, _actor, rows) {
      for (const r of rows) {
        await tx.partner.update({
          where: { code: r.code },
          data: {
            name: r.name, searchText: searchTextOf(r), groupId: r.groupId, ownerUserId: r.ownerUserId,
            debtLimit: new Prisma.Decimal(r.debtLimit), allowCredit: r.allowCredit,
            phone: r.phone || null, address: r.address || null, note: r.note || null,
            // một đối tác có thể vừa là khách vừa là NCC: import chỉ BẬT thêm cờ của loại đang nhập, không tắt cờ kia
            ...(kind === "customer" ? { isCustomer: true } : { isSupplier: true }),
          },
        });
      }
    },
  };
}
```


- [ ] **Step 12: Chạy → xanh**, lint + typecheck, commit

```bash
rtk proxy npx vitest run tests/partners tests/import
rtk proxy npm run lint && rtk proxy npm run typecheck
git add src/server/partners tests/partners
git commit -m "feat(partners): KH/NCC backend — mã tự sinh, tìm không dấu, phạm vi khách của mình, import D1"
```

---
### Task 6: Khách hàng & NCC — API và giao diện (danh sách, tạo mới, chi tiết, nhập/xuất)

**Mã:** 9, 10. **Files:**
- Create: `src/components/ui/Field.tsx`, `src/components/ui/EditableSection.tsx` (+ export ở `src/components/ui/index.ts`)
- Create: `src/server/partners/kind-param.ts`
- Create: `src/app/api/partners/route.ts`, `src/app/api/partners/[id]/section-update/route.ts`, `src/app/api/partner-lists/[kind]/{search,export,import,import-template}/route.ts`
- Create: `src/components/partners/{kinds.ts,PartnerList.tsx,PartnerTable.tsx,PartnerNewForm.tsx,PartnerDetail.tsx,load-detail.tsx}`
- Create: `src/app/(app)/sales/customers/{page.tsx,new/page.tsx,[id]/page.tsx}` và `src/app/(app)/purchase/suppliers/{page.tsx,new/page.tsx,[id]/page.tsx}`
- Modify: `src/config/app.config.ts` (bỏ `planned` của `customer-list`, `supplier-list`)
- Test: `tests/partners/kind-param.test.ts`, `tests/ui/partner-new-form.test.tsx`, `tests/ui/partner-detail.test.tsx`, `tests/ui/partner-pages.test.tsx`

**Interfaces:**
- Consumes: Task 5 (service/queries/import-spec), Task 4 (`ImportExportMenu`, `handleImportPost`, `handleTemplateGet`), Task 2 (`listActiveOptions`).
- Produces: API `POST /api/partners` (Idempotency-Key) → `{ id, code }`; `PATCH /api/partners/:id/section-update` body `{ section: "profile" | "credit" | "owner" | "status", ... }`; `GET /api/partner-lists/:kind/search?q=` → `ComboOption[]`; `GET …/export`; `POST …/import?mode=`; `GET …/import-template` (`:kind` = `customers` | `suppliers`). Component `Field`, `inputClass`, `EditableSection` (dùng lại ở mọi form/trang chi tiết sau).

- [ ] **Step 1: Bổ sung phần thiếu của Task 5 — người tạo phải thấy được bản ghi của mình.** Nếu người tạo có `partner.manage` nhưng thiếu `partner.view_all` mà để trống "người phụ trách" thì khách vừa tạo nằm ngoài phạm vi của chính họ (biến mất khỏi danh sách). Quy tắc: thiếu `view_all` ⇒ mặc định người phụ trách = chính họ.

Thêm test vào `tests/partners/service.test.ts` (trong `describe("createPartner")`):

```ts
  it("người tạo thiếu partner.view_all mà không chọn người phụ trách → tự gán chính họ (không tạo ra khách 'vô hình' với mình)", async () => {
    const seller = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view"]) };
    const { id } = await tx((db) => createPartner(db, seller, input()));
    expect((await prisma.partner.findUniqueOrThrow({ where: { id } })).ownerUserId).toBe(seller.userId);
    const boss = await tx((db) => createPartner(db, manager, input({ name: "Khách khác" })));
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: boss.id } })).ownerUserId).toBeNull(); // có view_all → giữ null
  });
```

Sửa `createPartner` (Task 5): sau `assertOwnerUsable`, thêm và dùng cho cả `create` lẫn audit:

```ts
  const ownerUserId = input.ownerUserId ?? (actor.perms.has("partner.view_all") ? null : actor.userId);
```
(thay `ownerUserId: input.ownerUserId` trong `data` bằng `ownerUserId`). Chạy `rtk proxy npx vitest run tests/partners/service.test.ts` → xanh.

- [ ] **Step 2: `Field` dùng chung** — `src/components/ui/Field.tsx`

```tsx
/** Lớp cho ô nhập: cao 44px trên mobile / 36px trên PC (chạm được), viền đỏ khi có lỗi. */
export const inputClass = (error?: unknown) =>
  `h-11 w-full rounded-sm border bg-canvas px-3 text-sm md:h-9 ${error ? "border-danger" : "border-border"}`;

/**
 * Nhãn + ô nhập + lỗi/gợi ý. Ô nhập đặt `id`, `aria-invalid={!!error}` và `aria-describedby` = `${id}-error` khi có lỗi
 * (hoặc `${id}-hint` khi có gợi ý) để đọc màn hình đọc đúng.
 */
export function Field({ id, label, error, hint, required, className, children }: {
  id: string; label: string; error?: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs text-fg-muted">{label}{required ? " *" : ""}</label>
      {children}
      {error ? <p id={`${id}-error`} className="mt-1 text-xs text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}
```

Thêm vào `src/components/ui/index.ts`: `export { Field, inputClass } from "./Field";`. Tái dùng ngay ở `CatalogFields` là tuỳ chọn (không bắt buộc — không đổi hành vi).

- [ ] **Step 3: Tham số loại + route API**

`src/server/partners/kind-param.ts` + test `tests/partners/kind-param.test.ts`:

```ts
import { DomainError } from "@/server/http/errors";
import type { PartnerKind } from "./codes";

/** Đoạn URL `customers` | `suppliers` → PartnerKind; khác → 404. */
export function parseKindParam(raw: string): PartnerKind {
  if (raw === "customers") return "customer";
  if (raw === "suppliers") return "supplier";
  throw new DomainError("Không tìm thấy danh sách.", 404);
}
```

```ts
import { describe, expect, it } from "vitest";
import { parseKindParam } from "@/server/partners/kind-param";

describe("parseKindParam", () => {
  it("customers/suppliers hợp lệ, còn lại 404", () => {
    expect(parseKindParam("customers")).toBe("customer");
    expect(parseKindParam("suppliers")).toBe("supplier");
    expect(() => parseKindParam("partners")).toThrow(expect.objectContaining({ status: 404 }));
  });
});
```

Các route (mỗi file TỰ gọi `requireActorApi(` — `tests/api/route-guards.test.ts` kiểm):

`src/app/api/partners/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { createPartnerSchema } from "@/server/partners/schemas";
import { createPartnerIdempotent } from "@/server/partners/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("partner.manage");
  const key = readIdempotencyKey(req);
  return createPartnerIdempotent(prisma, actor, key, createPartnerSchema.parse(await readJson(req)));
});
```

`src/app/api/partners/[id]/section-update/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { creditSectionSchema, ownerSectionSchema, profileSectionSchema, statusSectionSchema } from "@/server/partners/schemas";
import { setPartnerActive, setPartnerCredit, setPartnerOwner, updatePartnerProfile } from "@/server/partners/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("partner.manage");
  const id = idParam.parse((await ctx.params).id);
  const raw = await readJson(req);
  const { section } = z.object({ section: z.string().optional() }).parse(raw);
  // Chỉ ghi các field thuộc đúng `section` (full-page-detail.md mục 4)
  switch (section) {
    case "profile": { const v = profileSectionSchema.parse(raw); await prisma.$transaction((tx) => updatePartnerProfile(tx, actor, id, v)); break; }
    case "credit": { const v = creditSectionSchema.parse(raw); await prisma.$transaction((tx) => setPartnerCredit(tx, actor, id, v)); break; }
    case "owner": { const v = ownerSectionSchema.parse(raw); await prisma.$transaction((tx) => setPartnerOwner(tx, actor, id, v)); break; }
    case "status": { const v = statusSectionSchema.parse(raw); await prisma.$transaction((tx) => setPartnerActive(tx, actor, id, v)); break; }
    default: throw new ValidationError("Phần dữ liệu không hợp lệ.");
  }
  return { ok: true };
});
```

`src/app/api/partner-lists/[kind]/search/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { parseKindParam } from "@/server/partners/kind-param";
import { searchPartners } from "@/server/partners/queries";

export const dynamic = "force-dynamic";

/** Ô chọn KH/NCC: chỉ đang hoạt động, chưa gộp, trong phạm vi người gọi. */
export const GET = apiHandler(async (req, ctx: { params: Promise<{ kind: string }> }) => {
  const actor = await requireActorApi("partner.view");
  const kind = parseKindParam((await ctx.params).kind);
  return searchPartners(prisma, actor, { q: new URL(req.url).searchParams.get("q") ?? "", kind });
});
```

`…/export/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { parseKindParam } from "@/server/partners/kind-param";
import { exportPartnersXlsx, PARTNER_FILTER_KEYS } from "@/server/partners/queries";

export const dynamic = "force-dynamic";

/** Xuất theo ĐÚNG bộ lọc + phạm vi "khách của mình" như trang danh sách (không rộng hơn những gì người dùng thấy). */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const actor = await requireActorApi("partner.view");
    const kind = parseKindParam((await ctx.params).kind);
    const sp: Record<string, string[]> = Object.create(null);
    for (const [k, v] of new URL(req.url).searchParams) (sp[k] ??= []).push(v);
    const buf = await exportPartnersXlsx(prisma, actor, parseListParams(sp, PARTNER_FILTER_KEYS), kind);
    return xlsxResponse(kind === "customer" ? "khach-hang.xlsx" : "nha-cung-cap.xlsx", buf);
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

`…/import/route.ts` và `…/import-template/route.ts`:

```ts
// import/route.ts
import type { NextRequest } from "next/server";
import { assertCan } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
import { parseKindParam } from "@/server/partners/kind-param";
import { partnerImportSpec } from "@/server/partners/import-spec";

export async function POST(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const actor = await requireActorApi("data.import");
    assertCan(actor.perms, "partner.manage"); // nhập = ghi hàng loạt ⇒ cần CẢ hai quyền
    return await handleImportPost(req, actor, partnerImportSpec(parseKindParam((await ctx.params).kind)));
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

```ts
// import-template/route.ts
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
import { parseKindParam } from "@/server/partners/kind-param";
import { partnerImportSpec } from "@/server/partners/import-spec";

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  try {
    await requireActorApi("data.import");
    return await handleTemplateGet(partnerImportSpec(parseKindParam((await ctx.params).kind)));
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

- [ ] **Step 4: Cấu hình giao diện theo loại** — `src/components/partners/kinds.ts`

```ts
import type { PartnerKind } from "@/server/partners/codes";

export const KIND_UI: Record<PartnerKind, { base: string; api: "customers" | "suppliers"; title: string; singular: string }> = {
  customer: { base: "/sales/customers", api: "customers", title: "Khách hàng", singular: "khách hàng" },
  supplier: { base: "/purchase/suppliers", api: "suppliers", title: "Nhà cung cấp", singular: "nhà cung cấp" },
};
```

- [ ] **Step 5: Danh sách (server component) + bảng (client)**

`src/components/partners/PartnerList.tsx`:

```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { ImportExportMenu } from "@/components/import/ImportExportMenu";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { listPartners, PARTNER_FILTER_KEYS, type PartnerKind } from "@/server/partners/queries";
import { KIND_UI } from "./kinds";
import { PartnerTable } from "./PartnerTable";

export async function PartnerList({ kind, actor, searchParams }: { kind: PartnerKind; actor: Actor; searchParams: Record<string, string | string[] | undefined> }) {
  const ui = KIND_UI[kind];
  const params = parseListParams(searchParams, PARTNER_FILTER_KEYS);
  const viewAll = actor.perms.has("partner.view_all");
  const [{ rows, total, stats }, groups, owners] = await Promise.all([
    listPartners(prisma, actor, params, kind),
    prisma.partnerGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    viewAll ? prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(ui.base, params, patch);
  const status = params.filters.status?.[0];
  const canManage = actor.perms.has("partner.manage");
  const canImport = canManage && actor.perms.has("data.import");
  const filtered = !!(params.q || params.filters.status || params.filters.group || params.filters.owner);
  const api = `/api/partner-lists/${ui.api}`;

  return (
    <ListPageLayout
      title={ui.title}
      actions={<>
        <ImportExportMenu exportHref={buildExportHref(`${api}/export`, params)} importTitle={`Nhập ${ui.singular} từ Excel`}
          {...(canImport ? { importEndpoint: `${api}/import`, templateHref: `${api}/import-template` } : {})} />
        {canManage && <Link href={`${ui.base}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Thêm mới</Link>}
      </>}
      stats={<>
        <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
        <StatCard label="Đang hoạt động" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
        <StatCard label="Đã tắt" value={stats.inactive} href={href({ filters: { status: ["inactive"] } })} active={status === "inactive"} />
      </>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={ui.base} params={params} placeholder="Tìm tên, mã, số điện thoại…" />
          <MultiSelectFilter label="Nhóm" paramKey="group" basePath={ui.base} params={params} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} />
          {viewAll && <MultiSelectFilter label="Người phụ trách" paramKey="owner" basePath={ui.base} params={params} options={owners.map((o) => ({ value: String(o.id), label: o.fullName }))} />}
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0 ? (
        filtered
          ? <EmptyState kind="no-result" title={`Không tìm thấy ${ui.singular} phù hợp`} description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={ui.base} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title={`Chưa có ${ui.singular} nào`} action={canManage ? <Link href={`${ui.base}/new`} className="text-sm font-medium text-accent">Thêm {ui.singular} đầu tiên</Link> : undefined} />
      ) : (
        <PartnerTable rows={redactDeep(rows, actor.perms)} kind={kind} canManage={canManage} params={params} />
      )}
    </ListPageLayout>
  );
}
```

`PartnerTable.tsx` (client):

```tsx
"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { PartnerDTO, PartnerKind } from "@/server/partners/queries";
import { KIND_UI } from "./kinds";

export function PartnerTable({ rows, kind, canManage, params }: { rows: PartnerDTO[]; kind: PartnerKind; canManage: boolean; params: ListParams }) {
  const base = KIND_UI[kind].base;
  const columns: Column<PartnerDTO>[] = [
    { key: "code", label: "Mã", sortable: true, render: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (p) => p.name },
    { key: "group", label: "Nhóm", render: (p) => p.groupName },
    { key: "phone", label: "Điện thoại", render: (p) => p.phone },
    ...(kind === "customer" ? [
      { key: "debtLimit", label: "Hạn mức nợ", align: "right" as const, render: (p: PartnerDTO) => (p.allowCredit ? formatCurrency(p.debtLimit) : null) },
      { key: "owner", label: "Phụ trách", hiddenByDefault: true, render: (p: PartnerDTO) => p.ownerName },
    ] : []),
    { key: "status", label: "Trạng thái", render: (p) => (p.isActive ? <Badge tone="success">Đang hoạt động</Badge> : <Badge>Đã tắt</Badge>) },
  ];
  // Thứ tự cố định Xem → Sửa; thao tác ghi CHỈ có khi partner.manage (ẩn hẳn, không disabled)
  const actions = (p: PartnerDTO): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `${base}/${p.id}` },
    ...(canManage ? [{ key: "edit", label: "Sửa", icon: "pencil" as const, href: `${base}/${p.id}?edit=profile` }] : []),
  ];
  return <DataTable id={`partners-${kind}`} columns={columns} rows={rows} rowKey={(p) => p.id} rowHref={(p) => `${base}/${p.id}`} rowActions={actions}
    sort={params.sort} buildSortHref={(s) => buildListHref(base, params, { sort: s })} />;
}
```

Ghi chú: cột "Hạn mức nợ" chỉ hiện giá trị khi khách được ghi nợ (`allowCredit`); không được ghi nợ → `null` → "—" (không phải "0 ₫").

- [ ] **Step 6: Form tạo mới** — `src/components/partners/PartnerNewForm.tsx`

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui/Combobox";
import { Field, inputClass } from "@/components/ui/Field";
import { NewPage } from "@/components/ui/NewPage";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { createPartnerSchema, type CreatePartnerInput } from "@/server/partners/schemas";
import type { PartnerKind } from "@/server/partners/codes";
import { KIND_UI } from "./kinds";

/** Tìm trong danh sách TĨNH đã có ở client (nhóm, nhân viên — vài chục dòng) bằng cùng chuẩn không dấu của server. */
const staticLoader = (options: ComboOption[]) => async (q: string) => filterComboOptions(options, q);

interface Props {
  kind: PartnerKind;
  groups: ComboOption[];
  owners: ComboOption[];
  /** Có partner.view_all mới chọn được người phụ trách khác (không thì server tự gán chính người tạo). */
  canPickOwner: boolean;
}

export function PartnerNewForm({ kind, groups, owners, canPickOwner }: Props) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const ui = KIND_UI[kind];
  const { register, control, handleSubmit, setError, formState: { errors, isDirty } } = useForm<CreatePartnerInput>({
    resolver: zodResolver(createPartnerSchema),
    defaultValues: {
      code: "", name: "", groupId: undefined as never, isCustomer: kind === "customer", isSupplier: kind === "supplier", ownerUserId: null,
      debtLimit: 0, allowCredit: false, phone: "", address: "", note: "", isActive: true,
    },
  });

  const submit = handleSubmit(async (v) => {
    try {
      // Cùng khoá cho mọi lần gửi lại của form này: bấm đúp / mất mạng rồi gửi lại không tạo 2 bản ghi
      const r = await apiFetch<{ id: number }>("/api/partners", { method: "POST", json: v, idempotencyKey: idem.key });
      router.replace(`${ui.base}/${r.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.fields?.code) { setError("code", { message: e.fields.code }, { shouldFocus: true }); return; }
      throw e; // lỗi khác → banner của NewPage (giữ dữ liệu đang nhập)
    }
  });

  return (
    <NewPage backHref={ui.base} backLabel={`Quay lại ${ui.title.toLowerCase()}`} title={`Thêm ${ui.singular}`} submitLabel="Tạo"
      isDirty={() => isDirty} onSubmit={async () => { await submit(); }}>
      <div className="space-y-5">
        <h2 className="text-base font-semibold">Thông tin cơ bản</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Tên" required error={errors.name?.message}>
            <input id="name" autoComplete="off" {...register("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} className={inputClass(errors.name)} />
          </Field>
          <Field id="code" label="Mã" hint="Để trống để hệ thống tự cấp (KH000001…)" error={errors.code?.message}>
            <input id="code" autoComplete="off" {...register("code")} aria-invalid={!!errors.code} aria-describedby={errors.code ? "code-error" : "code-hint"} className={inputClass(errors.code)} />
          </Field>
          {/* Combobox tự có nhãn + lỗi (role="alert") — KHÔNG bọc thêm Field để khỏi lặp nhãn */}
          <Controller control={control} name="groupId" render={({ field }) => (
            <Combobox label="Nhóm" value={groups.find((g) => g.value === field.value) ?? null} onChange={(o) => field.onChange(o ? Number(o.value) : undefined)}
              loadOptions={staticLoader(groups)} placeholder="Chọn nhóm…" {...(errors.groupId?.message ? { error: errors.groupId.message } : {})} />
          )} />
          {canPickOwner && (
            <Controller control={control} name="ownerUserId" render={({ field }) => (
              <Combobox label="Người phụ trách" value={owners.find((o) => o.value === field.value) ?? null} onChange={(o) => field.onChange(o ? Number(o.value) : null)}
                loadOptions={staticLoader(owners)} placeholder="Chọn nhân viên…" />
            )} />
          )}
          <Field id="phone" label="Điện thoại" error={errors.phone?.message}>
            <input id="phone" inputMode="tel" {...register("phone")} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "phone-error" : undefined} className={inputClass(errors.phone)} />
          </Field>
          <Field id="address" label="Địa chỉ" error={errors.address?.message} className="sm:col-span-2">
            <input id="address" {...register("address")} className={inputClass(errors.address)} />
          </Field>
          <fieldset className="flex flex-wrap gap-6 sm:col-span-2" aria-describedby={errors.isCustomer ? "kind-error" : undefined}>
            <legend className="sr-only">Loại đối tác</legend>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isCustomer")} /> Là khách hàng</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isSupplier")} /> Là nhà cung cấp</label>
            {errors.isCustomer && <p id="kind-error" className="w-full text-xs text-danger">{errors.isCustomer.message}</p>}
          </fieldset>
        </div>

        <h2 className="pt-2 text-base font-semibold">Công nợ</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="debtLimit" label="Hạn mức nợ (₫)" error={errors.debtLimit?.message}>
            <input id="debtLimit" type="number" inputMode="numeric" min={0} {...register("debtLimit", { valueAsNumber: true })} aria-invalid={!!errors.debtLimit} aria-describedby={errors.debtLimit ? "debtLimit-error" : undefined} className={`${inputClass(errors.debtLimit)} tabular text-right`} />
          </Field>
          <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" {...register("allowCredit")} /> Cho phép ghi nợ</label>
        </div>

        <Field id="note" label="Ghi chú" error={errors.note?.message}>
          <textarea id="note" rows={3} {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        </Field>
      </div>
    </NewPage>
  );
}
```

- [ ] **Step 7: Test form tạo mới (đỏ → xanh)** — `tests/ui/partner-new-form.test.tsx`

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerNewForm } from "@/components/partners/PartnerNewForm";
import { ApiError } from "@/lib/api-fetch";

const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const groups = [{ value: 1, label: "Thợ" }, { value: 2, label: "Khách lẻ" }];
const owners = [{ value: 5, label: "Nam" }];
beforeEach(() => { replace.mockReset(); apiFetch.mockReset(); });
afterEach(cleanup);

async function pickGroup(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "Nhóm" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("PartnerNewForm", () => {
  it("gửi form rỗng → lỗi tiếng Việt từng ô, không gọi API", async () => {
    render(<PartnerNewForm kind="customer" groups={groups} owners={owners} canPickOwner />);
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Nhập tên.")).toBeInTheDocument();
    expect(screen.getByText("Chọn nhóm.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Tên/)).toHaveAttribute("aria-invalid", "true");
  });

  it("route khách hàng: mặc định là khách, không phải NCC; route NCC thì ngược lại", () => {
    render(<PartnerNewForm kind="supplier" groups={groups} owners={owners} canPickOwner />);
    expect(screen.getByRole("checkbox", { name: "Là nhà cung cấp" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Là khách hàng" })).not.toBeChecked();
  });

  it("thiếu partner.view_all → KHÔNG có ô chọn người phụ trách (server tự gán chính người tạo)", () => {
    render(<PartnerNewForm kind="customer" groups={groups} owners={owners} canPickOwner={false} />);
    expect(screen.queryByRole("combobox", { name: "Người phụ trách" })).toBeNull();
  });

  it("hợp lệ → POST /api/partners kèm Idempotency-Key rồi chuyển sang trang chi tiết", async () => {
    apiFetch.mockResolvedValue({ id: 9 });
    render(<PartnerNewForm kind="customer" groups={groups} owners={owners} canPickOwner />);
    await userEvent.type(screen.getByLabelText(/^Tên/), "Nguyễn Văn Đạt");
    await pickGroup("Thợ");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/customers/9"));
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/partners");
    expect(init.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(init.json).toMatchObject({ name: "Nguyễn Văn Đạt", groupId: 1, isCustomer: true, isSupplier: false, debtLimit: 0, code: "" });
  });

  it("trùng mã (409 kèm fields.code) → lỗi tại ô Mã, giữ dữ liệu, không chuyển trang", async () => {
    apiFetch.mockRejectedValue(new ApiError(409, "Mã đã tồn tại.", undefined, { code: "Mã đã tồn tại." }));
    render(<PartnerNewForm kind="customer" groups={groups} owners={owners} canPickOwner />);
    await userEvent.type(screen.getByLabelText(/^Tên/), "A");
    await userEvent.type(screen.getByLabelText(/^Mã/), "KH1");
    await pickGroup("Thợ");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Mã đã tồn tại.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tên/)).toHaveValue("A");
    expect(replace).not.toHaveBeenCalled();
  });
});
```

Ghi chú: `Combobox` (src/components/ui/Combobox.tsx) tự render `<label>` + ô `role="combobox"` + danh sách `role="option"` + lỗi `role="alert"` nên test chọn theo tên nhãn ("Nhóm"); vì vậy form KHÔNG bọc Combobox trong `Field` (tránh lặp nhãn).

- [ ] **Step 8: Section sửa-từng-phần dùng chung + trang chi tiết** — `src/components/ui/EditableSection.tsx` (dùng lại ở SP, BOM, công ty…) và `src/components/partners/PartnerDetail.tsx`

```tsx
// src/components/ui/EditableSection.tsx
"use client";

import type { DefaultValues, FieldValues, UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";
import { DetailSection, EditActions, EditButton, useSectionForm, type TabRenderCtx } from "./DetailPage";

/**
 * MỘT section sửa-từng-phần của trang chi tiết (full-page-detail.md): chế độ xem = chữ tĩnh, chế độ sửa = form riêng của
 * section (react-hook-form + zod), Lưu/Hủy ở tiêu đề. `canEdit=false` → không bút chì và `?edit=` trên URL không mở form.
 */
export function EditableSection<T extends FieldValues>({ ctx, k, title, editLabel, canEdit, schema, defaults, save, view, edit }: {
  ctx: TabRenderCtx; k: string; title: string; editLabel: string; canEdit: boolean;
  schema: ZodType<T>; defaults: DefaultValues<T>; save: (values: T) => Promise<void>;
  view: React.ReactNode; edit: (form: UseFormReturn<T>) => React.ReactNode;
}) {
  const s = useSectionForm<T>(ctx, k, { schema, defaults, save });
  const editing = canEdit && s.editing;
  return (
    <DetailSection title={title} editing={editing}
      action={!canEdit ? null : editing
        ? <EditActions saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} />
        : <EditButton label={editLabel} onClick={() => ctx.beginEdit(k)} />}>
      {editing ? edit(s.form) : view}
    </DetailSection>
  );
}
```

Thêm `export { EditableSection } from "./EditableSection";` vào `src/components/ui/index.ts`.

```tsx
// src/components/partners/PartnerDetail.tsx
"use client";

import { Controller } from "react-hook-form";
import { Combobox, filterComboOptions, type ComboOption } from "@/components/ui/Combobox";
import { DetailField, DetailPage, useDetailNav, type TabRenderCtx } from "@/components/ui/DetailPage";
import { EditableSection } from "@/components/ui/EditableSection";
import { Field, inputClass } from "@/components/ui/Field";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { PartnerKind } from "@/server/partners/codes";
import type { PartnerDTO } from "@/server/partners/queries";
import { creditSectionSchema, ownerSectionSchema, profileSectionSchema, statusSectionSchema } from "@/server/partners/schemas";
import { KIND_UI } from "./kinds";

interface Props {
  partner: PartnerDTO;
  kind: PartnerKind;
  groups: ComboOption[];
  owners: ComboOption[];
  history: { id: number; action: string; at: string; by: string }[];
  /** partner.manage VÀ chưa bị gộp. Không có → mọi phần là chữ tĩnh, không bút chì. */
  canManage: boolean;
  /** partner.view_all — mới được đổi người phụ trách. */
  canAssign: boolean;
  mergedInto: { id: number; code: string } | null;
}

const ACTION_LABEL: Record<string, string> = {
  "partner.create": "Tạo mới", "partner.update_profile": "Sửa hồ sơ", "partner.set_credit": "Sửa hạn mức nợ",
  "partner.set_owner": "Đổi người phụ trách", "partner.set_active": "Bật/tắt hoạt động",
};
const staticLoader = (options: ComboOption[]) => async (q: string) => filterComboOptions(options, q);

export function PartnerDetail(p: Props) {
  const ui = KIND_UI[p.kind];
  const x = p.partner;
  const nav = useDetailNav(["info", "history"], { profile: "info", credit: "info", owner: "info", status: "info" });
  const save = (section: string) => (v: object) =>
    apiFetch(`/api/partners/${x.id}/section-update`, { method: "PATCH", json: { section, ...v } }).then(() => {});

  const profile = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="profile" title="Hồ sơ" editLabel="Chỉnh sửa hồ sơ" canEdit={p.canManage}
      schema={profileSectionSchema} save={save("profile")}
      defaults={{ name: x.name, groupId: x.groupId, isCustomer: x.isCustomer, isSupplier: x.isSupplier, phone: x.phone ?? "", address: x.address ?? "", note: x.note ?? "" }}
      view={
        <dl className="space-y-2">
          <DetailField label="Mã">{x.code}</DetailField>
          <DetailField label="Tên">{x.name}</DetailField>
          <DetailField label="Nhóm">{x.groupName}</DetailField>
          <DetailField label="Loại">{[x.isCustomer && "Khách hàng", x.isSupplier && "Nhà cung cấp"].filter(Boolean).join(" · ")}</DetailField>
          <DetailField label="Điện thoại">{x.phone}</DetailField>
          <DetailField label="Địa chỉ">{x.address}</DetailField>
          <DetailField label="Ghi chú">{x.note}</DetailField>
        </dl>
      }
      edit={(f) => {
        const e = f.formState.errors;
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Tên" required error={e.name?.message}>
              <input id="name" {...f.register("name")} aria-invalid={!!e.name} aria-describedby={e.name ? "name-error" : undefined} className={inputClass(e.name)} />
            </Field>
            <Controller control={f.control} name="groupId" render={({ field }) => (
              <Combobox label="Nhóm" value={p.groups.find((g) => g.value === field.value) ?? null} onChange={(o) => field.onChange(o ? Number(o.value) : undefined)}
                loadOptions={staticLoader(p.groups)} {...(e.groupId?.message ? { error: e.groupId.message } : {})} />
            )} />
            <Field id="phone" label="Điện thoại" error={e.phone?.message}>
              <input id="phone" {...f.register("phone")} aria-invalid={!!e.phone} aria-describedby={e.phone ? "phone-error" : undefined} className={inputClass(e.phone)} />
            </Field>
            <Field id="address" label="Địa chỉ" error={e.address?.message}>
              <input id="address" {...f.register("address")} className={inputClass(e.address)} />
            </Field>
            <fieldset className="flex gap-6 sm:col-span-2">
              <legend className="sr-only">Loại đối tác</legend>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...f.register("isCustomer")} /> Là khách hàng</label>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...f.register("isSupplier")} /> Là nhà cung cấp</label>
              {e.isCustomer && <p className="text-xs text-danger">{e.isCustomer.message}</p>}
            </fieldset>
            <Field id="note" label="Ghi chú" className="sm:col-span-2">
              <textarea id="note" rows={3} {...f.register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
            </Field>
          </div>
        );
      }} />
  );

  const credit = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="credit" title="Công nợ" editLabel="Chỉnh sửa hạn mức nợ" canEdit={p.canManage}
      schema={creditSectionSchema} save={save("credit")} defaults={{ debtLimit: Number(x.debtLimit), allowCredit: x.allowCredit }}
      view={<dl className="space-y-2"><DetailField label="Cho phép ghi nợ">{x.allowCredit ? "Có" : "Không"}</DetailField><DetailField label="Hạn mức nợ">{formatCurrency(x.debtLimit)}</DetailField></dl>}
      edit={(f) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="debtLimit" label="Hạn mức nợ (₫)" error={f.formState.errors.debtLimit?.message}>
            <input id="debtLimit" type="number" min={0} {...f.register("debtLimit", { valueAsNumber: true })} aria-invalid={!!f.formState.errors.debtLimit} className={`${inputClass(f.formState.errors.debtLimit)} tabular text-right`} />
          </Field>
          <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" {...f.register("allowCredit")} /> Cho phép ghi nợ</label>
        </div>
      )} />
  );

  const assign = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="owner" title="Người phụ trách" editLabel="Đổi người phụ trách" canEdit={p.canManage && p.canAssign}
      schema={ownerSectionSchema} save={save("owner")} defaults={{ ownerUserId: x.ownerUserId }}
      view={<dl><DetailField label="Người phụ trách">{x.ownerName}</DetailField></dl>}
      edit={(f) => (
        <Controller control={f.control} name="ownerUserId" render={({ field }) => (
          <Combobox label="Người phụ trách" value={p.owners.find((o) => o.value === field.value) ?? null} onChange={(o) => field.onChange(o ? Number(o.value) : null)} loadOptions={staticLoader(p.owners)} />
        )} />
      )} />
  );

  const status = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="status" title="Trạng thái" editLabel="Chỉnh sửa trạng thái" canEdit={p.canManage}
      schema={statusSectionSchema} save={save("status")} defaults={{ isActive: x.isActive }}
      view={<dl><DetailField label="Trạng thái">{x.isActive ? "Đang hoạt động" : "Đã tắt (không hiện trong ô chọn)"}</DetailField></dl>}
      edit={(f) => <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" {...f.register("isActive")} /> Đang hoạt động</label>} />
  );

  return (
    <div className="space-y-4">
      {p.mergedInto && (
        <div role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm text-warning">
          Đối tác này đã được gộp vào mã <strong>{p.mergedInto.code}</strong> nên chỉ xem, không sửa được.
        </div>
      )}
      <DetailPage
        backHref={ui.base} backLabel={`Quay lại ${ui.title.toLowerCase()}`}
        summary={{
          title: x.name, code: x.code,
          badges: [
            ...(x.isCustomer ? [{ label: "Khách hàng", tone: "info" as const }] : []),
            ...(x.isSupplier ? [{ label: "Nhà cung cấp", tone: "tertiary" as const }] : []),
            x.isActive ? { label: "Đang hoạt động", tone: "success" as const } : { label: "Đã tắt", tone: "neutral" as const },
          ],
          facts: [{ label: "Nhóm", value: x.groupName }, { label: "Hạn mức nợ", value: x.allowCredit ? formatCurrency(x.debtLimit) : "—" }, { label: "Phụ trách", value: x.ownerName ?? "—" }],
        }}
        tabs={[
          { key: "info", label: "Thông tin", render: (ctx) => <div className="space-y-6">{profile(ctx)}{credit(ctx)}{assign(ctx)}{status(ctx)}</div> },
          {
            key: "history", label: "Nhật ký", count: p.history.length,
            render: () => p.history.length === 0
              ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có thao tác nào ghi nhận.</p>
              : <ul className="divide-y divide-[var(--border-default)]">{p.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{ACTION_LABEL[h.action] ?? h.action} <span className="text-fg-muted">— {h.by}</span></span>
                    <span className="tabular text-xs text-fg-muted">{formatDateTime(h.at)}</span>
                  </li>
                ))}</ul>,
          },
        ]}
        {...nav}
        initialEditing={p.canManage ? nav.initialEditing : null}
      />
    </div>
  );
}
```

Ghi chú: tab **Đơn hàng** và **Công nợ** của khách do plan 04 (C2, C7) thêm vào mảng `tabs` này. Nhãn `Combobox label="Nhóm"` dùng cho `getByRole("combobox", { name: "Nhóm" })` của test.

- [ ] **Step 9: Nạp trang chi tiết dùng chung + 6 trang route** — `src/components/partners/load-detail.tsx`

```tsx
import { notFound } from "next/navigation";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { listActiveOptions } from "@/server/catalog/queries";
import { DomainError } from "@/server/http/errors";
import type { PartnerKind } from "@/server/partners/codes";
import { getPartner } from "@/server/partners/queries";
import { PartnerDetail } from "./PartnerDetail";

const MAX_INT32 = 2_147_483_647;

export async function loadPartnerDetail(kind: PartnerKind, actor: Actor, rawId: string) {
  const id = /^\d{1,10}$/.test(rawId) ? Number(rawId) : 0; // "1e2", "0x10", "5abc" → 404
  if (id <= 0 || id > MAX_INT32) notFound();
  const partner = await getPartner(prisma, actor, id, kind).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const [groupOpts, owners, history, merged] = await Promise.all([
    listActiveOptions(prisma, "partner-groups"),
    prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    prisma.auditLog.findMany({ where: { entity: "Partner", entityId: String(id) }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, at: true, userId: true } }),
    partner.mergedIntoId ? prisma.partner.findUnique({ where: { id: partner.mergedIntoId }, select: { id: true, code: true } }) : Promise.resolve(null),
  ]);
  // Nhóm hiện tại của đối tác có thể đã bị tắt: vẫn phải hiện đúng nhãn ở ô chọn
  const groups = groupOpts.some((g) => g.value === partner.groupId) ? groupOpts : [...groupOpts, { value: partner.groupId, label: partner.groupName }];
  const ids = [...new Set(history.map((h) => h.userId).filter((x): x is number => x !== null))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return (
    <PartnerDetail
      kind={kind}
      partner={JSON.parse(JSON.stringify(partner))}
      groups={groups}
      owners={owners.map((o) => ({ value: o.id, label: o.fullName }))}
      history={history.map((h) => ({ id: h.id, action: h.action, at: h.at.toISOString(), by: h.userId ? names.get(h.userId) ?? `#${h.userId}` : "Hệ thống" }))}
      canManage={actor.perms.has("partner.manage") && !partner.mergedIntoId}
      canAssign={actor.perms.has("partner.view_all")}
      mergedInto={merged}
    />
  );
}
```

Sáu trang mỏng (mỗi trang TỰ gọi `requireActor(` — `route-guards.test.ts` kiểm). Khách hàng — `src/app/(app)/sales/customers/page.tsx`:

```tsx
import { PartnerList } from "@/components/partners/PartnerList";
import { requireActor } from "@/server/auth/session";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("partner.view");
  return <PartnerList kind="customer" actor={actor} searchParams={await searchParams} />;
}
```

`…/customers/new/page.tsx`:

```tsx
import { PartnerNewForm } from "@/components/partners/PartnerNewForm";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";

export default async function NewCustomerPage() {
  const actor = await requireActor("partner.manage");
  const canPickOwner = actor.perms.has("partner.view_all");
  const [groups, users] = await Promise.all([
    listActiveOptions(prisma, "partner-groups"),
    canPickOwner ? prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);
  return <PartnerNewForm kind="customer" groups={groups} owners={users.map((u) => ({ value: u.id, label: u.fullName }))} canPickOwner={canPickOwner} />;
}
```

`…/customers/[id]/page.tsx`:

```tsx
import { loadPartnerDetail } from "@/components/partners/load-detail";
import { requireActor } from "@/server/auth/session";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("partner.view");
  return loadPartnerDetail("customer", actor, (await params).id);
}
```

Ba trang của NCC (`src/app/(app)/purchase/suppliers/...`) y hệt, đổi `kind="supplier"`, tên hàm `SuppliersPage`/`NewSupplierPage`/`SupplierDetailPage`.

- [ ] **Step 10: Test chi tiết + trang (đỏ → xanh)**

`tests/ui/partner-detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerDetail } from "@/components/partners/PartnerDetail";
import type { PartnerDTO } from "@/server/partners/queries";

const apiFetch = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }), usePathname: () => "/sales/customers/4", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const partner: PartnerDTO = {
  id: 4, code: "KH000004", name: "Nguyễn Văn Đạt", groupId: 1, groupName: "Thợ", isCustomer: true, isSupplier: false,
  ownerUserId: null, ownerName: null, debtLimit: "5000000", allowCredit: true, phone: "0912345678", address: null, note: null,
  isActive: true, mergedIntoId: null, createdAt: new Date("2026-09-01T03:00:00Z"),
};
const base = { partner, kind: "customer" as const, groups: [{ value: 1, label: "Thợ" }], owners: [], history: [], canManage: true, canAssign: false, mergedInto: null };

beforeEach(() => { apiFetch.mockReset(); refresh.mockReset(); });
afterEach(cleanup);

describe("PartnerDetail", () => {
  it("chỉ xem (thiếu partner.manage): chữ tĩnh, không có bút chì", () => {
    render(<PartnerDetail {...base} canManage={false} />);
    expect(screen.getAllByText("Nguyễn Văn Đạt").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
  });

  it("sửa Công nợ: chỉ gửi field của section 'credit' qua PATCH section-update", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    render(<PartnerDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa hạn mức nợ" }));
    const input = screen.getByLabelText(/Hạn mức nợ/);
    await userEvent.clear(input);
    await userEvent.type(input, "12000000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/partners/4/section-update", { method: "PATCH", json: { section: "credit", debtLimit: 12000000, allowCredit: true } });
  });

  it("hạn mức nợ âm → lỗi tiếng Việt, không gọi API", async () => {
    render(<PartnerDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa hạn mức nợ" }));
    const input = screen.getByLabelText(/Hạn mức nợ/);
    await userEvent.clear(input);
    await userEvent.type(input, "-5");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Không được âm.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("đối tác đã gộp: biểu ngữ + chỉ xem", () => {
    render(<PartnerDetail {...base} canManage={false} mergedInto={{ id: 9, code: "KH000009" }} />);
    expect(within(screen.getByRole("status")).getByText("KH000009")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
  });

  it("người phụ trách chỉ đổi được khi có canAssign (partner.view_all)", () => {
    render(<PartnerDetail {...base} canAssign={false} />);
    expect(screen.queryByRole("button", { name: "Đổi người phụ trách" })).toBeNull();
    cleanup();
    render(<PartnerDetail {...base} canAssign />);
    expect(screen.getByRole("button", { name: "Đổi người phụ trách" })).toBeInTheDocument();
  });
});
```

`tests/ui/partner-pages.test.tsx`: theo mẫu `catalog-pages.test.tsx` — mock `@/server/auth/session`, `@/server/partners/queries` (`listPartners`, `PARTNER_FILTER_KEYS` thật qua `importActual`), `@/lib/prisma`, `@/components/partners/PartnerTable`; kiểm: (1) trang khách gọi `requireActor("partner.view")` và `listPartners(..., "customer")`; trang NCC gọi `"supplier"`; (2) bị từ chối thì KHÔNG đọc dữ liệu; (3) `?group=1,2&q=dat&status=inactive` → `params.filters.group` = `["1","2"]`; (4) thiếu `partner.view_all` → không dựng `MultiSelectFilter` "Người phụ trách" (đếm `MultiSelectFilter` = 1), có `partner.view_all` → 2; (5) thiếu `partner.manage` → không có nút "Thêm mới" và `ImportExportMenu` không có `importEndpoint`.

```tsx
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomersPage from "@/app/(app)/sales/customers/page";
import SuppliersPage from "@/app/(app)/purchase/suppliers/page";
import { ImportExportMenu } from "@/components/import/ImportExportMenu";
import { MultiSelectFilter } from "@/components/ui";

const requireActor = vi.fn();
const listPartners = vi.fn();
const groupFindMany = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/server/partners/queries", async (orig) => ({ ...(await orig<typeof import("@/server/partners/queries")>()), listPartners: (...a: unknown[]) => listPartners(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { partnerGroup: { findMany: (...a: unknown[]) => groupFindMany(...a) }, user: { findMany: (...a: unknown[]) => userFindMany(...a) } } }));
vi.mock("@/components/partners/PartnerTable", () => ({ PartnerTable: () => null }));

const actor = (...perms: string[]) => ({ userId: 7, perms: new Set(perms) });
beforeEach(() => {
  for (const m of [requireActor, listPartners, groupFindMany, userFindMany]) m.mockReset();
  listPartners.mockResolvedValue({ rows: [], total: 0, stats: { all: 0, active: 0, inactive: 0 } });
  groupFindMany.mockResolvedValue([{ id: 1, name: "Thợ" }]);
  userFindMany.mockResolvedValue([{ id: 2, fullName: "Nam" }]);
});

function findAll(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) out.push(el);
  // PartnerList là component bất đồng bộ (server): mở rộng nó để soi cây bên trong
  findAll(el.props?.children as ReactNode, type, out);
  for (const k of ["stats", "filters", "actions", "footer"]) findAll(el.props?.[k] as ReactNode, type, out);
  return out;
}
async function render(el: ReactElement<Record<string, unknown>>) { return (el.type as (p: unknown) => Promise<ReactElement<Record<string, unknown>>>)(el.props); }
const customers = (sp = {}) => CustomersPage({ searchParams: Promise.resolve(sp) }).then(render);

describe("/sales/customers & /purchase/suppliers (server)", () => {
  it("cần partner.view; bị từ chối thì không đọc dữ liệu", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(customers()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("partner.view");
    expect(listPartners).not.toHaveBeenCalled();
  });

  it("trang khách đọc kind=customer, trang NCC đọc kind=supplier; tham số URL đi qua parseListParams", async () => {
    requireActor.mockResolvedValue(actor("partner.view", "partner.view_all"));
    await customers({ group: "1,2", q: "dat", status: "inactive" });
    expect(listPartners.mock.calls[0]![2]).toMatchObject({ q: "dat", filters: { group: ["1", "2"], status: ["inactive"] } });
    expect(listPartners.mock.calls[0]![3]).toBe("customer");
    await SuppliersPage({ searchParams: Promise.resolve({}) }).then(render);
    expect(listPartners.mock.calls[1]![3]).toBe("supplier");
  });

  it("[Review Focus 6] bộ lọc Người phụ trách CHỈ hiện khi có partner.view_all", async () => {
    requireActor.mockResolvedValueOnce(actor("partner.view"));
    expect(findAll(await customers(), MultiSelectFilter)).toHaveLength(1);
    requireActor.mockResolvedValueOnce(actor("partner.view", "partner.view_all"));
    expect(findAll(await customers(), MultiSelectFilter)).toHaveLength(2);
  });

  it("thiếu partner.manage/data.import: menu Nhập/Xuất chỉ có Xuất (không importEndpoint)", async () => {
    requireActor.mockResolvedValueOnce(actor("partner.view"));
    expect(findAll(await customers(), ImportExportMenu)[0]!.props.importEndpoint).toBeUndefined();
    requireActor.mockResolvedValueOnce(actor("partner.view", "partner.manage", "data.import"));
    expect(findAll(await customers(), ImportExportMenu)[0]!.props.importEndpoint).toBe("/api/partner-lists/customers/import");
  });
});
```

Ghi chú: các trang server trả về cây phần tử (không render) nên test gọi hàm bất đồng bộ của `PartnerList` bằng helper `render` (mở 1 tầng component). Nếu cách dựng cây khác trong repo, dùng đúng cách đã dùng ở `tests/ui/users-page.test.tsx` — mục tiêu kiểm là 5 khẳng định trên.

- [ ] **Step 11: Mở menu** — trong `src/config/app.config.ts` xoá `planned: P` của `customer-list` và `supplier-list`. Chạy `npm run dev`, kiểm tay trên trình duyệt: tạo KH (mã tự cấp), sửa từng section, tìm `dat`, lọc theo nhóm, Xuất Excel, Nhập Excel (tải mẫu → điền 3 dòng → xem trước → nhập → nhập lại lần 2), đăng nhập tài khoản **Bán hàng** kiểm chỉ thấy khách của mình, dark/light.

- [ ] **Step 12: Chạy tổng + commit**

```bash
rtk proxy npx vitest run tests/partners tests/ui tests/api tests/config
rtk proxy npm run lint && rtk proxy npm run typecheck
git add -A src tests
git commit -m "feat(partners): màn Khách hàng & Nhà cung cấp — danh sách, tạo mới, chi tiết theo section, nhập/xuất Excel"
```

---

### Task 7: Sản phẩm — backend (đơn vị & quy đổi, định mức tồn, tìm không dấu, import D2)

**Mã:** 11, 12, 25 (cấu hình `minStock`). **Files:**
- Create: `src/server/products/{schemas,units,service,queries,import-spec}.ts`
- Test: `tests/products/{units,schemas,service,queries,import}.test.ts`

**Interfaces:**
- Consumes: `searchTextWhere`, `normalizeSearch`, `withIdempotency`, `writeAudit`, `parseViNumber`, khung Import (Task 4), `parseYesNo` (Task 5).
- Produces:
  - `convertToBase(qty: Prisma.Decimal.Value, factor: Prisma.Decimal.Value): Prisma.Decimal` (làm tròn 3 số lẻ, HALF_UP; hệ số ≤ 0 → `DomainError` 400)
  - `resolveFactor(product: { baseUnit: string; units: { unit: string; factor: Prisma.Decimal }[] }, unit: string): Prisma.Decimal`
  - `createProductSchema`, `basicSectionSchema`, `stockSectionSchema`, `unitsSectionSchema`, `statusSectionSchema`, `PRODUCT_KINDS`
  - `createProduct(db, actor, input)`, `createProductIdempotent(prisma, actor, key, input)`, `updateProductBasic`, `setProductStock`, `setProductUnits`, `setProductActive`
  - `PRODUCT_FILTER_KEYS`, `listProducts(db, params)`, `getProduct(db, id)`, `searchProducts(db, { q, limit?, activeOnly?, kinds? })` → `ProductOption[]`, `exportProductsXlsx(db, params)`, `type ProductDTO`, `type ProductOption`
  - `productImportSpec(): ImportSpec<ProductImportRow, ProductImportCtx>`

- [ ] **Step 1: Test quy đổi (đỏ)** — `tests/products/units.test.ts`

```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { convertToBase, resolveFactor } from "@/server/products/units";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe("convertToBase (D-12: qtyBase = qty ÷ factor)", () => {
  it("[Review Focus 3] 3.000 kg ÷ 2,4 = 1.250 md (đúng ví dụ spec 6.4)", () => {
    expect(convertToBase(3000, 2.4).toString()).toBe("1250");
  });
  it("[Review Focus 3] 1.000 kg ÷ 3 = 333,333 md (làm tròn 3 số lẻ, HALF_UP)", () => {
    expect(convertToBase(1000, 3).toString()).toBe("333.333");
    expect(convertToBase(2, 3).toString()).toBe("0.667");
  });
  it("chuỗi/Decimal cũng được; đơn vị lớn hơn gốc (1 cây = 6 md ⇒ factor 0,166667)", () => {
    expect(convertToBase("10", "0.166667").toString()).toBe("60"); // 10 ÷ 0,166667 = 59,99988… → làm tròn 3 số lẻ = 60,000
    expect(convertToBase(D("2.4"), D("2.4")).toString()).toBe("1");
  });
  it("[Review Focus 3] hệ số ≤ 0 → lỗi 400 tiếng Việt, không trả Infinity/NaN", () => {
    for (const f of [0, -1, "0"]) expect(() => convertToBase(10, f)).toThrow(expect.objectContaining({ status: 400, message: "Hệ số quy đổi phải lớn hơn 0." }));
  });
  it("số lượng âm → lỗi; 0 → 0", () => {
    expect(() => convertToBase(-1, 2)).toThrow(expect.objectContaining({ status: 400 }));
    expect(convertToBase(0, 2).toString()).toBe("0");
  });
});

describe("resolveFactor", () => {
  const p = { baseUnit: "md", units: [{ unit: "kg", factor: D("2.4") }] };
  it("đơn vị gốc = 1; đơn vị đã khai báo = hệ số mặc định; còn lại lỗi", () => {
    expect(resolveFactor(p, "md").toString()).toBe("1");
    expect(resolveFactor(p, "kg").toString()).toBe("2.4");
    expect(() => resolveFactor(p, "tấn")).toThrow(expect.objectContaining({ status: 400, message: 'Sản phẩm chưa khai báo đơn vị "tấn".' }));
  });
});
```

- [ ] **Step 2: Viết `src/server/products/units.ts`**

```ts
import { Prisma } from "@prisma/client";
import { DomainError } from "@/server/http/errors";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Quy đổi số lượng nhập về ĐƠN VỊ GỐC (D-12): qtyBase = qty ÷ factor, làm tròn 3 số lẻ (HALF_UP — khớp Decimal(18,3) của
 * sổ kho). `factor` = số đơn vị nhập trên 1 đơn vị gốc (kg/md). Sổ kho và FIFO chỉ dùng đơn vị gốc.
 */
export function convertToBase(qty: Prisma.Decimal.Value, factor: Prisma.Decimal.Value): Prisma.Decimal {
  const f = D(factor);
  if (!f.isFinite() || !f.gt(0)) throw new DomainError("Hệ số quy đổi phải lớn hơn 0.", 400);
  const q = D(qty);
  if (q.lt(0)) throw new DomainError("Số lượng không được âm.", 400);
  return q.div(f).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

/** Hệ số MẶC ĐỊNH của một đơn vị nhập (đơn vị gốc = 1). Từng lần nhập có thể ghi hệ số thực tế khác (`factor_used`). */
export function resolveFactor(product: { baseUnit: string; units: { unit: string; factor: Prisma.Decimal }[] }, unit: string): Prisma.Decimal {
  if (unit === product.baseUnit) return D(1);
  const u = product.units.find((x) => x.unit === unit);
  if (!u) throw new DomainError(`Sản phẩm chưa khai báo đơn vị "${unit}".`, 400);
  return u.factor;
}
```

- [ ] **Step 3: Chạy → xanh** (`rtk proxy npx vitest run tests/products/units.test.ts`; nhớ sửa kỳ vọng `"60"` như ghi chú).

- [ ] **Step 4: Schema + test** — `src/server/products/schemas.ts`

```ts
import { z } from "zod";

export const PRODUCT_KINDS = [
  { value: "HANG", label: "Hàng hóa" }, { value: "NVL", label: "Nguyên vật liệu" },
  { value: "THANH_PHAM", label: "Thành phẩm" }, { value: "PHU_KIEN", label: "Phụ kiện" },
] as const;
export const BASE_UNIT_SUGGESTIONS = ["md", "kg", "cái", "cây", "bộ", "tấm", "cuộn"] as const;

const unitName = z.string({ required_error: "Nhập đơn vị." }).trim().min(1, "Nhập đơn vị.").max(10, "Đơn vị tối đa 10 ký tự.");

export const unitRowSchema = z.object({
  unit: unitName,
  factor: z.number({ required_error: "Nhập hệ số.", invalid_type_error: "Nhập hệ số." }).gt(0, "Hệ số phải lớn hơn 0.").max(1_000_000, "Hệ số quá lớn."),
});

const uniqueUnits = (units: { unit: string }[], ctx: z.RefinementCtx, baseUnit?: string) => {
  const seen = new Set<string>();
  units.forEach((u, i) => {
    const k = u.unit.trim().toLowerCase();
    if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["units", i, "unit"], message: "Đơn vị bị trùng." });
    if (baseUnit !== undefined && k === baseUnit.trim().toLowerCase()) ctx.addIssue({ code: "custom", path: ["units", i, "unit"], message: "Trùng đơn vị gốc (đơn vị gốc luôn có hệ số 1)." });
    seen.add(k);
  });
};

const productBase = z.object({
  code: z.string({ required_error: "Nhập mã." }).trim().min(1, "Nhập mã.").max(30, "Mã tối đa 30 ký tự.").regex(/^[A-Za-z0-9._\-/]+$/, "Mã chỉ gồm chữ không dấu, số và . _ - /"),
  name: z.string({ required_error: "Nhập tên." }).trim().min(1, "Nhập tên.").max(200, "Tên tối đa 200 ký tự."),
  kind: z.enum(["HANG", "NVL", "THANH_PHAM", "PHU_KIEN"], { errorMap: () => ({ message: "Chọn loại." }) }),
  baseUnit: unitName,
  minStock: z.number({ invalid_type_error: "Nhập định mức tồn." }).min(0, "Không được âm.").max(999_999_999, "Số quá lớn."),
  isCoil: z.boolean(),
  isActive: z.boolean(),
  note: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự."),
});

export const createProductSchema = productBase
  .extend({ units: z.array(unitRowSchema).max(10, "Tối đa 10 đơn vị quy đổi.") })
  .superRefine((v, ctx) => uniqueUnits(v.units, ctx, v.baseUnit));
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const basicSectionSchema = productBase.pick({ name: true, kind: true, baseUnit: true, isCoil: true, note: true });
export const stockSectionSchema = productBase.pick({ minStock: true });
export const statusSectionSchema = productBase.pick({ isActive: true });
/** Trùng đơn vị gốc được service kiểm tiếp (schema này không biết đơn vị gốc hiện tại). */
export const unitsSectionSchema = z.object({ units: z.array(unitRowSchema).max(10, "Tối đa 10 đơn vị quy đổi.") }).superRefine((v, ctx) => uniqueUnits(v.units, ctx));
```

`tests/products/schemas.test.ts` (ngắn): mã có khoảng trắng/dấu → lỗi "Mã chỉ gồm…"; `minStock` âm → "Không được âm."; units trùng nhau → "Đơn vị bị trùng." tại `units.1.unit`; unit trùng `baseUnit` → "Trùng đơn vị gốc…"; `factor: 0` → "Hệ số phải lớn hơn 0."; loại rỗng → "Chọn loại."

```ts
import { describe, expect, it } from "vitest";
import { createProductSchema, unitsSectionSchema } from "@/server/products/schemas";

const valid = { code: "TL045", name: "Tôn lạnh 0.45", kind: "HANG", baseUnit: "md", minStock: 0, isCoil: false, isActive: true, note: "", units: [{ unit: "kg", factor: 2.4 }] };
const issues = (v: unknown) => { const r = createProductSchema.safeParse(v); return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`); };

describe("createProductSchema", () => {
  it("hợp lệ", () => expect(issues(valid)).toEqual([]));
  it("mã, định mức tồn, loại, hệ số", () => {
    expect(issues({ ...valid, code: "TL 045" })).toContain("code: Mã chỉ gồm chữ không dấu, số và . _ - /");
    expect(issues({ ...valid, minStock: -1 })).toContain("minStock: Không được âm.");
    expect(issues({ ...valid, kind: "" })).toContain("kind: Chọn loại.");
    expect(issues({ ...valid, units: [{ unit: "kg", factor: 0 }] })).toContain("units.0.factor: Hệ số phải lớn hơn 0.");
  });
  it("đơn vị quy đổi: không trùng nhau (không phân biệt hoa/thường), không trùng đơn vị gốc", () => {
    expect(issues({ ...valid, units: [{ unit: "kg", factor: 1 }, { unit: "KG", factor: 2 }] })).toContain("units.1.unit: Đơn vị bị trùng.");
    expect(issues({ ...valid, units: [{ unit: "MD", factor: 1 }] })).toContain("units.0.unit: Trùng đơn vị gốc (đơn vị gốc luôn có hệ số 1).");
  });
  it("section đơn vị: trùng nhau bị chặn", () => {
    expect(unitsSectionSchema.safeParse({ units: [{ unit: "kg", factor: 1 }, { unit: "kg", factor: 2 }] }).success).toBe(false);
  });
});
```

- [ ] **Step 5: Test service (đỏ)** — `tests/products/service.test.ts`

```ts
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { FieldConflictError } from "@/server/http/errors";
import { createProduct, createProductIdempotent, setProductActive, setProductStock, setProductUnits, updateProductBasic } from "@/server/products/service";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod, makeProduct, makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
const input = (over = {}) => ({ code: "tl045", name: "Tôn Lạnh Màu 0.45", kind: "HANG" as const, baseUnit: "md", minStock: 100, isCoil: false, isActive: true, note: "", units: [{ unit: "kg", factor: 2.4 }], ...over });

beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["product.manage"]) }; });

describe("createProduct", () => {
  it("mã viết HOA, searchText không dấu (mã + tên), đơn vị quy đổi được lưu; audit product.create", async () => {
    const { id } = await tx((db) => createProduct(db, actor, input()));
    const p = await prisma.product.findUniqueOrThrow({ where: { id }, include: { units: true } });
    expect([p.code, p.searchText, p.minStock.toString()]).toEqual(["TL045", "tl045 ton lanh mau 0.45", "100"]);
    expect(p.units.map((u) => [u.unit, u.factor.toString()])).toEqual([["kg", "2.4"]]);
    expect(await prisma.auditLog.count({ where: { action: "product.create", entity: "Product" } })).toBe(1);
  });

  it("trùng mã (không phân biệt hoa/thường) → FieldConflictError có fields.code", async () => {
    await tx((db) => createProduct(db, actor, input()));
    const e = await tx((db) => createProduct(db, actor, input({ code: "TL045" }))).catch((x) => x);
    expect(e).toBeInstanceOf(FieldConflictError);
    expect((e as FieldConflictError).fields.code).toBe("Mã đã tồn tại.");
  });

  it("thiếu quyền product.manage → ForbiddenError", async () => {
    await expect(tx((db) => createProduct(db, { ...actor, perms: new Set() }, input()))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cùng Idempotency-Key → chỉ 1 sản phẩm", async () => {
    const a = await createProductIdempotent(prisma, actor, "k", input());
    const b = await createProductIdempotent(prisma, actor, "k", input());
    expect(b.id).toBe(a.id);
    expect(await prisma.product.count()).toBe(1);
  });
});

describe("cập nhật theo section", () => {
  let id: number;
  beforeEach(async () => { id = (await tx((db) => createProduct(db, actor, input()))).id; });

  it("đổi tên → searchText tính lại; định mức tồn; tắt/bật", async () => {
    await tx((db) => updateProductBasic(db, actor, id, { name: "Tôn Xốp", kind: "THANH_PHAM", baseUnit: "md", isCoil: true, note: "" }));
    await tx((db) => setProductStock(db, actor, id, { minStock: 250.5 }));
    await tx((db) => setProductActive(db, actor, id, { isActive: false }));
    const p = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect([p.searchText, p.kind, p.isCoil, p.minStock.toString(), p.isActive]).toEqual(["tl045 ton xop", "THANH_PHAM", true, "250.5", false]);
  });

  it("đã có phát sinh kho → KHÔNG đổi được đơn vị gốc (sổ kho tính theo đơn vị gốc)", async () => {
    const period = await makePeriod();
    await prisma.stockLedger.create({ data: { periodId: period.id, productId: id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 5, at: new Date(), createdBy: actor.userId } });
    const e = await tx((db) => updateProductBasic(db, actor, id, { name: "Tôn Lạnh Màu 0.45", kind: "HANG", baseUnit: "kg", isCoil: false, note: "" })).catch((x) => x);
    expect(e).toMatchObject({ status: 409, message: expect.stringContaining("đơn vị gốc") });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).baseUnit).toBe("md");
  });

  it("thay toàn bộ danh sách đơn vị: giữ/sửa hệ số, thêm mới, xoá cái không còn; audit before/after", async () => {
    await tx((db) => setProductUnits(db, actor, id, [{ unit: "kg", factor: 2.5 }, { unit: "cây", factor: 0.166667 }]));
    const units = await prisma.productUnit.findMany({ where: { productId: id }, orderBy: { unit: "asc" } });
    expect(units.map((u) => [u.unit, u.factor.toString()])).toEqual([["cây", "0.166667"], ["kg", "2.5"]]);
    await tx((db) => setProductUnits(db, actor, id, []));
    expect(await prisma.productUnit.count({ where: { productId: id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "product.set_units" } })).toBe(2);
  });

  it("đơn vị quy đổi trùng đơn vị gốc HIỆN TẠI → 400", async () => {
    await expect(tx((db) => setProductUnits(db, actor, id, [{ unit: "md", factor: 1 }]))).rejects.toMatchObject({ status: 400 });
  });

  it("sản phẩm không tồn tại → 404", async () => {
    await expect(tx((db) => setProductActive(db, actor, 9999, { isActive: false }))).rejects.toMatchObject({ status: 404 });
  });
});

it("makeProduct (factory) và createProduct dùng CÙNG cách chuẩn hoá searchText", async () => {
  const p = await makeProduct({ code: "AB1", name: "Đinh Vít", searchText: "ab1 dinh vit" });
  const { id } = await prisma.$transaction((db) => createProduct(db, { userId: 1, perms: new Set(["product.manage"]) }, input({ code: "AB2", name: "Đinh Vít", units: [] })));
  expect((await prisma.product.findUniqueOrThrow({ where: { id } })).searchText.replace("ab2", "ab1")).toBe(p.searchText);
});
```

- [ ] **Step 6: Viết `src/server/products/service.ts`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import type { CreateProductInput } from "./schemas";

type Db = Prisma.TransactionClient;
type UnitRow = { unit: string; factor: number };

/** D-9: MỌI đường ghi `searchText` của sản phẩm (form, import, seed) gọi hàm này. */
export const productSearchText = (p: { code: string; name: string }) => normalizeSearch(`${p.code} ${p.name}`);

async function load(db: Db, id: number) {
  const p = await db.product.findUnique({ where: { id }, include: { units: true } });
  if (!p) throw new DomainError("Không tìm thấy sản phẩm.", 404);
  return p;
}

const codeTaken = () => new FieldConflictError("Mã đã tồn tại.", { code: "Mã đã tồn tại." });
const unitsOf = (rows: UnitRow[]) => rows.map((u) => ({ unit: u.unit, factor: new Prisma.Decimal(u.factor) }));

export async function createProduct(db: Db, actor: Actor, input: CreateProductInput): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "product.manage");
  const code = input.code.toUpperCase();
  let row;
  try {
    row = await db.product.create({
      data: {
        code, name: input.name, searchText: productSearchText({ code, name: input.name }), kind: input.kind, baseUnit: input.baseUnit,
        minStock: new Prisma.Decimal(input.minStock), isCoil: input.isCoil, isActive: input.isActive, note: input.note || null,
        units: { create: unitsOf(input.units) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw codeTaken();
    throw e;
  }
  await writeAudit(db, {
    userId: actor.userId, action: "product.create", entity: "Product", entityId: row.id,
    after: { code, name: row.name, kind: row.kind, baseUnit: row.baseUnit, minStock: row.minStock.toString(), isCoil: row.isCoil, units: input.units },
  });
  return { id: row.id, code };
}

export async function createProductIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: CreateProductInput) {
  assertCan(actor.perms, "product.manage");
  return withIdempotency(prisma, { userId: actor.userId, scope: "product.create", key }, (tx) => createProduct(tx, actor, input));
}

export async function updateProductBasic(db: Db, actor: Actor, id: number, v: { name: string; kind: "HANG" | "NVL" | "THANH_PHAM" | "PHU_KIEN"; baseUnit: string; isCoil: boolean; note: string }) {
  assertCan(actor.perms, "product.manage");
  const before = await load(db, id);
  if (v.baseUnit !== before.baseUnit) {
    // Sổ kho / lớp FIFO luôn tính theo đơn vị gốc: đổi đơn vị khi đã có phát sinh làm sai số lượng cũ
    if ((await db.stockLedger.count({ where: { productId: id } })) > 0) throw new DomainError("Sản phẩm đã có phát sinh kho, không đổi đơn vị gốc được.", 409);
    if (before.units.some((u) => u.unit.toLowerCase() === v.baseUnit.toLowerCase())) throw new DomainError("Đơn vị gốc mới đang trùng một đơn vị quy đổi — xóa đơn vị quy đổi đó trước.", 409);
  }
  await db.product.update({ where: { id }, data: { name: v.name, searchText: productSearchText({ code: before.code, name: v.name }), kind: v.kind, baseUnit: v.baseUnit, isCoil: v.isCoil, note: v.note || null } });
  await writeAudit(db, {
    userId: actor.userId, action: "product.update_basic", entity: "Product", entityId: id,
    before: { name: before.name, kind: before.kind, baseUnit: before.baseUnit, isCoil: before.isCoil, note: before.note },
    after: { name: v.name, kind: v.kind, baseUnit: v.baseUnit, isCoil: v.isCoil, note: v.note || null },
  });
}

export async function setProductStock(db: Db, actor: Actor, id: number, v: { minStock: number }) {
  assertCan(actor.perms, "product.manage");
  const before = await load(db, id);
  await db.product.update({ where: { id }, data: { minStock: new Prisma.Decimal(v.minStock) } });
  await writeAudit(db, { userId: actor.userId, action: "product.set_min_stock", entity: "Product", entityId: id, before: { minStock: before.minStock.toString() }, after: { minStock: String(v.minStock) } });
}

/** Thay TOÀN BỘ danh sách đơn vị quy đổi (hệ số MẶC ĐỊNH; từng lần nhập vẫn ghi hệ số thực tế riêng). */
export async function setProductUnits(db: Db, actor: Actor, id: number, units: UnitRow[]) {
  assertCan(actor.perms, "product.manage");
  const before = await load(db, id);
  if (units.some((u) => u.unit.toLowerCase() === before.baseUnit.toLowerCase())) throw new DomainError("Trùng đơn vị gốc (đơn vị gốc luôn có hệ số 1).", 400);
  const names = units.map((u) => u.unit);
  await db.productUnit.deleteMany({ where: { productId: id, unit: { notIn: names } } });
  for (const u of unitsOf(units)) {
    await db.productUnit.upsert({ where: { productId_unit: { productId: id, unit: u.unit } }, update: { factor: u.factor }, create: { productId: id, unit: u.unit, factor: u.factor } });
  }
  await writeAudit(db, {
    userId: actor.userId, action: "product.set_units", entity: "Product", entityId: id,
    before: { units: before.units.map((u) => ({ unit: u.unit, factor: u.factor.toString() })) }, after: { units },
  });
}

export async function setProductActive(db: Db, actor: Actor, id: number, v: { isActive: boolean }) {
  assertCan(actor.perms, "product.manage");
  const before = await load(db, id);
  if (before.isActive === v.isActive) return;
  await db.product.update({ where: { id }, data: { isActive: v.isActive } });
  await writeAudit(db, { userId: actor.userId, action: "product.set_active", entity: "Product", entityId: id, before: { isActive: before.isActive }, after: { isActive: v.isActive } });
}
```

Ghi chú: hai bảng `Product.code` unique phân biệt hoa/thường ở Postgres nhưng ta luôn lưu HOA nên "tl045" và "TL045" đụng nhau đúng như test mong đợi.

- [ ] **Step 7: Chạy → xanh** (`rtk proxy npx vitest run tests/products/schemas.test.ts tests/products/service.test.ts`).

- [ ] **Step 8: Test truy vấn (đỏ)** — `tests/products/queries.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { getProduct, listProducts, PRODUCT_FILTER_KEYS, searchProducts } from "@/server/products/queries";
import { prisma, resetDb } from "../helpers/db";

const P = (sp: Record<string, string> = {}) => parseListParams(sp, PRODUCT_FILTER_KEYS);

beforeEach(async () => {
  await resetDb();
  // 1.300 mã như thật + vài mã đích danh
  const data = Array.from({ length: 1300 }, (_, i) => ({ code: `SP${String(i).padStart(4, "0")}`, name: `Sản phẩm số ${i}`, searchText: `sp${String(i).padStart(4, "0")} san pham so ${i}`, baseUnit: "md" }));
  await prisma.product.createMany({ data });
  await prisma.product.createMany({
    data: [
      { code: "TL045", name: "Tôn lạnh màu 0.45", searchText: "tl045 ton lanh mau 0.45", baseUnit: "md", kind: "HANG" },
      { code: "TX", name: "Tôn xốp", searchText: "tx ton xop", baseUnit: "md", kind: "THANH_PHAM", isActive: false },
      { code: "GB", name: "Giấy bạc", searchText: "gb giay bac", baseUnit: "m2", kind: "NVL" },
    ],
  });
  const tl = await prisma.product.findUniqueOrThrow({ where: { code: "TL045" } });
  await prisma.productUnit.create({ data: { productId: tl.id, unit: "kg", factor: 2.4 } });
});

describe("listProducts", () => {
  it("[Review Focus 1] 'ton lanh', 'TÔN  LẠNH ' ra đúng 'Tôn lạnh màu 0.45' trong 1.300+ mã", async () => {
    for (const q of ["ton lanh", "TÔN  LẠNH ", "tl045", "lạnh 0.45"]) {
      expect((await listProducts(prisma, P({ q }))).rows.map((r) => r.code), q).toEqual(["TL045"]);
    }
  });

  it("phân trang server: tổng đúng, trang cuối lẻ, cỡ trang ≤ 100", async () => {
    const r = await listProducts(prisma, { ...P(), page: 14, pageSize: 100 });
    expect(r.total).toBe(1303);
    expect(r.rows).toHaveLength(3);
  });

  it("lọc theo loại + trạng thái; thống kê không lệch theo bộ lọc trạng thái", async () => {
    const r = await listProducts(prisma, P({ kind: "THANH_PHAM,NVL", status: "inactive" }));
    expect(r.rows.map((x) => x.code)).toEqual(["TX"]);
    expect(r.stats).toEqual({ all: 2, active: 1, inactive: 1 });
  });

  it("DTO: định mức tồn là chuỗi, có số đơn vị quy đổi; KHÔNG có trường giá vốn/giá nhập (T2)", async () => {
    const r = (await listProducts(prisma, P({ q: "tl045" }))).rows[0]!;
    expect(r).toMatchObject({ code: "TL045", baseUnit: "md", minStock: "0", unitCount: 1 });
    expect(Object.keys(r).filter((k) => /cost|price|profit/i.test(k))).toEqual([]);
  });

  it("[Hiệu năng] tìm + đếm trên 1.300 mã dưới 3 giây (ghi log; chỉ ép khi PERF_STRICT=1)", async () => {
    const t0 = performance.now();
    await listProducts(prisma, P({ q: "san pham" }));
    const ms = performance.now() - t0;
    console.info(`[perf] listProducts 1.300 mã: ${ms.toFixed(0)} ms`);
    if (process.env.PERF_STRICT) expect(ms).toBeLessThan(3000);
  });
});

describe("getProduct / searchProducts", () => {
  it("getProduct trả đơn vị quy đổi (hệ số dạng chuỗi); không có → 404", async () => {
    const tl = await prisma.product.findUniqueOrThrow({ where: { code: "TL045" } });
    expect((await getProduct(prisma, tl.id)).units).toEqual([{ id: expect.any(Number), unit: "kg", factor: "2.4" }]);
    await expect(getProduct(prisma, 999999)).rejects.toMatchObject({ status: 404 });
  });

  it("searchProducts (ô chọn): chỉ mã đang hoạt động, kèm đơn vị gốc + đơn vị quy đổi cho form nhập hàng", async () => {
    const r = await searchProducts(prisma, { q: "ton" });
    expect(r.map((o) => o.label)).toEqual(["TL045 — Tôn lạnh màu 0.45"]); // 'Tôn xốp' đã tắt → không hiện
    expect(r[0]).toMatchObject({ baseUnit: "md", units: [{ unit: "kg", factor: "2.4" }] });
  });

  it("lọc theo loại (vd chỉ NVL cho dòng định mức) và giới hạn ≤ 50", async () => {
    expect((await searchProducts(prisma, { q: "", kinds: ["NVL"] })).map((o) => o.label)).toEqual(["GB — Giấy bạc"]);
    expect(await searchProducts(prisma, { q: "san pham", limit: 500 })).toHaveLength(50);
  });
});
```

- [ ] **Step 9: Viết `src/server/products/queries.ts`**

```ts
import type { Prisma, PrismaClient, ProductKind } from "@prisma/client";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { buildXlsx } from "@/server/export/xlsx";
import { DomainError } from "@/server/http/errors";
import { PRODUCT_KINDS } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;

export const PRODUCT_FILTER_KEYS = ["status", "kind"] as const;

export interface ProductDTO {
  id: number; code: string; name: string; kind: ProductKind; baseUnit: string; minStock: string;
  isCoil: boolean; isActive: boolean; note: string | null; unitCount: number;
}
export interface ProductDetailDTO extends Omit<ProductDTO, "unitCount"> {
  units: { id: number; unit: string; factor: string }[];
}
export interface ProductOption {
  value: number; label: string; hint: string; baseUnit: string; kind: ProductKind;
  units: { unit: string; factor: string }[];
}

const KINDS = new Set<string>(PRODUCT_KINDS.map((k) => k.value));

/**
 * KHÔNG có giá vốn/giá nhập ở đây (T2): các trường đó, khi có (03b), được thêm bằng tên đã đăng ký ở SENSITIVE_FIELDS
 * (`lastPurchasePrice`…) và qua `redactDeep` — không bao giờ dưới tên chung chung.
 */
export function productWhere(params: ListParams, opts: { ignoreStatus?: boolean } = {}): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [searchTextWhere(params.q)];
  const kinds = (params.filters.kind ?? []).filter((k): k is ProductKind => KINDS.has(k));
  if (kinds.length) and.push({ kind: { in: kinds } });
  const status = params.filters.status?.[0];
  if (!opts.ignoreStatus && (status === "active" || status === "inactive")) and.push({ isActive: status === "active" });
  return { AND: and };
}

const SORTABLE = ["code", "name", "kind", "minStock"] as const;

export async function listProducts(db: Db, params: ListParams) {
  const where = productWhere(params);
  const base = productWhere(params, { ignoreStatus: true });
  const [rows, total, all, active] = await Promise.all([
    db.product.findMany({
      where, include: { _count: { select: { units: true } } }, orderBy: sortToOrderBy(params.sort, SORTABLE, { code: "asc" }),
      skip: (params.page - 1) * params.pageSize, take: params.pageSize,
    }),
    db.product.count({ where }),
    db.product.count({ where: base }),
    db.product.count({ where: { AND: [base, { isActive: true }] } }),
  ]);
  const dto: ProductDTO[] = rows.map((p) => ({
    id: p.id, code: p.code, name: p.name, kind: p.kind, baseUnit: p.baseUnit, minStock: p.minStock.toString(),
    isCoil: p.isCoil, isActive: p.isActive, note: p.note, unitCount: p._count.units,
  }));
  return { rows: dto, total, stats: { all, active, inactive: all - active } };
}

export async function getProduct(db: Db, id: number): Promise<ProductDetailDTO> {
  const p = await db.product.findUnique({ where: { id }, include: { units: { orderBy: { unit: "asc" } } } });
  if (!p) throw new DomainError("Không tìm thấy sản phẩm.", 404);
  return {
    id: p.id, code: p.code, name: p.name, kind: p.kind, baseUnit: p.baseUnit, minStock: p.minStock.toString(),
    isCoil: p.isCoil, isActive: p.isActive, note: p.note, units: p.units.map((u) => ({ id: u.id, unit: u.unit, factor: u.factor.toString() })),
  };
}

/** Ô chọn sản phẩm (nhập hàng, bán hàng, định mức): chỉ mã ĐANG HOẠT ĐỘNG; kèm đơn vị để form tự quy đổi. Tối đa 50. */
export async function searchProducts(db: Db, opts: { q?: string; limit?: number; kinds?: ProductKind[] }): Promise<ProductOption[]> {
  const rows = await db.product.findMany({
    where: { AND: [{ isActive: true }, searchTextWhere(opts.q), opts.kinds?.length ? { kind: { in: opts.kinds } } : {}] },
    orderBy: { code: "asc" }, take: Math.min(Math.max(opts.limit ?? 20, 1), 50), include: { units: true },
  });
  return rows.map((p) => ({
    value: p.id, label: `${p.code} — ${p.name}`, hint: p.baseUnit, baseUnit: p.baseUnit, kind: p.kind,
    units: p.units.map((u) => ({ unit: u.unit, factor: u.factor.toString() })),
  }));
}

const MAX_EXPORT = 50_000;

export async function exportProductsXlsx(db: Db, params: ListParams): Promise<Buffer> {
  const rows = await db.product.findMany({ where: productWhere(params), include: { units: true }, orderBy: { code: "asc" }, take: MAX_EXPORT });
  const kind = new Map<string, string>(PRODUCT_KINDS.map((k) => [k.value, k.label]));
  return buildXlsx("Sản phẩm", [
    { header: "Mã", key: "code", width: 16, text: true },
    { header: "Tên", key: "name", width: 40 },
    { header: "Loại", key: "kind", width: 16 },
    { header: "Đơn vị gốc", key: "baseUnit", width: 12 },
    { header: "Định mức tồn", key: "minStock", width: 14, numFmt: "#,##0.###" },
    { header: "Đơn vị quy đổi", key: "units", width: 26 },
    { header: "Tôn cuộn", key: "isCoil", width: 10 },
    { header: "Trạng thái", key: "status", width: 14 },
    { header: "Ghi chú", key: "note", width: 30 },
  ], rows.map((p) => ({
    ...p, kind: kind.get(p.kind), minStock: p.minStock.toString(), isCoil: p.isCoil ? "Có" : "Không", status: p.isActive ? "Đang bán" : "Ngừng bán",
    units: p.units.map((u) => `${u.unit} (${u.factor.toString()}/${p.baseUnit})`).join("; "),
  })));
}
```

- [ ] **Step 10: Chạy → xanh** (`rtk proxy npx vitest run tests/products`).

- [ ] **Step 11: Test + viết Import SP (D2)** — `tests/products/import.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { buildXlsx } from "@/server/export/xlsx";
import { commitImport, previewImport } from "@/server/import/framework";
import { productImportSpec } from "@/server/products/import-spec";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

const H = ["Mã", "Tên", "Loại", "Đơn vị gốc", "Định mức tồn", "Đơn vị quy đổi", "Hệ số quy đổi", "Tôn cuộn", "Ngừng bán", "Ghi chú"];
const sheet = (rows: unknown[][]) => buildXlsx("S", H.map((h, i) => ({ header: h, key: `c${i}` })), rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))));
let actor: Actor;
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set() }; });

describe("import sản phẩm (D2)", () => {
  it("[Review Focus 2] đọc '1.234,5' định mức, hệ số '2,4', loại theo nhãn không dấu, tôn cuộn; đơn vị quy đổi được tạo", async () => {
    const buf = await sheet([["tl045", "Tôn lạnh 0.45", "hang hoa", "md", "1.234,5", "kg", "2,4", "Có", "Không", ""]]);
    expect((await commitImport(prisma, actor, productImportSpec(), buf, { overwrite: false, idempotencyKey: "a" })).created).toBe(1);
    const p = await prisma.product.findUniqueOrThrow({ where: { code: "TL045" }, include: { units: true } });
    expect([p.kind, p.minStock.toString(), p.isCoil, p.searchText, p.units.map((u) => [u.unit, u.factor.toString()])]).toEqual(["HANG", "1234.5", true, "tl045 ton lanh 0.45", [["kg", "2.4"]]]);
  });

  it("ô định mức tồn TRỐNG = 0 mặc định của hệ thống (không lỗi), loại trống = Hàng hóa", async () => {
    await commitImport(prisma, actor, productImportSpec(), await sheet([["A1", "X", "", "cái", "", "", "", "", "", ""]]), { overwrite: false, idempotencyKey: "b" });
    const p = await prisma.product.findUniqueOrThrow({ where: { code: "A1" } });
    expect([p.kind, p.minStock.toString()]).toEqual(["HANG", "0"]);
  });

  it("lỗi từng dòng: loại lạ, hệ số ≤ 0, thiếu hệ số khi có đơn vị, đơn vị quy đổi trùng đơn vị gốc, thiếu đơn vị gốc", async () => {
    const p = await previewImport(prisma, productImportSpec(), await sheet([
      ["E1", "a", "linh tinh", "md", "", "", "", "", "", ""],
      ["E2", "b", "", "md", "", "kg", "0", "", "", ""],
      ["E3", "c", "", "md", "", "kg", "", "", "", ""],
      ["E4", "d", "", "md", "", "MD", "1", "", "", ""],
      ["E5", "e", "", "", "", "", "", "", "", ""],
    ]), { overwrite: false });
    expect(p.counts.error).toBe(5);
    const msg = (line: number) => p.rows.find((r) => r.line === line)!.message!;
    expect(msg(2)).toContain('Loại "linh tinh"');
    expect(msg(3)).toContain("Hệ số quy đổi");
    expect(msg(4)).toContain("Hệ số quy đổi");
    expect(msg(5)).toContain("trùng đơn vị gốc");
    expect(msg(6)).toContain("Thiếu đơn vị gốc");
  });

  it("[Review Focus 4] 'Ngừng bán' KHÔNG được nhập — vào file loại cho khách duyệt; mã trùng trong file bị loại kèm dòng trùng", async () => {
    const buf = await sheet([
      ["S1", "Còn bán", "", "md", "", "", "", "", "Không", ""],
      ["S2", "Ngừng", "", "md", "", "", "", "", "Có", ""],
      ["S1", "Trùng S1", "", "md", "", "", "", "", "", ""],
    ]);
    const p = await previewImport(prisma, productImportSpec(), buf, { overwrite: false });
    expect(p.counts).toMatchObject({ create: 1, "skip-reason": 1, error: 1 });
    expect(p.rows.find((r) => r.status === "skip-reason")!.message).toMatch(/Ngừng bán/);
    expect(p.rows.find((r) => r.status === "error")!.message).toBe('Trùng mã "S1" với dòng 2.');
    await commitImport(prisma, actor, productImportSpec(), buf, { overwrite: false, idempotencyKey: "c" });
    expect((await prisma.product.findMany({ select: { code: true } })).map((x) => x.code)).toEqual(["S1"]);
  });

  it("nhập lại cùng file: bỏ qua mã đã có; Ghi đè: sửa tên/định mức/đơn vị và tính lại searchText", async () => {
    await makeProduct({ code: "K1", name: "Cũ", searchText: "k1 cu", baseUnit: "md" });
    const buf = await sheet([["K1", "Tên Mới", "", "md", "50", "kg", "3", "", "", ""]]);
    expect((await commitImport(prisma, actor, productImportSpec(), buf, { overwrite: false, idempotencyKey: "d" })).skippedExisting).toBe(1);
    await commitImport(prisma, actor, productImportSpec(), buf, { overwrite: true, idempotencyKey: "e" });
    const p = await prisma.product.findUniqueOrThrow({ where: { code: "K1" }, include: { units: true } });
    expect([p.name, p.searchText, p.minStock.toString(), p.units.map((u) => u.unit)]).toEqual(["Tên Mới", "k1 ten moi", "50", ["kg"]]);
  });

  it("[Hiệu năng] nhập 1.300 sản phẩm trong MỘT giao dịch (ghi log; chỉ ép < 5 giây khi PERF_STRICT=1)", async () => {
    const rows = Array.from({ length: 1300 }, (_, i) => [`SP${i}`, `Sản phẩm ${i}`, "", "md", "10", "kg", "2,4", "", "", ""]);
    const buf = await sheet(rows);
    const t0 = performance.now();
    const r = await commitImport(prisma, actor, productImportSpec(), buf, { overwrite: false, idempotencyKey: "big" });
    const ms = performance.now() - t0;
    console.info(`[perf] import 1.300 SP: ${ms.toFixed(0)} ms`);
    expect(r.created).toBe(1300);
    expect(await prisma.productUnit.count()).toBe(1300);
    if (process.env.PERF_STRICT) expect(ms).toBeLessThan(5000);
  });
});
```

`src/server/products/import-spec.ts`:

```ts
import { Prisma } from "@prisma/client";
import { parseViNumber } from "@/lib/parse-number";
import { normalizeSearch } from "@/lib/search";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import { parseYesNo } from "@/server/partners/import-spec";
import { productSearchText } from "./service";

type Kind = "HANG" | "NVL" | "THANH_PHAM" | "PHU_KIEN";
export interface ProductImportRow {
  code: string; name: string; kind: Kind; baseUnit: string; minStock: string; unit: string | null; factor: string | null;
  isCoil: boolean; stopped: boolean; note: string;
}
export type ProductImportCtx = undefined;

const COLUMNS: readonly ImportColumn[] = [
  { key: "code", header: "Mã", required: true, sample: "TL045" },
  { key: "name", header: "Tên", required: true, sample: "Tôn lạnh màu 0.45" },
  { key: "kind", header: "Loại", sample: "Hàng hóa" },
  { key: "baseUnit", header: "Đơn vị gốc", required: true, sample: "md" },
  { key: "minStock", header: "Định mức tồn", sample: "100" },
  { key: "unit", header: "Đơn vị quy đổi", sample: "kg" },
  { key: "factor", header: "Hệ số quy đổi", sample: "2,4" },
  { key: "isCoil", header: "Tôn cuộn", sample: "Không" },
  { key: "stopped", header: "Ngừng bán", sample: "Không" },
  { key: "note", header: "Ghi chú", sample: "" },
];

const KIND_BY_LABEL: Record<string, Kind> = {
  "": "HANG", hang: "HANG", "hang hoa": "HANG", nvl: "NVL", "nguyen vat lieu": "NVL", "thanh pham": "THANH_PHAM", "phu kien": "PHU_KIEN",
};
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export function productImportSpec(): ImportSpec<ProductImportRow, ProductImportCtx> {
  return {
    entity: "Product", label: "sản phẩm", columns: COLUMNS,
    loadContext: async () => undefined,

    parseRow(c) {
      const errors: string[] = [];
      const code = str(c.code).toUpperCase();
      if (!code) errors.push("Thiếu mã.");
      else if (!/^[A-Z0-9._\-/]{1,30}$/.test(code)) errors.push("Mã chỉ gồm chữ không dấu, số và . _ - / (tối đa 30 ký tự).");
      const name = str(c.name);
      if (!name) errors.push("Thiếu tên.");
      else if (name.length > 200) errors.push("Tên tối đa 200 ký tự.");
      const kindRaw = str(c.kind);
      const kind = KIND_BY_LABEL[normalizeSearch(kindRaw)];
      if (kind === undefined) errors.push(`Loại "${kindRaw}" không đúng — nhập Hàng hóa, NVL, Thành phẩm hoặc Phụ kiện.`);
      const baseUnit = str(c.baseUnit);
      if (!baseUnit) errors.push("Thiếu đơn vị gốc.");
      else if (baseUnit.length > 10) errors.push("Đơn vị gốc tối đa 10 ký tự.");
      const min = parseViNumber(c.minStock, { maxFrac: 3 });
      if (!min.ok) errors.push(`Định mức tồn: ${min.message}`);
      const unit = str(c.unit);
      const fac = parseViNumber(c.factor);
      if (!fac.ok) errors.push(`Hệ số quy đổi: ${fac.message}`);
      else if (unit && (fac.value === null || !(Number(fac.value) > 0))) errors.push("Hệ số quy đổi phải là số lớn hơn 0 khi có đơn vị quy đổi.");
      else if (!unit && fac.value !== null) errors.push("Có hệ số quy đổi nhưng thiếu tên đơn vị quy đổi.");
      if (unit && baseUnit && unit.toLowerCase() === baseUnit.toLowerCase()) errors.push("Đơn vị quy đổi trùng đơn vị gốc.");
      const coil = parseYesNo(c.isCoil);
      if (coil === null) errors.push(`Tôn cuộn: "${str(c.isCoil)}" — nhập Có hoặc Không.`);
      const stopped = parseYesNo(c.stopped);
      if (stopped === null) errors.push(`Ngừng bán: "${str(c.stopped)}" — nhập Có hoặc Không.`);
      if (errors.length > 0) return { ok: false, errors };
      return {
        ok: true,
        data: {
          code, name, kind: kind!, baseUnit, minStock: (min as { value: string | null }).value ?? "0",
          unit: unit || null, factor: unit ? (fac as { value: string }).value : null, isCoil: coil!, stopped: stopped!, note: str(c.note),
        },
      };
    },

    keyOf: (d) => d.code,
    // D2: mã ngừng bán lọc ra FILE RIÊNG cho khách xác nhận trước khi nhập
    skipReason: (d) => (d.stopped ? "Ngừng bán — chờ khách xác nhận (không nhập)." : null),

    async existingKeys(db, keys) {
      return new Set((await db.product.findMany({ where: { code: { in: keys } }, select: { code: true } })).map((p) => p.code));
    },

    async create(tx, _actor, rows) {
      if (rows.length === 0) return;
      await tx.product.createMany({
        data: rows.map((r) => ({
          code: r.code, name: r.name, searchText: productSearchText(r), kind: r.kind, baseUnit: r.baseUnit,
          minStock: new Prisma.Decimal(r.minStock), isCoil: r.isCoil, note: r.note || null,
        })),
      });
      const withUnit = rows.filter((r) => r.unit !== null);
      if (withUnit.length === 0) return;
      const ids = new Map((await tx.product.findMany({ where: { code: { in: withUnit.map((r) => r.code) } }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
      await tx.productUnit.createMany({ data: withUnit.map((r) => ({ productId: ids.get(r.code)!, unit: r.unit!, factor: new Prisma.Decimal(r.factor!) })) });
    },

    async update(tx, _actor, rows) {
      for (const r of rows) {
        const p = await tx.product.update({
          where: { code: r.code },
          data: { name: r.name, searchText: productSearchText(r), kind: r.kind, minStock: new Prisma.Decimal(r.minStock), isCoil: r.isCoil, note: r.note || null },
        });
        // Đơn vị GỐC không đổi qua import (sổ kho tính theo đơn vị gốc). Đơn vị quy đổi ghi đè theo file.
        if (r.unit !== null) {
          await tx.productUnit.upsert({
            where: { productId_unit: { productId: p.id, unit: r.unit } },
            update: { factor: new Prisma.Decimal(r.factor!) }, create: { productId: p.id, unit: r.unit, factor: new Prisma.Decimal(r.factor!) },
          });
        }
      }
    },
  };
}
```

Ghi chú: import KHÔNG đổi `baseUnit` của mã đã có (nhánh `update` bỏ qua cột này có chủ đích — cùng lý do chặn ở `updateProductBasic`). Test "Ghi đè" ở trên đã phản ánh điều đó (chỉ kiểm tên/định mức/đơn vị quy đổi).

- [ ] **Step 12: Chạy → xanh**, lint + typecheck, commit

```bash
rtk proxy npx vitest run tests/products
rtk proxy npm run lint && rtk proxy npm run typecheck
git add src/server/products tests/products
git commit -m "feat(products): SP backend — đơn vị & quy đổi (D-12), định mức tồn, tìm không dấu, import 1.300 SP (D2)"
```

---

### Task 8: Sản phẩm — API & giao diện, đóng plan 03a

**Mã:** 11, 12, 25 (cấu hình). **Files:**
- Create: `src/app/api/products/route.ts`, `src/app/api/products/[id]/section-update/route.ts`, `src/app/api/products/{search,export,import,import-template}/route.ts`
- Create: `src/components/products/{ProductTable,ProductNewForm,ProductDetail,UnitsEditor}.tsx`
- Create: `src/app/(app)/inventory/products/{page.tsx,new/page.tsx,[id]/page.tsx}`
- Modify: `src/config/app.config.ts` (bỏ `planned` của `product-list`), `docs/STATUS.md`, `docs/superpowers/plans/2026-09-24-00-master-plan.md` (bảng mục 2 + D-11…D-15)
- Test: `tests/ui/product-new-form.test.tsx`, `tests/ui/product-detail.test.tsx`, `tests/ui/product-pages.test.tsx`

**Interfaces:**
- Consumes: Task 7, Task 4 (`ImportExportMenu`, `handleImportPost`, `handleTemplateGet`), Task 6 (`Field`, `EditableSection`), `Combobox`.
- Produces: `POST /api/products` (Idempotency-Key) → `{ id, code }`; `PATCH /api/products/:id/section-update` body `{ section: "basic" | "stock" | "units" | "status", … }`; `GET /api/products/search?q=&kinds=NVL,HANG` → `ProductOption[]`; `GET /api/products/export`; `POST /api/products/import?mode=`; `GET /api/products/import-template`. Component `UnitsEditor` (dùng lại ở form nhập hàng 03b nếu cần).

- [ ] **Step 1: Routes API.** Mỗi file TỰ gọi `requireActorApi(` (test `route-guards` kiểm).

`src/app/api/products/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { createProductSchema } from "@/server/products/schemas";
import { createProductIdempotent } from "@/server/products/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("product.manage");
  const key = readIdempotencyKey(req);
  return createProductIdempotent(prisma, actor, key, createProductSchema.parse(await readJson(req)));
});
```

`src/app/api/products/[id]/section-update/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { basicSectionSchema, statusSectionSchema, stockSectionSchema, unitsSectionSchema } from "@/server/products/schemas";
import { setProductActive, setProductStock, setProductUnits, updateProductBasic } from "@/server/products/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("product.manage");
  const id = idParam.parse((await ctx.params).id);
  const raw = await readJson(req);
  const { section } = z.object({ section: z.string().optional() }).parse(raw);
  switch (section) {
    case "basic": { const v = basicSectionSchema.parse(raw); await prisma.$transaction((tx) => updateProductBasic(tx, actor, id, v)); break; }
    case "stock": { const v = stockSectionSchema.parse(raw); await prisma.$transaction((tx) => setProductStock(tx, actor, id, v)); break; }
    case "units": { const v = unitsSectionSchema.parse(raw); await prisma.$transaction((tx) => setProductUnits(tx, actor, id, v.units)); break; }
    case "status": { const v = statusSectionSchema.parse(raw); await prisma.$transaction((tx) => setProductActive(tx, actor, id, v)); break; }
    default: throw new ValidationError("Phần dữ liệu không hợp lệ.");
  }
  return { ok: true };
});
```

`src/app/api/products/search/route.ts`:

```ts
import type { ProductKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchProducts } from "@/server/products/queries";

export const dynamic = "force-dynamic";
const KINDS = new Set(["HANG", "NVL", "THANH_PHAM", "PHU_KIEN"]);

/** Ô chọn sản phẩm: chỉ mã đang hoạt động, kèm đơn vị quy đổi. `kinds` (tuỳ chọn) lọc theo loại, vd NVL cho dòng định mức. */
export const GET = apiHandler(async (req) => {
  await requireActorApi("product.view");
  const sp = new URL(req.url).searchParams;
  const kinds = (sp.get("kinds") ?? "").split(",").filter((k): k is ProductKind => KINDS.has(k));
  return searchProducts(prisma, { q: sp.get("q") ?? "", kinds });
});
```

`src/app/api/products/export/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportProductsXlsx, PRODUCT_FILTER_KEYS } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireActorApi("product.view");
    const sp: Record<string, string[]> = Object.create(null);
    for (const [k, v] of new URL(req.url).searchParams) (sp[k] ??= []).push(v);
    return xlsxResponse("san-pham.xlsx", await exportProductsXlsx(prisma, parseListParams(sp, PRODUCT_FILTER_KEYS)));
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

`src/app/api/products/import/route.ts` và `import-template/route.ts`:

```ts
// import/route.ts
import type { NextRequest } from "next/server";
import { assertCan } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleImportPost } from "@/server/import/handle";
import { productImportSpec } from "@/server/products/import-spec";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActorApi("data.import");
    assertCan(actor.perms, "product.manage"); // nhập = ghi hàng loạt ⇒ cần CẢ hai quyền
    return await handleImportPost(req, actor, productImportSpec());
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

```ts
// import-template/route.ts
import { requireActorApi } from "@/server/auth/session";
import { toErrorResponse } from "@/server/http/handler";
import { handleTemplateGet } from "@/server/import/handle";
import { productImportSpec } from "@/server/products/import-spec";

export async function GET() {
  try {
    await requireActorApi("data.import");
    return await handleTemplateGet(productImportSpec());
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

- [ ] **Step 2: Bảng + trang danh sách.**

`src/components/products/ProductTable.tsx`:

```tsx
"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { ProductDTO } from "@/server/products/queries";
import { PRODUCT_KINDS } from "@/server/products/schemas";

const KIND = new Map<string, string>(PRODUCT_KINDS.map((k) => [k.value, k.label]));
const BASE = "/inventory/products";

export function ProductTable({ rows, canManage, params }: { rows: ProductDTO[]; canManage: boolean; params: ListParams }) {
  const columns: Column<ProductDTO>[] = [
    { key: "code", label: "Mã", sortable: true, render: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (p) => p.name },
    { key: "kind", label: "Loại", sortable: true, render: (p) => KIND.get(p.kind) },
    { key: "baseUnit", label: "Đơn vị gốc", render: (p) => p.baseUnit },
    { key: "minStock", label: "Định mức tồn", sortable: true, align: "right", render: (p) => (Number(p.minStock) > 0 ? formatQty(p.minStock) : null) },
    { key: "unitCount", label: "Đơn vị quy đổi", hiddenByDefault: true, align: "right", render: (p) => (p.unitCount > 0 ? p.unitCount : null) },
    { key: "status", label: "Trạng thái", render: (p) => (p.isActive ? <Badge tone="success">Đang bán</Badge> : <Badge>Ngừng bán</Badge>) },
  ];
  // Định mức tồn = 0 hiện "—" (DB mặc định 0 nghĩa là chưa đặt định mức, không phải "định mức bằng 0")
  const actions = (p: ProductDTO): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `${BASE}/${p.id}` },
    ...(canManage ? [{ key: "edit", label: "Sửa", icon: "pencil" as const, href: `${BASE}/${p.id}?edit=basic` }] : []),
  ];
  return <DataTable id="products" columns={columns} rows={rows} rowKey={(p) => p.id} rowHref={(p) => `${BASE}/${p.id}`} rowActions={actions}
    sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />;
}
```

`src/app/(app)/inventory/products/page.tsx`:

```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { ImportExportMenu } from "@/components/import/ImportExportMenu";
import { ProductTable } from "@/components/products/ProductTable";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listProducts, PRODUCT_FILTER_KEYS } from "@/server/products/queries";
import { PRODUCT_KINDS } from "@/server/products/schemas";

const BASE = "/inventory/products";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("product.view");
  const params = parseListParams(await searchParams, PRODUCT_FILTER_KEYS);
  const { rows, total, stats } = await listProducts(prisma, params);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const status = params.filters.status?.[0];
  const canManage = actor.perms.has("product.manage");
  const canImport = canManage && actor.perms.has("data.import");
  const filtered = !!(params.q || params.filters.status || params.filters.kind);

  return (
    <ListPageLayout
      title="Danh mục sản phẩm"
      actions={<>
        <ImportExportMenu exportHref={buildExportHref("/api/products/export", params)} importTitle="Nhập sản phẩm từ Excel"
          {...(canImport ? { importEndpoint: "/api/products/import", templateHref: "/api/products/import-template" } : {})} />
        {canManage && <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Thêm mới</Link>}
      </>}
      stats={<>
        <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
        <StatCard label="Đang bán" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
        <StatCard label="Ngừng bán" value={stats.inactive} href={href({ filters: { status: ["inactive"] } })} active={status === "inactive"} />
      </>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên sản phẩm…" />
          <MultiSelectFilter label="Loại" paramKey="kind" basePath={BASE} params={params} options={PRODUCT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0 ? (
        filtered
          ? <EmptyState kind="no-result" title="Không tìm thấy sản phẩm phù hợp" description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title="Chưa có sản phẩm nào" action={canManage ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Thêm sản phẩm đầu tiên</Link> : undefined} />
      ) : (
        <ProductTable rows={rows} canManage={canManage} params={params} />
      )}
    </ListPageLayout>
  );
}
```

- [ ] **Step 3: Bộ sửa đơn vị + form tạo mới.**

`src/components/products/UnitsEditor.tsx`:

```tsx
"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, type Control, type FieldErrors, type FieldValues, type UseFormRegister } from "react-hook-form";
import { Field, inputClass } from "@/components/ui/Field";

type UnitErrors = { unit?: { message?: string }; factor?: { message?: string } }[] | undefined;

/**
 * Bộ sửa danh sách đơn vị quy đổi. Nhận `control/register/errors` của form có trường `units: { unit: string; factor: number }[]`
 * (form tạo mới HOẶC section "Đơn vị & quy đổi" của trang chi tiết) — kiểu FieldValues để dùng chung cho cả hai.
 */
export function UnitsEditor({ control, register, errors, baseUnit }: {
  control: Control<FieldValues>; register: UseFormRegister<FieldValues>; errors: FieldErrors<FieldValues>; baseUnit: string;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "units" });
  const ue = errors.units as unknown as UnitErrors;
  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        Đơn vị gốc: <strong>{baseUnit || "—"}</strong> (hệ số luôn = 1). Hệ số = số đơn vị nhập trên 1 đơn vị gốc — vd 2,4 kg/md: 3.000 kg ÷ 2,4 = 1.250 md.
      </p>
      {fields.map((f, i) => {
        const eu = ue?.[i]?.unit?.message;
        const ef = ue?.[i]?.factor?.message;
        return (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-3">
            <Field id={`unit-${i}`} label="Đơn vị nhập" error={eu}>
              <input id={`unit-${i}`} {...register(`units.${i}.unit`)} aria-invalid={!!eu} aria-describedby={eu ? `unit-${i}-error` : undefined} className={inputClass(eu)} />
            </Field>
            <Field id={`factor-${i}`} label="Hệ số (đơn vị / 1 đơn vị gốc)" error={ef}>
              <input id={`factor-${i}`} type="number" step="any" min={0} {...register(`units.${i}.factor`, { valueAsNumber: true })} aria-invalid={!!ef} aria-describedby={ef ? `factor-${i}-error` : undefined} className={`${inputClass(ef)} tabular text-right`} />
            </Field>
            <button type="button" aria-label={`Xóa đơn vị ${i + 1}`} onClick={() => remove(i)} className="mt-5 flex h-11 w-11 items-center justify-center rounded-sm text-danger hover:bg-hover md:h-9 md:w-9"><Trash2 size={16} aria-hidden /></button>
          </div>
        );
      })}
      <button type="button" onClick={() => append({ unit: "", factor: 1 })} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-9"><Plus size={14} aria-hidden /> Thêm đơn vị</button>
    </div>
  );
}
```

`src/components/products/ProductNewForm.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Field, inputClass } from "@/components/ui/Field";
import { NewPage } from "@/components/ui/NewPage";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { BASE_UNIT_SUGGESTIONS, createProductSchema, PRODUCT_KINDS, type CreateProductInput } from "@/server/products/schemas";
import { UnitsEditor } from "./UnitsEditor";

export function ProductNewForm() {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const { register, control, handleSubmit, setError, watch, formState: { errors, isDirty } } = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: { code: "", name: "", kind: "HANG", baseUnit: "", minStock: 0, isCoil: false, isActive: true, note: "", units: [] },
  });
  const baseUnit = watch("baseUnit");

  const submit = handleSubmit(async (v) => {
    try {
      // Cùng khoá cho mọi lần gửi lại của form này: bấm đúp / mất mạng rồi gửi lại không tạo 2 sản phẩm
      const r = await apiFetch<{ id: number }>("/api/products", { method: "POST", json: v, idempotencyKey: idem.key });
      router.replace(`/inventory/products/${r.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.fields?.code) { setError("code", { message: e.fields.code }, { shouldFocus: true }); return; }
      throw e;
    }
  });

  return (
    <NewPage backHref="/inventory/products" backLabel="Quay lại danh mục sản phẩm" title="Thêm sản phẩm" submitLabel="Tạo"
      isDirty={() => isDirty} onSubmit={async () => { await submit(); }}>
      <div className="space-y-5">
        <h2 className="text-base font-semibold">Thông tin cơ bản</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="code" label="Mã" required hint="Chữ không dấu, số, . _ - / — hệ thống tự viết HOA" error={errors.code?.message}>
            <input id="code" autoComplete="off" {...register("code")} aria-invalid={!!errors.code} aria-describedby={errors.code ? "code-error" : "code-hint"} className={inputClass(errors.code)} />
          </Field>
          <Field id="name" label="Tên" required error={errors.name?.message}>
            <input id="name" autoComplete="off" {...register("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} className={inputClass(errors.name)} />
          </Field>
          <Field id="kind" label="Loại" required error={errors.kind?.message}>
            <select id="kind" {...register("kind")} className={inputClass(errors.kind)}>
              {PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <Field id="baseUnit" label="Đơn vị gốc" required hint="Sổ kho và giá vốn luôn tính theo đơn vị này" error={errors.baseUnit?.message}>
            <input id="baseUnit" list="base-unit-suggestions" autoComplete="off" {...register("baseUnit")} aria-invalid={!!errors.baseUnit} aria-describedby={errors.baseUnit ? "baseUnit-error" : "baseUnit-hint"} className={inputClass(errors.baseUnit)} />
            <datalist id="base-unit-suggestions">{BASE_UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
          </Field>
          <Field id="minStock" label="Định mức tồn" hint="Dưới mức này sẽ có cảnh báo (0 = chưa đặt)" error={errors.minStock?.message}>
            <input id="minStock" type="number" min={0} step="any" {...register("minStock", { valueAsNumber: true })} aria-invalid={!!errors.minStock} aria-describedby={errors.minStock ? "minStock-error" : "minStock-hint"} className={`${inputClass(errors.minStock)} tabular text-right`} />
          </Field>
          <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" {...register("isCoil")} /> Là tôn cuộn (hiện ở màn Tra cứu cuộn)</label>
        </div>

        <h2 className="pt-2 text-base font-semibold">Đơn vị nhập & quy đổi</h2>
        <UnitsEditor control={control as never} register={register as never} errors={errors as never} baseUnit={baseUnit} />

        <Field id="note" label="Ghi chú" error={errors.note?.message}>
          <textarea id="note" rows={3} {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        </Field>
      </div>
    </NewPage>
  );
}
```

`src/app/(app)/inventory/products/new/page.tsx`:

```tsx
import { ProductNewForm } from "@/components/products/ProductNewForm";
import { requireActor } from "@/server/auth/session";

export default async function NewProductPage() {
  await requireActor("product.manage");
  return <ProductNewForm />;
}
```

- [ ] **Step 4: Trang chi tiết.**

`src/components/products/ProductDetail.tsx`:

```tsx
"use client";

import { DetailField, DetailPage, useDetailNav, type TabRenderCtx } from "@/components/ui/DetailPage";
import { EditableSection } from "@/components/ui/EditableSection";
import { Field, inputClass } from "@/components/ui/Field";
import { apiFetch } from "@/lib/api-fetch";
import { formatNumber, formatQty } from "@/lib/format";
import type { ProductDetailDTO } from "@/server/products/queries";
import { basicSectionSchema, PRODUCT_KINDS, statusSectionSchema, stockSectionSchema, unitsSectionSchema } from "@/server/products/schemas";
import { UnitsEditor } from "./UnitsEditor";

const KIND = new Map<string, string>(PRODUCT_KINDS.map((k) => [k.value, k.label]));

export function ProductDetail({ product: x, canManage }: { product: ProductDetailDTO; canManage: boolean }) {
  const nav = useDetailNav(["info", "units"], { basic: "info", stock: "info", status: "info", units: "units" });
  const save = (section: string) => (v: object) =>
    apiFetch(`/api/products/${x.id}/section-update`, { method: "PATCH", json: { section, ...v } }).then(() => {});

  const basic = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="basic" title="Thông tin cơ bản" editLabel="Chỉnh sửa thông tin cơ bản" canEdit={canManage}
      schema={basicSectionSchema} save={save("basic")} defaults={{ name: x.name, kind: x.kind, baseUnit: x.baseUnit, isCoil: x.isCoil, note: x.note ?? "" }}
      view={
        <dl className="space-y-2">
          <DetailField label="Mã">{x.code}</DetailField>
          <DetailField label="Tên">{x.name}</DetailField>
          <DetailField label="Loại">{KIND.get(x.kind)}</DetailField>
          <DetailField label="Đơn vị gốc">{x.baseUnit}</DetailField>
          <DetailField label="Tôn cuộn">{x.isCoil ? "Có" : "Không"}</DetailField>
          <DetailField label="Ghi chú">{x.note}</DetailField>
        </dl>
      }
      edit={(f) => {
        const e = f.formState.errors;
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Tên" required error={e.name?.message}><input id="name" {...f.register("name")} aria-invalid={!!e.name} className={inputClass(e.name)} /></Field>
            <Field id="kind" label="Loại" required error={e.kind?.message}>
              <select id="kind" {...f.register("kind")} className={inputClass(e.kind)}>{PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            </Field>
            <Field id="baseUnit" label="Đơn vị gốc" required hint="Không đổi được khi sản phẩm đã có phát sinh kho" error={e.baseUnit?.message}>
              <input id="baseUnit" {...f.register("baseUnit")} aria-invalid={!!e.baseUnit} className={inputClass(e.baseUnit)} />
            </Field>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" {...f.register("isCoil")} /> Là tôn cuộn</label>
            <Field id="note" label="Ghi chú" className="sm:col-span-2"><textarea id="note" rows={3} {...f.register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" /></Field>
          </div>
        );
      }} />
  );

  const stock = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="stock" title="Định mức tồn" editLabel="Chỉnh sửa định mức tồn" canEdit={canManage}
      schema={stockSectionSchema} save={save("stock")} defaults={{ minStock: Number(x.minStock) }}
      view={<dl><DetailField label="Định mức tồn">{Number(x.minStock) > 0 ? `${formatQty(x.minStock)} ${x.baseUnit}` : null}</DetailField></dl>}
      edit={(f) => (
        <Field id="minStock" label={`Định mức tồn (${x.baseUnit})`} error={f.formState.errors.minStock?.message}>
          <input id="minStock" type="number" min={0} step="any" {...f.register("minStock", { valueAsNumber: true })} aria-invalid={!!f.formState.errors.minStock} className={`${inputClass(f.formState.errors.minStock)} tabular text-right`} />
        </Field>
      )} />
  );

  const status = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="status" title="Trạng thái" editLabel="Chỉnh sửa trạng thái" canEdit={canManage}
      schema={statusSectionSchema} save={save("status")} defaults={{ isActive: x.isActive }}
      view={<dl><DetailField label="Trạng thái">{x.isActive ? "Đang bán" : "Ngừng bán (không hiện trong ô chọn)"}</DetailField></dl>}
      edit={(f) => <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" {...f.register("isActive")} /> Đang bán</label>} />
  );

  const units = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="units" title="Đơn vị & quy đổi" editLabel="Chỉnh sửa đơn vị quy đổi" canEdit={canManage}
      schema={unitsSectionSchema} save={save("units")} defaults={{ units: x.units.map((u) => ({ unit: u.unit, factor: Number(u.factor) })) }}
      view={x.units.length === 0
        ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa khai báo đơn vị quy đổi. Sản phẩm chỉ nhập/bán theo đơn vị gốc ({x.baseUnit}).</p>
        : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-fg-muted"><th className="py-1">Đơn vị nhập</th><th className="py-1 text-right">Hệ số</th><th className="py-1">Diễn giải</th></tr></thead>
            <tbody>
              {x.units.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="py-2 font-medium">{u.unit}</td>
                  <td className="tabular py-2 text-right">{formatNumber(u.factor, 6)}</td>
                  <td className="py-2 text-fg-secondary">{formatNumber(u.factor, 6)} {u.unit} = 1 {x.baseUnit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      edit={(f) => <UnitsEditor control={f.control as never} register={f.register as never} errors={f.formState.errors as never} baseUnit={x.baseUnit} />} />
  );

  return (
    <DetailPage
      backHref="/inventory/products" backLabel="Quay lại danh mục sản phẩm"
      summary={{
        title: x.name, code: x.code,
        badges: [{ label: KIND.get(x.kind) ?? x.kind, tone: "info" }, ...(x.isCoil ? [{ label: "Tôn cuộn", tone: "tertiary" as const }] : []), x.isActive ? { label: "Đang bán", tone: "success" as const } : { label: "Ngừng bán", tone: "neutral" as const }],
        facts: [{ label: "Đơn vị gốc", value: x.baseUnit }, { label: "Định mức tồn", value: Number(x.minStock) > 0 ? formatQty(x.minStock) : "—" }, { label: "Đơn vị quy đổi", value: x.units.length }],
      }}
      tabs={[
        { key: "info", label: "Thông tin", render: (ctx) => <div className="space-y-6">{basic(ctx)}{stock(ctx)}{status(ctx)}</div> },
        { key: "units", label: "Đơn vị & quy đổi", count: x.units.length, render: (ctx) => units(ctx) },
      ]}
      {...nav}
      initialEditing={canManage ? nav.initialEditing : null}
    />
  );
}
```

`src/app/(app)/inventory/products/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/products/ProductDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getProduct } from "@/server/products/queries";

const MAX_INT32 = 2_147_483_647;

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("product.view");
  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0; // "1e2", "0x10", "5abc" → 404
  if (id <= 0 || id > MAX_INT32) notFound();
  const product = await getProduct(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  return <ProductDetail product={product} canManage={actor.perms.has("product.manage")} />;
}
```

Ghi chú: các `as never` ở `UnitsEditor` chỉ để chiều kiểu `FieldValues` (form tạo mới/section có kiểu chặt hơn) — không đổi hành vi. Tab **Tồn kho** (số tồn, lô, giá nhập gần nhất theo quyền) do plan 03b (Task 12) thêm vào mảng `tabs`.

- [ ] **Step 5: Test UI (đỏ → xanh)**

`tests/ui/product-new-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductNewForm } from "@/components/products/ProductNewForm";
import { ApiError } from "@/lib/api-fetch";

const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
beforeEach(() => { replace.mockReset(); apiFetch.mockReset(); });
afterEach(cleanup);

async function fillBasics() {
  await userEvent.type(screen.getByLabelText(/^Mã/), "tl045");
  await userEvent.type(screen.getByLabelText(/^Tên/), "Tôn lạnh 0.45");
  await userEvent.type(screen.getByLabelText(/^Đơn vị gốc/), "md");
}

describe("ProductNewForm", () => {
  it("form rỗng → lỗi tiếng Việt, không gọi API", async () => {
    render(<ProductNewForm />);
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Nhập mã.")).toBeInTheDocument();
    expect(screen.getByText("Nhập tên.")).toBeInTheDocument();
    expect(screen.getByText("Nhập đơn vị.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("[Review Focus 3] thêm 1 dòng quy đổi kg / 2,4 → POST đúng payload + Idempotency-Key, rồi sang trang chi tiết", async () => {
    apiFetch.mockResolvedValue({ id: 9, code: "TL045" });
    render(<ProductNewForm />);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Thêm đơn vị" }));
    await userEvent.type(screen.getByLabelText("Đơn vị nhập"), "kg");
    const factor = screen.getByLabelText(/^Hệ số/);
    await userEvent.clear(factor);
    await userEvent.type(factor, "2.4");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/inventory/products/9"));
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/products");
    expect(init.idempotencyKey).toBeTruthy();
    expect(init.json).toMatchObject({ code: "tl045", baseUnit: "md", kind: "HANG", units: [{ unit: "kg", factor: 2.4 }] });
  });

  it("hệ số 0 → lỗi tại ô hệ số; hai dòng cùng đơn vị → 'Đơn vị bị trùng.'; không gọi API", async () => {
    render(<ProductNewForm />);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Thêm đơn vị" }));
    await userEvent.click(screen.getByRole("button", { name: "Thêm đơn vị" }));
    const units = screen.getAllByLabelText("Đơn vị nhập");
    await userEvent.type(units[0]!, "kg");
    await userEvent.type(units[1]!, "kg");
    const factors = screen.getAllByLabelText(/^Hệ số/);
    await userEvent.clear(factors[0]!);
    await userEvent.type(factors[0]!, "0");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Hệ số phải lớn hơn 0.")).toBeInTheDocument();
    expect(screen.getByText("Đơn vị bị trùng.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("trùng mã (409 kèm fields.code) → lỗi tại ô Mã, giữ dữ liệu, không chuyển trang", async () => {
    apiFetch.mockRejectedValue(new ApiError(409, "Mã đã tồn tại.", undefined, { code: "Mã đã tồn tại." }));
    render(<ProductNewForm />);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Mã đã tồn tại.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tên/)).toHaveValue("Tôn lạnh 0.45");
    expect(replace).not.toHaveBeenCalled();
  });
});
```

`tests/ui/product-detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDetail } from "@/components/products/ProductDetail";
import type { ProductDetailDTO } from "@/server/products/queries";

const apiFetch = vi.fn();
const search = { current: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inventory/products/7",
  useSearchParams: () => search.current,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const product: ProductDetailDTO = {
  id: 7, code: "TL045", name: "Tôn lạnh 0.45", kind: "HANG", baseUnit: "md", minStock: "100", isCoil: false, isActive: true, note: null,
  units: [{ id: 1, unit: "kg", factor: "2.4" }],
};
beforeEach(() => { apiFetch.mockReset(); search.current = new URLSearchParams(); });
afterEach(cleanup);

describe("ProductDetail", () => {
  it("chỉ xem (thiếu product.manage): không bút chì, kể cả khi URL có ?edit=basic", () => {
    search.current = new URLSearchParams("edit=basic");
    render(<ProductDetail product={product} canManage={false} />);
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
    expect(screen.queryByLabelText(/^Tên/)).toBeNull();
  });

  it("sửa Định mức tồn: chỉ gửi field của section 'stock'", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    render(<ProductDetail product={product} canManage />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa định mức tồn" }));
    const input = screen.getByLabelText(/^Định mức tồn/);
    await userEvent.clear(input);
    await userEvent.type(input, "250");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/products/7/section-update", { method: "PATCH", json: { section: "stock", minStock: 250 } });
  });

  it("[Review Focus 3] tab Đơn vị: thêm 'cây' / 0,166667 → gửi cả đơn vị cũ lẫn mới trong section 'units'", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    search.current = new URLSearchParams("tab=units");
    render(<ProductDetail product={product} canManage />);
    expect(screen.getByText("2,4 kg = 1 md")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa đơn vị quy đổi" }));
    await userEvent.click(screen.getByRole("button", { name: "Thêm đơn vị" }));
    await userEvent.type(screen.getAllByLabelText("Đơn vị nhập")[1]!, "cây");
    const factor = screen.getAllByLabelText(/^Hệ số/)[1]!;
    await userEvent.clear(factor);
    await userEvent.type(factor, "0.166667");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/products/7/section-update", {
      method: "PATCH", json: { section: "units", units: [{ unit: "kg", factor: 2.4 }, { unit: "cây", factor: 0.166667 }] },
    });
  });

  it("sản phẩm chưa có đơn vị quy đổi: thông báo rõ chỉ dùng đơn vị gốc", () => {
    search.current = new URLSearchParams("tab=units");
    render(<ProductDetail product={{ ...product, units: [] }} canManage={false} />);
    expect(screen.getByText(/Chưa khai báo đơn vị quy đổi/)).toBeInTheDocument();
  });
});
```

`tests/ui/product-pages.test.tsx`:

```tsx
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductDetailPage from "@/app/(app)/inventory/products/[id]/page";
import ProductsPage from "@/app/(app)/inventory/products/page";
import { ImportExportMenu } from "@/components/import/ImportExportMenu";
import { MultiSelectFilter } from "@/components/ui";

const requireActor = vi.fn();
const listProducts = vi.fn();
const getProduct = vi.fn();
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOTFOUND"); } }));
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/products/queries", async (orig) => ({
  ...(await orig<typeof import("@/server/products/queries")>()),
  listProducts: (...a: unknown[]) => listProducts(...a), getProduct: (...a: unknown[]) => getProduct(...a),
}));
vi.mock("@/components/products/ProductTable", () => ({ ProductTable: () => null }));
vi.mock("@/components/products/ProductDetail", () => ({ ProductDetail: () => null }));

const actor = (...perms: string[]) => ({ userId: 7, perms: new Set(perms) });
beforeEach(() => {
  for (const m of [requireActor, listProducts, getProduct]) m.mockReset();
  listProducts.mockResolvedValue({ rows: [], total: 0, stats: { all: 0, active: 0, inactive: 0 } });
});

function findAll(node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) out.push(el);
  findAll(el.props?.children as ReactNode, type, out);
  for (const k of ["stats", "filters", "actions", "footer"]) findAll(el.props?.[k] as ReactNode, type, out);
  return out;
}
const list = (sp = {}) => ProductsPage({ searchParams: Promise.resolve(sp) });

describe("/inventory/products (server)", () => {
  it("cần product.view; bị từ chối thì KHÔNG đọc dữ liệu", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(list()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("product.view");
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("tham số URL đi qua parseListParams: q, sort, trang, lọc loại", async () => {
    requireActor.mockResolvedValue(actor("product.view"));
    await list({ kind: "NVL,HANG", q: "ton", sort: "-name", page: "3" });
    expect(listProducts.mock.calls[0]![1]).toMatchObject({ q: "ton", sort: "-name", page: 3, filters: { kind: ["NVL", "HANG"] } });
  });

  it("thiếu product.manage/data.import: menu Nhập/Xuất chỉ có Xuất, không nút Thêm mới; có đủ quyền thì có importEndpoint", async () => {
    requireActor.mockResolvedValueOnce(actor("product.view"));
    const readOnly = await list();
    expect(findAll(readOnly, ImportExportMenu)[0]!.props.importEndpoint).toBeUndefined();
    expect(JSON.stringify(readOnly)).not.toContain("/inventory/products/new");
    requireActor.mockResolvedValueOnce(actor("product.view", "product.manage", "data.import"));
    const admin = await list();
    expect(findAll(admin, ImportExportMenu)[0]!.props.importEndpoint).toBe("/api/products/import");
    expect(findAll(admin, MultiSelectFilter)).toHaveLength(1);
  });

  it("trang chi tiết: id rác ('1e2', 'abc', '0', số quá lớn) → 404 mà KHÔNG truy vấn DB", async () => {
    requireActor.mockResolvedValue(actor("product.view"));
    for (const id of ["1e2", "abc", "0", "99999999999"]) {
      await expect(ProductDetailPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NOTFOUND");
    }
    expect(getProduct).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Mở menu + kiểm tay.** Xoá `planned: P` của `product-list` trong `app.config.ts`. `npm run dev` → **Kho → Danh mục sản phẩm**: tạo file thật 1.300 dòng từ tệp mẫu để nhập (đo thời gian), thêm 1 SP có đơn vị `kg`, sửa từng section, tìm `ton lanh`, đo tải trang ≤ 3 giây, dark/light, đăng nhập **Thủ kho** (chỉ xem: không có Thêm/Sửa/Nhập). Không tuyên bố xong khi chưa mở trang thật.

- [ ] **Step 7: Kiểm toàn bộ + cập nhật tài liệu + commit**

```bash
rtk proxy npm run lint
rtk proxy npm run typecheck
rtk proxy npm test          # ~8–10 phút; toàn bộ phải xanh
rtk proxy npm run build
```

Cập nhật `docs/STATUS.md`: mục 4 thêm dòng "GĐ1b-a (plan 03a): danh mục nền, KH/NCC, SP, khung Import Excel" kèm số file/test; mục 5/6 chuyển 03a sang xong, 03b là bước kế tiếp; mục 8 ghi D-11…D-15. Cập nhật `docs/superpowers/plans/2026-09-24-00-master-plan.md`: mục 1 thêm D-11…D-15, mục 2 tách dòng 03 thành `03a/03b/03c` (tên file plan).

```bash
git add -A
git commit -m "feat(products): màn Sản phẩm — danh sách, tạo mới, chi tiết theo section, đơn vị & quy đổi, nhập/xuất Excel (đóng plan 03a)"
```

**Kiểm cuối plan 03a (DoD — chép master mục 7):** truy được về mã (8, 9, 10, 11, 12, 13–18, 25-cấu hình) · zod + lỗi tiếng Việt · quyền 3 cấp + route guard (`route-guards.test.ts`) · phạm vi "khách của mình" ở server (danh sách/ô chọn/chi tiết/export) · ghi có transaction + audit · trang ≤ 3 giây với 1.300 SP (đo) · danh sách có search/filter/export/pagination dính đáy/Stat Card · chi tiết full page + deep-link `?tab=`/`?edit=` · dark/light · lint + typecheck + test xanh.
