# GĐ1b-b — Nhập hàng & Quản lý kho (Plan 03b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Đọc trước: `2026-09-24-00-master-plan.md` (Global Constraints, DoD), **`2026-09-27-03a-gd1b-catalog-partners-products.md`** (plan này dùng lại `Field`, `EditableSection`, `ImportExportMenu`, `Combobox`, `parseViNumber`, `searchProducts`, `searchPartners`, `convertToBase`, `resolveFactor`), `docs/engine-fifo.md` **(bắt buộc — mục 0, 3, 4, 5, 8)**, `docs/conventions/{list-page,sensitive-data}.md`. Chạy SAU khi plan 03a merge.

**Goal:** Lập/sửa/hủy **phiếu nhập hàng** sinh lớp lô FIFO + công nợ phải trả NCC (mã 19, 20), **nhập kho không NCC** (21), và các màn kho **sổ kho/thẻ kho, tồn hiện tại, XNT, định mức tồn + cảnh báo, tra cứu cuộn** (22–25, 30) — mọi giá nhập/giá vốn ẩn ở tầng server theo quyền (T2).

**Architecture:** `src/server/purchase/` (schemas → freight → service → queries) gọi engine **chỉ qua** `@/server/inventory` (`withInventoryTx`, `postReceipt`, `removeDocument`, `updateLayerCost`, `productsOfDocument`, `docTimestamp`, `unitCostOf`). Một cầu nối mới `withIdempotentInventoryTx` ghép Idempotency-Key + transaction kho. `src/server/inventory-reports/` đọc sổ kho bằng SQL thuần (tính số dư khi đọc — không cột số dư chạy). Truy vấn trả DTO **đã lọc theo quyền** (`redactDeep` nằm TRONG hàm truy vấn, không để UI quên).

**Tech Stack:** như plan 03a. Không thêm thư viện.

**Spec:** Phần 2.4–2.5 (`purchases`, `stock_adjustments`, engine), 3.1 (nhập + phân bổ cước), 3.5 (sửa/hủy), 4.4 (xuyên kỳ), 6.4 (quy đổi), 6.10 (nhập không NCC), Phần 7 M3–M4 (mã 19–25, 30).

## Global Constraints

Kế thừa **Global Constraints của master plan** và **của plan 03a** (D-11…D-15). Bổ sung khoá cho 03b (03c dùng lại):

- **D-13 (công nợ phải trả):** `partner_ledger` của phiếu nhập = 1 dòng `credit` = **tiền hàng** (Σ số lượng × đơn giá). **Cước KHÔNG cộng vào công nợ NCC** (cước thường trả cho nhà xe, ghi qua phiếu chi ở plan 05); cước chỉ cộng vào **giá vốn lô** (spec 3.1, mặc định "CÓ" phân bổ theo giá trị). `// TODO: confirm` với khách (spec Phần 11 mục 2) — hằng `FREIGHT_IN_COST = true` ở `freight.ts` là điểm duy nhất bật/tắt.
- **D-16 (mã chứng từ + tên cột tiền):** mã phiếu `PN000001` (nhập hàng), `NK000001` (nhập không NCC) = tiền tố + id 6 số, cấp bằng `nextval` của chính sequence bảng. **Mọi cột tiền/giá của bảng mới đặt ĐÚNG tên đã đăng ký ở `SENSITIVE_FIELDS`** (`purchasePrice`, `purchaseAmount`, `purchaseTotal`, `freightCost`, `allocatedFreight`, `unitCost`) → dù ai đó lỡ trả nguyên bản ghi Prisma ra ngoài, `redactDeep` vẫn loại đúng cột. Có test canh (Task 9).
- **D-17 (idempotency + kho):** thao tác tạo chứng từ kho dùng `withIdempotentInventoryTx` (Task 10) — **không** lồng `withIdempotency` với `withInventoryTx` (mỗi cái tự mở transaction).
- **D-18 (thời điểm chứng từ):** `purchases.at` (header) là `at` của MỌI dòng — thoả hợp đồng engine §3 "mỗi dòng lưu `at` + `seq`" (mọi dòng cùng `at`; mỗi dòng lưu `seq` riêng ở `purchase_lines.seq`). Chứng từ mới/đổi ngày → `docTimestamp(date, now)`; **sửa mà ngày không đổi → dùng lại `at` đã lưu** (không gọi lại `docTimestamp`).
- **Quyền:** lập/sửa phiếu nhập cần `purchase.create`/`purchase.edit` **VÀ** `purchase_price.view` (không biết giá thì không nhập giá được); hủy cần `purchase.cancel`; nhập không NCC cần `stock_adjust.manage` (nhập đơn giá tay cần thêm `cost.view`). `ROLE_DEFAULTS` **không đổi** ở plan này — Thủ kho hiện KHÔNG có `purchase.*` (xem mục "Cần khách xác nhận" ở cuối).
- **Sửa/hủy = mọi thứ trong MỘT `withInventoryTx`:** khai báo ĐỦ mã hàng (mã cũ của phiếu + mã mới của input, tăng dần), khoá dòng phiếu `FOR UPDATE`, kiểm mã cũ ⊆ mã đã khoá (người khác vừa sửa → 409 "tải lại"), `removeDocument` rồi ghi lại (engine tự giữ `seq` theo khoá dòng).

## Review Focus

1. **Phân bổ cước làm tròn.** Cước 100 đ chia 3 dòng bằng nhau → 33,34 + 33,33 + 33,33 (tổng ĐÚNG 100, không lệch 1 đồng); tổng `số lượng × giá vốn đơn vị` của lô không lệch quá 1 đồng so với tiền hàng + cước; cước tổng 0 → không phân bổ; cước > 0 nhưng tiền hàng = 0 → lỗi rõ. **Cước nhập SAU phiếu hàng** → giá vốn lô và giá vốn dòng bán đã ăn lô đó cập nhật, sổ kho vẫn cân. → Task 11.
2. **Bấm 2 lần / mạng chập chờn khi lưu phiếu.** Cùng Idempotency-Key → 1 phiếu, 1 bộ lớp, 1 dòng công nợ; trả lại đúng kết quả lần đầu. → Task 10, 11.
3. **Sửa/hủy/backdate.** Phiếu thuộc kỳ đã kết sổ → "Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được." (không ghi gì); ngày chứng từ trước ngày mở kỳ / ở tương lai → lỗi tiếng Việt; lùi ngày trong kỳ → `at` = 23:59:59.999 ICT ngày đó. → Task 11.
4. **Quy đổi & làm tròn số lượng.** 3.000 kg ÷ 2,4 = 1.250 md; 1.000 kg ÷ 3 = 333,333 md; số lượng nhập nhỏ đến mức quy đổi ra 0 → lỗi; đơn vị chưa khai báo → lỗi; đơn vị gốc mà hệ số ≠ 1 → lỗi. → Task 11.
5. **Người không có quyền giá không thấy giá — ở MỌI đường ra:** danh sách, chi tiết, export Excel, nhật ký (`audit_log`), XNT, thẻ kho; **và không sắp xếp được theo cột giá** (lộ thứ tự). → Task 11, 12, 14.
6. **Hai người sửa CÙNG một phiếu đồng thời.** Kết quả nhất quán (một bên thắng, bên kia nhận lỗi 409 có kiểm soát hoặc chạy tuần tự), không `ProductNotLockedError`/500, sổ kho vẫn cân. → Task 11.
7. **Phiếu nhiều dòng cùng một mã hàng** (2 cuộn cùng loại, 2 lớp giá khác nhau) → 2 dòng sổ, 2 lớp, đúng thứ tự. → Task 11.
8. **XNT cân với sổ kho; tải ≤ 3 giây với ~1.300 mã × ~20 dòng/mã.** Tồn đầu + nhập − xuất = tồn cuối = số dư cuối thẻ kho = tồn hiện tại (kể cả có đơn treo). → Task 14.
9. **Nhập không NCC khi chưa có giá nhập gần nhất** (mã mới) và người nhập không có quyền giá → lỗi hướng dẫn, không tạo lớp giá 0. → Task 13.

## Cấu trúc file (plan 03b)

| Tạo mới | Trách nhiệm |
|---|---|
| `prisma/schema/purchase.prisma` + migration `purchasing` | `purchases`, `purchase_lines`, `stock_adjustments`, `stock_adjustment_lines` + CHECK |
| `src/server/idempotency/with-inventory-tx.ts` | `withIdempotentInventoryTx` (D-17); refactor nhẹ `with-idempotency.ts` |
| `src/server/purchase/{schemas,freight,codes,service,queries,export}.ts` | phiếu nhập: tạo/sửa/hủy/cước nhập sau, danh sách, chi tiết, export |
| `src/server/purchase/adjustment-in.ts` | nhập không NCC (mã 21) |
| `src/server/inventory-reports/{on-hand,stock-card,xnt,rolls,product-stock,labels}.ts` | báo cáo kho (đọc thuần) |
| `src/app/api/purchases/**`, `src/app/api/stock-adjustments-in/**`, `src/app/api/inventory/**` | API |
| `src/components/purchase/*`, `src/components/inventory/*` | UI |
| `src/app/(app)/purchase/{orders,adjustments-in}/**`, `src/app/(app)/inventory/{stock,ledger,xnt,min-stock,rolls}/**` | trang |

| Sửa | Ghi chú |
|---|---|
| `prisma/schema/master.prisma`, `period.prisma` | quan hệ ngược |
| `src/lib/permissions/catalog.ts` | thêm tên field nhạy cảm (Task 9) |
| `src/components/products/ProductDetail.tsx` + `src/app/(app)/inventory/products/[id]/page.tsx` | thêm tab **Tồn kho** (Task 15) |
| `src/config/app.config.ts` | bỏ `planned` của các chức năng đã giao |
| `tests/schema/checkers.ts` | thêm 2 model chứng từ vào `TRANSACTIONAL_MODELS` |

Lệnh: như 03a (`rtk proxy npx vitest run …`, DB test cổng 5434, không chạy 2 vitest cùng lúc).

---

### Task 9: Schema nhập hàng & nhập không NCC (migration `purchasing`) + tên field nhạy cảm

> Tiến độ 27/09: hoàn thành code, chờ CI/deploy. Migration `20260927125310_purchasing` đã áp dụng DB dev; test schema/quyền 3 file / 21 test và lint xanh. `npm run db:schema` chưa chạy được cục bộ vì WSL không có `/bin/bash`; không ảnh hưởng Prisma schema/migration hoặc test.

**Mã:** 19, 20, 21 (dữ liệu). **Files:**
- Create: `prisma/schema/purchase.prisma`, `prisma/migrations/<ts>_purchasing/migration.sql` (sinh + CHECK)
- Modify: `prisma/schema/master.prisma` (`Partner.purchases`, `Product.purchaseLines/adjustmentLines`), `prisma/schema/period.prisma` (`Period.purchases/stockAdjustments`)
- Modify: `src/lib/permissions/catalog.ts` (`SENSITIVE_FIELDS`), `tests/schema/checkers.ts`
- Test: `tests/db/purchasing-schema.test.ts`, `tests/permissions/sensitive-columns.test.ts`

**Interfaces:**
- Consumes: bảng `periods`, `partners`, `products`.
- Produces: model `Purchase`, `PurchaseLine`, `StockAdjustment`, `StockAdjustmentLine`, enum `StockAdjustmentType`; `SENSITIVE_FIELDS` thêm `purchaseAmount`, `purchaseTotal`, `freightCost`, `allocatedFreight` (→ `purchase_price.view`) và `openingValue`, `inValue`, `outValue`, `closingValue` (→ `cost.view`).

- [ ] **Step 1: Viết test (đỏ)** — `tests/db/purchasing-schema.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePeriod, makeProduct, makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function base() {
  const [period, product, user] = await Promise.all([makePeriod(), makeProduct(), makeUser()]);
  const supplier = await makePartner({ isCustomer: false, isSupplier: true });
  return { period, product, user, supplier };
}
const header = (b: Awaited<ReturnType<typeof base>>, over = {}) => ({
  code: "PN000001", periodId: b.period.id, partnerId: b.supplier.id, at: new Date("2026-09-01T03:00:00Z"), createdBy: b.user.id, ...over,
});
const line = (productId: number, over = {}) => ({
  productId, qty: 3000, unit: "kg", factorUsed: 2.4, qtyBase: 1250, purchasePrice: 18500, purchaseAmount: 55_500_000, ...over,
});

describe("purchases / purchase_lines", () => {
  it("tạo phiếu + dòng; mã phiếu duy nhất; cascade xoá dòng theo phiếu", async () => {
    const b = await base();
    const p = await prisma.purchase.create({ data: { ...header(b), lines: { create: [line(b.product.id)] } }, include: { lines: true } });
    expect(p.lines[0]).toMatchObject({ seq: null, allocatedFreight: expect.anything() });
    await expect(prisma.purchase.create({ data: header(b) })).rejects.toThrow(/Unique constraint/i);
    await prisma.purchase.delete({ where: { id: p.id } });
    expect(await prisma.purchaseLine.count()).toBe(0);
  });

  it("CHECK: số lượng/hệ số/số lượng gốc > 0; đơn giá, thành tiền, cước phân bổ ≥ 0; cước phiếu ≥ 0", async () => {
    const b = await base();
    const p = await prisma.purchase.create({ data: header(b) });
    for (const bad of [{ qty: 0 }, { factorUsed: 0 }, { qtyBase: 0 }, { purchasePrice: -1 }, { purchaseAmount: -1 }, { allocatedFreight: -1 }]) {
      await expect(prisma.purchaseLine.create({ data: { purchaseId: p.id, ...line(b.product.id, bad) } }), JSON.stringify(bad)).rejects.toThrow(/check constraint/i);
    }
    await expect(prisma.purchase.create({ data: header(b, { code: "PN2", freightCost: -1 }) })).rejects.toThrow(/check constraint/i);
  });

  it("không xoá được NCC / kỳ / sản phẩm đã có phiếu (RESTRICT)", async () => {
    const b = await base();
    await prisma.purchase.create({ data: { ...header(b), lines: { create: [line(b.product.id)] } } });
    await expect(prisma.partner.delete({ where: { id: b.supplier.id } })).rejects.toThrow();
    await expect(prisma.product.delete({ where: { id: b.product.id } })).rejects.toThrow();
    await expect(prisma.period.delete({ where: { id: b.period.id } })).rejects.toThrow();
  });
});

describe("stock_adjustments", () => {
  it("nhập không NCC: loại + dòng; CHECK số lượng > 0, đơn giá vốn ≥ 0; mã duy nhất", async () => {
    const b = await base();
    const a = await prisma.stockAdjustment.create({
      data: { code: "NK000001", periodId: b.period.id, type: "IN_NO_SUPPLIER", at: new Date(), createdBy: b.user.id, lines: { create: [{ productId: b.product.id, qty: 5, unitCost: 1000 }] } },
      include: { lines: true },
    });
    expect(a.lines).toHaveLength(1);
    await expect(prisma.stockAdjustmentLine.create({ data: { adjustmentId: a.id, productId: b.product.id, qty: 0, unitCost: 1 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.stockAdjustmentLine.create({ data: { adjustmentId: a.id, productId: b.product.id, qty: 1, unitCost: -1 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.stockAdjustment.create({ data: { code: "NK000001", periodId: b.period.id, type: "LOSS", at: new Date(), createdBy: b.user.id } })).rejects.toThrow(/Unique constraint/i);
  });
});
```

`tests/permissions/sensitive-columns.test.ts` (canh D-16: tiền/giá của bảng mới phải mang tên đã đăng ký):

```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { SENSITIVE_FIELDS } from "@/lib/permissions/catalog";

const MODELS = ["Purchase", "PurchaseLine", "StockAdjustmentLine"];
// Cột Decimal KHÔNG nhạy cảm: số lượng và hệ số quy đổi
const NOT_SENSITIVE = /^(qty|qtyBase|factorUsed)$/;

describe("D-16: cột tiền/giá của bảng chứng từ nhập mang tên đã đăng ký ở SENSITIVE_FIELDS", () => {
  for (const name of MODELS) {
    it(name, () => {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
      const money = model.fields.filter((f) => f.type === "Decimal" && !NOT_SENSITIVE.test(f.name)).map((f) => f.name);
      expect(money.length).toBeGreaterThan(0);
      for (const f of money) expect(SENSITIVE_FIELDS[f], `${name}.${f} chưa đăng ký ở SENSITIVE_FIELDS`).toBeDefined();
    });
  }

  it("giá nhập ⇒ purchase_price.view; giá vốn ⇒ cost.view", () => {
    for (const f of ["purchasePrice", "purchaseAmount", "purchaseTotal", "freightCost", "allocatedFreight"]) expect(SENSITIVE_FIELDS[f], f).toBe("purchase_price.view");
    for (const f of ["unitCost", "openingValue", "inValue", "outValue", "closingValue", "stockValue"]) expect(SENSITIVE_FIELDS[f], f).toBe("cost.view");
  });
});
```

Run: `rtk proxy npx vitest run tests/db/purchasing-schema.test.ts tests/permissions/sensitive-columns.test.ts` → FAIL (model/tên field chưa có).

- [ ] **Step 2: Viết `prisma/schema/purchase.prisma`**

```prisma
enum StockAdjustmentType {
  IN_NO_SUPPLIER
  LOSS
  WRITE_OFF
  STOCKTAKE

  @@map("stock_adjustment_type")
}

// Phiếu nhập hàng (mã 19–20). Cột tiền đặt ĐÚNG tên đã đăng ký ở SENSITIVE_FIELDS (D-16).
model Purchase {
  id            Int       @id @default(autoincrement())
  periodId      Int
  code          String    @unique // PN000001 — D-16
  partnerId     Int
  at            DateTime // thời điểm chứng từ (D-18): `at` của MỌI dòng; sửa mà ngày không đổi ⇒ dùng lại
  freightCost   Decimal   @default(0) @db.Decimal(18, 2)
  purchaseTotal Decimal   @default(0) @db.Decimal(18, 2) // Σ tiền hàng (KHÔNG gồm cước — D-13)
  note          String?
  isCancelled   Boolean   @default(false)
  cancelledAt   DateTime?
  cancelledBy   Int?
  cancelReason  String?
  createdBy     Int
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  period  Period         @relation(fields: [periodId], references: [id], onDelete: Restrict)
  partner Partner        @relation(fields: [partnerId], references: [id], onDelete: Restrict)
  lines   PurchaseLine[]

  @@index([periodId, at])
  @@index([partnerId, at])
  @@map("purchases")
}

model PurchaseLine {
  id               Int      @id @default(autoincrement())
  purchaseId       Int
  productId        Int
  qty              Decimal  @db.Decimal(18, 3) // theo ĐƠN VỊ NHẬP
  unit             String
  factorUsed       Decimal  @db.Decimal(18, 6) // hệ số THỰC TẾ lần nhập này (D-12: qtyBase = qty ÷ factorUsed)
  qtyBase          Decimal  @db.Decimal(18, 3) // theo đơn vị gốc — sổ kho/FIFO dùng số này
  purchasePrice    Decimal  @db.Decimal(18, 2) // đơn giá theo đơn vị nhập
  purchaseAmount   Decimal  @db.Decimal(18, 2) // = round2(qty × purchasePrice)
  allocatedFreight Decimal  @default(0) @db.Decimal(18, 2) // cước phân bổ theo giá trị (freight.ts)
  rollInfo         String? // ghi chú cuộn — CHỈ tra cứu (mã 30), không quản tồn theo cuộn (X6)
  rollSearch       String   @default("") // rollInfo chuẩn hoá không dấu (D-9) để tìm
  seq              BigInt? // seq engine trả về — lưu cùng dòng chứng từ (docs/engine-fifo.md §3)
  createdAt        DateTime @default(now())

  purchase Purchase @relation(fields: [purchaseId], references: [id], onDelete: Cascade)
  product  Product  @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([purchaseId])
  @@index([productId])
  @@map("purchase_lines")
}

// Điều chỉnh kho (mã 21 dùng loại IN_NO_SUPPLIER; LOSS/WRITE_OFF/STOCKTAKE do plan 06 dùng — spec 2.5).
model StockAdjustment {
  id           Int                 @id @default(autoincrement())
  periodId     Int
  code         String              @unique // NK000001
  type         StockAdjustmentType
  at           DateTime
  note         String?
  isCancelled  Boolean             @default(false)
  cancelledAt  DateTime?
  cancelledBy  Int?
  cancelReason String?
  createdBy    Int
  createdAt    DateTime            @default(now())

  period Period                @relation(fields: [periodId], references: [id], onDelete: Restrict)
  lines  StockAdjustmentLine[]

  @@index([periodId, at])
  @@map("stock_adjustments")
}

model StockAdjustmentLine {
  id           Int     @id @default(autoincrement())
  adjustmentId Int
  productId    Int
  qty          Decimal @db.Decimal(18, 3) // đơn vị GỐC
  unitCost     Decimal @db.Decimal(18, 4) // giá vốn lớp tạo ra (nhập tay, mặc định giá nhập gần nhất — 6.10)
  seq          BigInt?

  adjustment StockAdjustment @relation(fields: [adjustmentId], references: [id], onDelete: Cascade)
  product    Product         @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([adjustmentId])
  @@index([productId])
  @@map("stock_adjustment_lines")
}
```

Thêm quan hệ ngược: trong `Partner` (master.prisma) `purchases Purchase[]`; trong `Product` `purchaseLines PurchaseLine[]` và `adjustmentLines StockAdjustmentLine[]`; trong `Period` (period.prisma) `purchases Purchase[]` và `stockAdjustments StockAdjustment[]`.

- [ ] **Step 3: Migration + CHECK.** `rtk proxy npx prisma migrate dev --name purchasing --create-only`; kiểm SQL rồi thêm cuối file:

```sql
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts_nonneg_chk" CHECK ("freightCost" >= 0 AND "purchaseTotal" >= 0);
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_values_chk"
  CHECK ("qty" > 0 AND "factorUsed" > 0 AND "qtyBase" > 0 AND "purchasePrice" >= 0 AND "purchaseAmount" >= 0 AND "allocatedFreight" >= 0);
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_values_chk" CHECK ("qty" > 0 AND "unitCost" >= 0);
-- Quyền app_rw: GRANT mức bảng + DEFAULT PRIVILEGES của migration foundation đã phủ bảng/sequence mới.
```

Run: `rtk proxy npx prisma migrate dev` rồi `rtk proxy npx prisma generate`.

- [ ] **Step 4: Đăng ký tên field nhạy cảm** — trong `src/lib/permissions/catalog.ts`, mở rộng `SENSITIVE_FIELDS`:

```ts
  // Phiếu nhập hàng (plan 03b — D-16): tiền/giá nhập
  purchaseAmount: "purchase_price.view",
  purchaseTotal: "purchase_price.view",
  freightCost: "purchase_price.view",
  allocatedFreight: "purchase_price.view",
  // Báo cáo kho (plan 03b): trị giá tồn theo kỳ (giá vốn)
  openingValue: "cost.view",
  inValue: "cost.view",
  outValue: "cost.view",
  closingValue: "cost.view",
```

Trong `tests/schema/checkers.ts` đổi `TRANSACTIONAL_MODELS` thành `["StockLedger", "PartnerLedger", "CashLedger", "DiscountLedger", "Purchase", "StockAdjustment"]` (bắt buộc `periodId/createdBy/createdAt` — test DMMF rà).

- [ ] **Step 5: Chạy → xanh + commit**

```bash
rtk proxy npx vitest run tests/db tests/schema tests/permissions
rtk proxy npm run db:schema
git add prisma tests src/lib/permissions/catalog.ts db/db_schema.sql
git commit -m "feat(db): phiếu nhập hàng + nhập không NCC (mã 19–21), cột tiền mang tên field nhạy cảm (D-16)"
```

---

### Task 10: Cầu nối Idempotency-Key + giao dịch kho

**Mã:** nền cho 19, 21 (và plan 04/05). **Files:**
- Modify: `src/server/idempotency/with-idempotency.ts` (tách `claimIdempotencyKey` / `saveIdempotencyResult`, hành vi cũ giữ nguyên)
- Create: `src/server/idempotency/with-inventory-tx.ts`
- Test: `tests/idempotency/with-inventory-tx.test.ts` (test cũ `tests/idempotency/with-idempotency.test.ts` phải vẫn xanh)

**Interfaces:**
- Consumes: `withInventoryTx`, `WithInventoryOptions`, `EngineCtx` (barrel `@/server/inventory`).
- Produces: `claimIdempotencyKey<T>(tx, opts): Promise<{ replay: true; result: T } | { replay: false }>`, `saveIdempotencyResult<T>(tx, opts, raw: T): Promise<T>`, `withIdempotentInventoryTx<R>(prisma, opts: WithInventoryOptions & { scope: string; key: string }, work: (ctx: EngineCtx) => Promise<R>): Promise<R>`.

- [ ] **Step 1: Test (đỏ)** — `tests/idempotency/with-inventory-tx.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { postReceipt, docTimestamp } from "@/server/inventory";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod, makeProduct, makeUser } from "../helpers/factories";

let userId: number; let productId: number;
beforeEach(async () => {
  await resetDb();
  userId = (await makeUser()).id;
  await makePeriod({ openedAt: new Date("2026-08-01T00:00:00Z") });
  productId = (await makeProduct()).id;
});

const receive = (key: string, calls: { n: number }, over: { userId?: number; scope?: string } = {}) =>
  withIdempotentInventoryTx(prisma, { userId: over.userId ?? userId, products: [productId], scope: over.scope ?? "test.receive", key }, async (ctx) => {
    calls.n++;
    await postReceipt(ctx, { productId, qty: 10, unitCost: 100, docType: "PURCHASE", docId: 1, docLineId: 1, at: docTimestamp("2026-08-05", new Date()) });
    return { id: 1 };
  });

describe("withIdempotentInventoryTx (D-17)", () => {
  it("lần đầu chạy work, ghi kho; lần lặp cùng khoá trả kết quả cũ và KHÔNG chạy lại", async () => {
    const calls = { n: 0 };
    const a = await receive("k1", calls);
    const b = await receive("k1", calls);
    expect(b).toEqual(a);
    expect(calls.n).toBe(1);
    expect(await prisma.stockLedger.count()).toBe(1);
    expect(await prisma.costLayer.count()).toBe(1);
  });

  it("[Review Focus 2] 5 lần gửi ĐỒNG THỜI cùng khoá → work chạy đúng 1 lần, cả 5 nhận cùng kết quả", async () => {
    const calls = { n: 0 };
    const rs = await Promise.all(Array.from({ length: 5 }, () => receive("same", calls)));
    expect(new Set(rs.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(calls.n).toBe(1);
    expect(await prisma.stockLedger.count()).toBe(1);
  });

  it("khoá khác / người dùng khác / scope khác là độc lập", async () => {
    const calls = { n: 0 };
    const other = (await makeUser()).id;
    await receive("k", calls);
    await expect(receive("k", calls, { userId: other, scope: "test.receive" })).rejects.toThrow(); // cùng docId ⇒ vi phạm khác, nhưng KHÔNG bị coi là lặp
    expect(calls.n).toBe(2);
  });

  it("work ném lỗi → rollback CẢ khoá lẫn dữ liệu kho; thử lại cùng khoá chạy work lại", async () => {
    let n = 0;
    const run = () => withIdempotentInventoryTx(prisma, { userId, products: [productId], scope: "test.fail", key: "f" }, async (ctx) => {
      n++;
      await postReceipt(ctx, { productId, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 9, docLineId: 9, at: docTimestamp("2026-08-05", new Date()) });
      if (n === 1) throw new Error("boom");
      return { ok: true };
    });
    await expect(run()).rejects.toThrow("boom");
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    expect(await run()).toEqual({ ok: true });
    expect(await prisma.stockLedger.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Chạy → đỏ**; **Step 3: Refactor `with-idempotency.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";

export interface IdempotencyOptions {
  userId: number;
  scope: string; // vd "order.create"
  key: string; // UUID sinh 1 lần khi mở form, KHÔNG sinh lại mỗi lần retry
}

export type Claim<T> = { replay: true; result: T } | { replay: false };

/**
 * Chiếm khoá TRONG transaction của người gọi. Request đến sau bị chặn ở INSERT cho tới khi request đầu commit,
 * rồi đọc kết quả đã lưu; nếu request đầu rollback thì khoá biến mất và request sau tự chạy.
 */
export async function claimIdempotencyKey<T>(tx: Prisma.TransactionClient, opts: IdempotencyOptions): Promise<Claim<T>> {
  const inserted = await tx.$executeRaw`
    INSERT INTO idempotency_keys ("userId", "scope", "key", "createdAt")
    VALUES (${opts.userId}, ${opts.scope}, ${opts.key}, now())
    ON CONFLICT DO NOTHING`;
  if (inserted === 0) {
    const row = await tx.idempotencyKey.findUniqueOrThrow({ where: { userId_scope_key: { userId: opts.userId, scope: opts.scope, key: opts.key } } });
    return { replay: true, result: row.responseJson as T };
  }
  return { replay: false };
}

/** Lưu kết quả (đã chuẩn hoá qua JSON để lần đầu và lần lặp trả cùng một dạng). D-10: KHÔNG lưu bí mật. */
export async function saveIdempotencyResult<T>(tx: Prisma.TransactionClient, opts: IdempotencyOptions, raw: T): Promise<T> {
  const result = (raw === undefined ? null : JSON.parse(JSON.stringify(raw))) as T;
  await tx.idempotencyKey.update({
    where: { userId_scope_key: { userId: opts.userId, scope: opts.scope, key: opts.key } },
    data: { responseJson: result === null ? undefined : (result as Prisma.InputJsonValue) },
  });
  return result;
}

/**
 * Chạy `work` đúng 1 lần cho mỗi (userId, scope, key). Khoá và work nằm CÙNG 1 transaction.
 * `work` phải trả giá trị JSON-hoá được (id, chuỗi, số) và KHÔNG được trả bí mật (mật khẩu tạm...).
 */
export async function withIdempotency<T>(prisma: PrismaClient, opts: IdempotencyOptions, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const claim = await claimIdempotencyKey<T>(tx, opts);
      if (claim.replay) return claim.result;
      return saveIdempotencyResult(tx, opts, await work(tx));
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
```

`src/server/idempotency/with-inventory-tx.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { withInventoryTx, type EngineCtx, type WithInventoryOptions } from "@/server/inventory";
import { claimIdempotencyKey, saveIdempotencyResult } from "./with-idempotency";

/**
 * Tạo chứng từ kho MỘT LẦN cho mỗi Idempotency-Key (D-17). `withIdempotency` và `withInventoryTx` đều tự mở transaction
 * nên KHÔNG lồng được — cầu nối này chiếm khoá bằng chính `ctx.tx` của transaction kho. Retry deadlock của engine chạy
 * lại TOÀN BỘ callback trên transaction mới (khoá đã rollback) nên vẫn đúng. Lặp lại cùng khoá: vẫn khoá các mã hàng
 * trong `products` (vô hại), không ghi gì, trả kết quả lần đầu.
 */
export async function withIdempotentInventoryTx<R>(
  prisma: PrismaClient,
  opts: WithInventoryOptions & { scope: string; key: string },
  work: (ctx: EngineCtx) => Promise<R>,
): Promise<R> {
  const idem = { userId: opts.userId, scope: opts.scope, key: opts.key };
  return withInventoryTx(prisma, opts, async (ctx) => {
    const claim = await claimIdempotencyKey<R>(ctx.tx, idem);
    if (claim.replay) return claim.result;
    return saveIdempotencyResult(ctx.tx, idem, await work(ctx));
  });
}
```

- [ ] **Step 4: Chạy → xanh** (`rtk proxy npx vitest run tests/idempotency tests/inventory/barrel.test.ts`) — test cũ của `withIdempotency` vẫn xanh; commit:

```bash
git add src/server/idempotency tests/idempotency
git commit -m "feat(idempotency): withIdempotentInventoryTx — ghép Idempotency-Key với giao dịch kho (D-17)"
```

---

### Task 11: Phiếu nhập hàng — backend (tạo / sửa / hủy / cước nhập sau, danh sách, chi tiết, export)

**Mã:** 19, 20. **Files:**
- Create: `src/server/purchase/{schemas,freight,codes,service,queries,export}.ts`
- Test: `tests/purchase/{schemas,freight,service,edit,queries}.test.ts`

**Interfaces:**
- Consumes: engine barrel (`withInventoryTx`, `postReceipt`, `removeDocument`, `updateLayerCost`, `productsOfDocument`, `docTimestamp`, `unitCostOf`, `PeriodClosedError`, kiểu `EngineCtx`), `withIdempotentInventoryTx` (Task 10), `convertToBase`/`resolveFactor` (03a), `partnerScope`/`assertCan`, `redactDeep`, `writeAudit`.
- Produces:
  - `purchaseInputSchema`, `purchaseLineSchema`, `cancelPurchaseSchema`, `freightSchema`, kiểu `PurchaseInput`.
  - `allocateFreight(amounts: Decimal[], freight: Decimal): Decimal[]`, `FREIGHT_IN_COST`.
  - `createPurchaseIdempotent(prisma, actor, key, input): Promise<{ id; code }>`, `updatePurchaseTx(prisma, actor, id, input): Promise<{ id }>`, `cancelPurchaseTx(prisma, actor, id, reason): Promise<void>`, `updatePurchaseFreightTx(prisma, actor, id, freightCost): Promise<void>`; các hàm nhận `ctx: EngineCtx` (`createPurchase`, `updatePurchase`, `cancelPurchase`, `updatePurchaseFreight`) để test và plan sau dùng trong transaction lớn hơn.
  - `PURCHASE_FILTER_KEYS`, `listPurchases(db, actor, params)`, `getPurchase(db, actor, id)`, `exportPurchasesXlsx(db, actor, params)`; kiểu `PurchaseRowDTO`, `PurchaseDetailDTO`.

#### 11.1 Phân bổ cước

- [ ] **Step 1: Test (đỏ)** — `tests/purchase/freight.test.ts`

```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { allocateFreight } from "@/server/purchase/freight";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), D(0));
const alloc = (amounts: number[], freight: number) => allocateFreight(amounts.map(D), D(freight)).map((x) => x.toFixed(2));

describe("allocateFreight — theo GIÁ TRỊ dòng hàng, phần dư chia theo 'phần lẻ lớn nhất'", () => {
  it("chia tỉ lệ đúng: 30tr + 10tr, cước 2tr → 1,5tr + 0,5tr", () => {
    expect(alloc([30_000_000, 10_000_000], 2_000_000)).toEqual(["1500000.00", "500000.00"]);
  });

  it("[Review Focus 1] cước 100 chia 3 dòng bằng nhau → 33,34 + 33,33 + 33,33; TỔNG đúng 100", () => {
    const r = alloc([10, 10, 10], 100);
    expect(r).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(r.map(D)).toString()).toBe("100");
  });

  it("tổng luôn đúng cước với dữ liệu lẻ tuỳ ý (100 trường hợp ngẫu nhiên có seed)", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 100; i++) {
      const n = 1 + Math.floor(rnd() * 8);
      const amounts = Array.from({ length: n }, () => Math.round(rnd() * 5_000_000_00) / 100 + 0.01);
      const freight = Math.round(rnd() * 1_000_000_00) / 100;
      const got = allocateFreight(amounts.map(D), D(freight));
      expect(sum(got).toFixed(2), JSON.stringify({ amounts, freight })).toBe(D(freight).toFixed(2));
      for (const g of got) expect(g.gte(0)).toBe(true);
    }
  });

  it("cước 0 → toàn 0 (kể cả khi tiền hàng 0); 1 dòng nhận hết", () => {
    expect(alloc([5, 5], 0)).toEqual(["0.00", "0.00"]);
    expect(alloc([0, 0], 0)).toEqual(["0.00", "0.00"]);
    expect(alloc([123.45], 77.7)).toEqual(["77.70"]);
  });

  it("[Review Focus 1] cước > 0 mà tổng tiền hàng = 0 → lỗi 400 tiếng Việt", () => {
    expect(() => allocateFreight([D(0), D(0)], D(50))).toThrow(expect.objectContaining({ status: 400, message: "Không phân bổ được cước khi tổng tiền hàng bằng 0." }));
  });
});
```

- [ ] **Step 2: Viết `src/server/purchase/freight.ts`**

```ts
import { Prisma } from "@prisma/client";
import { DomainError } from "@/server/http/errors";

/**
 * Spec 3.1 (CHỜ KHÁCH, mặc định CÓ): cước vận chuyển cộng vào giá vốn lô, phân bổ theo GIÁ TRỊ dòng hàng (vì một phiếu có
 * thể trộn kg và md). Đặt false ⇒ cước không vào giá vốn (điểm bật/tắt DUY NHẤT — TODO: confirm với khách).
 */
export const FREIGHT_IN_COST = true;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Chia `freight` (đã làm tròn 2 số lẻ) cho các dòng theo tỉ lệ `amounts`, kết quả 2 số lẻ và TỔNG ĐÚNG BẰNG `freight`:
 * làm tròn XUỐNG từng phần rồi cộng từng 0,01 cho các dòng có phần lẻ lớn nhất (hoà → dòng đứng trước).
 * Cước = 0 → toàn 0. Cước > 0 mà tổng tiền hàng = 0 → lỗi (không có cơ sở chia).
 */
export function allocateFreight(amounts: Prisma.Decimal[], freight: Prisma.Decimal): Prisma.Decimal[] {
  const total = amounts.reduce((a, b) => a.plus(b), D(0));
  if (freight.isZero()) return amounts.map(() => D(0));
  if (!total.gt(0)) throw new DomainError("Không phân bổ được cước khi tổng tiền hàng bằng 0.", 400);
  const exact = amounts.map((a) => freight.times(a).div(total));
  const floored = exact.map((x) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN));
  const cents = freight.minus(floored.reduce((a, b) => a.plus(b), D(0))).times(100).toNumber(); // số 0,01 còn thiếu (< số dòng)
  const order = exact.map((x, i) => ({ i, frac: x.minus(floored[i]!) })).sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (let k = 0; k < cents; k++) {
    const i = order[k % order.length]!.i;
    floored[i] = floored[i]!.plus("0.01");
  }
  return floored;
}
```

- [ ] **Step 3: Chạy → xanh** (`rtk proxy npx vitest run tests/purchase/freight.test.ts`).

#### 11.2 Schema đầu vào + mã chứng từ

- [ ] **Step 4: Test + viết `schemas.ts`, `codes.ts`** — `tests/purchase/schemas.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { purchaseInputSchema } from "@/server/purchase/schemas";

const line = { productId: 1, qty: 3000, unit: "kg", factor: 2.4, purchasePrice: 18500, rollInfo: "" };
const valid = { partnerId: 5, date: "2026-09-01", freightCost: 0, note: "", lines: [line] };
const msgs = (v: unknown) => { const r = purchaseInputSchema.safeParse(v); return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`); };

describe("purchaseInputSchema", () => {
  it("hợp lệ", () => expect(msgs(valid)).toEqual([]));
  it("thiếu NCC / ngày sai / không có dòng", () => {
    expect(msgs({ ...valid, partnerId: undefined })).toContain("partnerId: Chọn nhà cung cấp.");
    expect(msgs({ ...valid, date: "01/09/2026" })).toContain("date: Ngày không hợp lệ.");
    expect(msgs({ ...valid, lines: [] })).toContain("lines: Thêm ít nhất 1 dòng hàng.");
  });
  it("dòng: số lượng > 0, hệ số > 0, giá ≥ 0, phải chọn sản phẩm/đơn vị", () => {
    expect(msgs({ ...valid, lines: [{ ...line, qty: 0 }] })).toContain("lines.0.qty: Số lượng phải lớn hơn 0.");
    expect(msgs({ ...valid, lines: [{ ...line, factor: 0 }] })).toContain("lines.0.factor: Hệ số phải lớn hơn 0.");
    expect(msgs({ ...valid, lines: [{ ...line, purchasePrice: -1 }] })).toContain("lines.0.purchasePrice: Đơn giá không được âm.");
    expect(msgs({ ...valid, lines: [{ ...line, productId: undefined, unit: "" }] })).toEqual(expect.arrayContaining(["lines.0.productId: Chọn sản phẩm.", "lines.0.unit: Chọn đơn vị."]));
  });
  it("cước không âm; 2 dòng cùng mã hàng VẪN hợp lệ (2 cuộn cùng loại, 2 giá)", () => {
    expect(msgs({ ...valid, freightCost: -5 })).toContain("freightCost: Cước không được âm.");
    expect(msgs({ ...valid, lines: [line, { ...line, purchasePrice: 19000 }] })).toEqual([]);
  });
});
```

`src/server/purchase/schemas.ts`:

```ts
import { z } from "zod";

const num = (msg: string) => z.number({ required_error: msg, invalid_type_error: msg });

export const purchaseLineSchema = z.object({
  /** Có khi SỬA phiếu: giữ đúng dòng cũ để giữ vị trí FIFO (seq). Thiếu = dòng mới. */
  id: z.number().int().positive().optional(),
  productId: num("Chọn sản phẩm.").int("Chọn sản phẩm.").positive("Chọn sản phẩm."),
  qty: num("Nhập số lượng.").gt(0, "Số lượng phải lớn hơn 0.").max(999_999_999, "Số lượng quá lớn."),
  unit: z.string({ required_error: "Chọn đơn vị." }).trim().min(1, "Chọn đơn vị.").max(10, "Đơn vị tối đa 10 ký tự."),
  /** Hệ số THỰC TẾ của lần nhập này (mặc định lấy từ sản phẩm, sửa được — spec 6.4). */
  factor: num("Nhập hệ số.").gt(0, "Hệ số phải lớn hơn 0.").max(1_000_000, "Hệ số quá lớn."),
  purchasePrice: num("Nhập đơn giá.").min(0, "Đơn giá không được âm.").max(9_999_999_999, "Đơn giá quá lớn."),
  rollInfo: z.string().trim().max(200, "Ghi chú cuộn tối đa 200 ký tự."),
});

export const purchaseInputSchema = z.object({
  partnerId: num("Chọn nhà cung cấp.").int("Chọn nhà cung cấp.").positive("Chọn nhà cung cấp."),
  /** Ngày chứng từ theo lịch Việt Nam, yyyy-mm-dd. */
  date: z.string({ required_error: "Chọn ngày." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."),
  freightCost: num("Nhập cước.").min(0, "Cước không được âm.").max(9_999_999_999, "Cước quá lớn."),
  note: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự."),
  lines: z.array(purchaseLineSchema).min(1, "Thêm ít nhất 1 dòng hàng.").max(200, "Tối đa 200 dòng."),
});
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export const cancelPurchaseSchema = z.object({ reason: z.string({ required_error: "Nhập lý do hủy." }).trim().min(1, "Nhập lý do hủy.").max(300, "Lý do tối đa 300 ký tự.") });
export const freightSchema = purchaseInputSchema.pick({ freightCost: true });
```

`src/server/purchase/codes.ts`:

```ts
import type { Prisma } from "@prisma/client";

export const formatDocCode = (prefix: string, id: number) => `${prefix}${String(id).padStart(6, "0")}`;

/** Cấp trước id của bảng bằng chính sequence của nó → mã = tiền tố + id, không cần bước cập nhật thứ hai. `table` là hằng của code, KHÔNG nhận từ người dùng. */
export async function nextDocId(tx: Prisma.TransactionClient, table: "purchases" | "stock_adjustments"): Promise<number> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence(${table}, 'id'))::int AS id`;
  return rows[0]!.id;
}
```

- [ ] **Step 5: Chạy → xanh** (`rtk proxy npx vitest run tests/purchase/schemas.test.ts`).

#### 11.3 Tạo phiếu

- [ ] **Step 6: Helper test dùng chung + test tạo phiếu (đỏ)** — `tests/purchase/helpers.ts` là file DÙNG CHUNG (không phải file test: import từ một file `*.test.ts` sẽ chạy lại các test của nó). Các file `tests/purchase/*.test.ts` đều import từ đây.

```ts
// tests/purchase/helpers.ts
import type { Actor } from "@/lib/permissions/scope";
import { toIct } from "@/lib/time";
import type { PurchaseInput } from "@/server/purchase/schemas";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePeriod, makeProduct, makeUser } from "../helpers/factories";

/** yyyy-mm-dd của "hôm nay + offset ngày" theo lịch Việt Nam (ICT). */
export const todayIct = (offsetDays = 0) => {
  const t = toIct(new Date(Date.now() + offsetDays * 86_400_000));
  return `${t.y}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
};

export interface World { actor: Actor; periodId: number; supplierId: number; tonId: number; giayId: number }
export async function world(): Promise<World> {
  await resetDb();
  const user = await makeUser();
  const period = await makePeriod({ openedAt: new Date(Date.now() - 5 * 86_400_000) });
  const supplier = await makePartner({ isCustomer: false, isSupplier: true, name: "Tôn Hoa Sen", searchText: "ton hoa sen" });
  const ton = await makeProduct({ code: "TL045", name: "Tôn lạnh 0.45", baseUnit: "md", searchText: "tl045 ton lanh 0.45" });
  await prisma.productUnit.create({ data: { productId: ton.id, unit: "kg", factor: 2.4 } });
  const giay = await makeProduct({ code: "GB", name: "Giấy bạc", baseUnit: "m2", searchText: "gb giay bac" });
  const actor: Actor = { userId: user.id, perms: new Set(["purchase.view", "purchase.create", "purchase.edit", "purchase.cancel", "purchase_price.view", "cost.view", "partner.view", "partner.view_all"]) };
  return { actor, periodId: period.id, supplierId: supplier.id, tonId: ton.id, giayId: giay.id };
}
export const input = (w: World, over: Partial<PurchaseInput> = {}): PurchaseInput => ({
  partnerId: w.supplierId, date: todayIct(), freightCost: 0, note: "",
  lines: [{ productId: w.tonId, qty: 3000, unit: "kg", factor: 2.4, purchasePrice: 18500, rollInfo: "" }], ...over,
});
```

`tests/purchase/service.test.ts`:

```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import { toIct } from "@/lib/time";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { prisma } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { assertLedgerBalanced } from "../inventory/helpers";
import { input, todayIct, world, type World } from "./helpers";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

let w: World;
beforeEach(async () => { w = await world(); });

describe("createPurchaseIdempotent", () => {
  it("3.000 kg @ 18.500 ÷ 2,4 = 1.250 md: dòng sổ kho, lớp lô giá 44.400/md, công nợ phải trả, mã PN000001, audit", async () => {
    const r = await createPurchaseIdempotent(prisma, w.actor, "k1", input(w));
    expect(r).toEqual({ id: expect.any(Number), code: "PN000001" });
    const p = await prisma.purchase.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
    expect(p).toMatchObject({ periodId: w.periodId, partnerId: w.supplierId, createdBy: w.actor.userId, isCancelled: false });
    expect(p.purchaseTotal.toString()).toBe("55500000");
    const line = p.lines[0]!;
    expect([line.qtyBase.toString(), line.factorUsed.toString(), line.purchaseAmount.toString(), line.seq !== null]).toEqual(["1250", "2.4", "55500000", true]);
    const led = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "PURCHASE", docId: r.id } });
    expect([led.qtyIn.toString(), led.docLineId, led.at.getTime(), led.seq]).toEqual(["1250", line.id, p.at.getTime(), line.seq]);
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: r.id } });
    expect([layer.qtyIn.toString(), layer.unitCost.toString()]).toEqual(["1250", "44400"]);
    const debt = await prisma.partnerLedger.findMany({ where: { docType: "PURCHASE", docId: r.id } });
    expect(debt).toHaveLength(1);
    expect([debt[0]!.credit.toString(), debt[0]!.debit.toString(), debt[0]!.partnerId, debt[0]!.periodId]).toEqual(["55500000", "0", w.supplierId, w.periodId]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "purchase.create" } });
    expect(log).toMatchObject({ entity: "Purchase", entityId: String(r.id) });
    expect(log.afterJson).toMatchObject({ code: "PN000001", purchaseTotal: "55500000", lineCount: 1 });
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("[Review Focus 1] cước phân bổ theo giá trị vào giá vốn từng lô (2 dòng: 30tr + 10tr, cước 2tr)", async () => {
    const r = await createPurchaseIdempotent(prisma, w.actor, "k2", input(w, {
      freightCost: 2_000_000,
      lines: [
        { productId: w.tonId, qty: 1000, unit: "md", factor: 1, purchasePrice: 30_000, rollInfo: "" }, // 30.000.000
        { productId: w.giayId, qty: 500, unit: "m2", factor: 1, purchasePrice: 20_000, rollInfo: "" }, // 10.000.000
      ],
    }));
    const lines = await prisma.purchaseLine.findMany({ where: { purchaseId: r.id }, orderBy: { id: "asc" } });
    expect(lines.map((l) => l.allocatedFreight.toString())).toEqual(["1500000", "500000"]);
    const layers = await prisma.costLayer.findMany({ where: { sourceDocId: r.id }, orderBy: { productId: "asc" } });
    expect(layers.map((l) => l.unitCost.toString())).toEqual(["31500", "21000"]); // (30tr+1,5tr)/1000 ; (10tr+0,5tr)/500
    // công nợ = TIỀN HÀNG, không cộng cước (D-13)
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docId: r.id } })).credit.toString()).toBe("40000000");
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: r.id } })).freightCost.toString()).toBe("2000000");
  });

  it("[Review Focus 4] 1.000 kg ÷ 3 = 333,333 md; giá trị lô không lệch quá 1 đồng so với tiền hàng + cước", async () => {
    const r = await createPurchaseIdempotent(prisma, w.actor, "k3", input(w, {
      freightCost: 12_345.67,
      lines: [{ productId: w.tonId, qty: 1000, unit: "kg", factor: 3, purchasePrice: 10_000, rollInfo: "" }],
    }));
    const l = await prisma.purchaseLine.findFirstOrThrow({ where: { purchaseId: r.id } });
    expect(l.qtyBase.toString()).toBe("333.333");
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: r.id } });
    const lotValue = layer.qtyIn.times(layer.unitCost);
    expect(lotValue.minus(D(10_000_000).plus("12345.67")).abs().lte(1)).toBe(true);
  });

  it("[Review Focus 7] 2 dòng cùng một mã hàng (2 cuộn, 2 giá) → 2 dòng sổ + 2 lớp, đúng thứ tự dòng", async () => {
    const r = await createPurchaseIdempotent(prisma, w.actor, "k4", input(w, {
      lines: [
        { productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 40_000, rollInfo: "Cuộn A" },
        { productId: w.tonId, qty: 200, unit: "md", factor: 1, purchasePrice: 42_000, rollInfo: "Cuộn B" },
      ],
    }));
    const layers = await prisma.costLayer.findMany({ where: { sourceDocId: r.id }, orderBy: { sourceLineId: "asc" } });
    expect(layers.map((l) => [l.qtyIn.toString(), l.unitCost.toString()])).toEqual([["100", "40000"], ["200", "42000"]]);
    const seqs = (await prisma.purchaseLine.findMany({ where: { purchaseId: r.id }, orderBy: { id: "asc" } })).map((l) => l.seq!);
    expect(seqs[0]! < seqs[1]!).toBe(true);
    expect((await prisma.purchaseLine.findMany({ where: { purchaseId: r.id }, orderBy: { id: "asc" } })).map((l) => l.rollSearch)).toEqual(["cuon a", "cuon b"]);
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("[Review Focus 4] đơn vị chưa khai báo / đơn vị gốc mà hệ số ≠ 1 / số lượng quy đổi ra 0 → 400 tiếng Việt, không ghi gì", async () => {
    const bad = async (line: object, msg: RegExp) => {
      await expect(createPurchaseIdempotent(prisma, w.actor, `bad-${Math.random()}`, input(w, { lines: [{ productId: w.tonId, qty: 1, unit: "md", factor: 1, purchasePrice: 1, rollInfo: "", ...line }] }))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(msg) });
    };
    await bad({ unit: "tấn", factor: 1000 }, /chưa khai báo đơn vị "tấn"/);
    await bad({ unit: "md", factor: 2 }, /Đơn vị gốc.*hệ số 1/);
    await bad({ unit: "kg", qty: 0.001, factor: 2.4 }, /quá nhỏ/);
    expect(await prisma.purchase.count()).toBe(0);
    expect(await prisma.stockLedger.count()).toBe(0);
  });

  it("NCC phải là nhà cung cấp đang hoạt động, chưa gộp; sản phẩm phải đang bán", async () => {
    const customer = await makePartner({ isCustomer: true, isSupplier: false });
    const off = await makePartner({ isCustomer: false, isSupplier: true, isActive: false });
    for (const partnerId of [customer.id, off.id, 999999]) {
      await expect(createPurchaseIdempotent(prisma, w.actor, `s-${partnerId}`, input(w, { partnerId }))).rejects.toMatchObject({ status: 400 });
    }
    await prisma.product.update({ where: { id: w.tonId }, data: { isActive: false } });
    await expect(createPurchaseIdempotent(prisma, w.actor, "p", input(w))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/ngừng bán/) });
    expect(await prisma.purchase.count()).toBe(0);
  });

  it("[Review Focus 3] ngày chứng từ: tương lai → lỗi; trước ngày mở kỳ → lỗi; lùi ngày trong kỳ → at = 23:59:59.999 ICT ngày đó", async () => {
    await expect(createPurchaseIdempotent(prisma, w.actor, "f", input(w, { date: todayIct(1) }))).rejects.toMatchObject({ status: 400 });
    await expect(createPurchaseIdempotent(prisma, w.actor, "o", input(w, { date: todayIct(-30) }))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/trước ngày mở kỳ/) });
    const yesterday = todayIct(-1);
    const r = await createPurchaseIdempotent(prisma, w.actor, "y", input(w, { date: yesterday }));
    const at = (await prisma.purchase.findUniqueOrThrow({ where: { id: r.id } })).at;
    const t = toIct(at);
    expect([`${t.y}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`, t.hh, t.mm]).toEqual([yesterday, 23, 59]);
    expect(at.getUTCMilliseconds()).toBe(999);
  });

  it("thiếu quyền: cần purchase.create VÀ purchase_price.view", async () => {
    const noCreate = { ...w.actor, perms: new Set(["purchase_price.view"]) };
    const noPrice = { ...w.actor, perms: new Set(["purchase.create"]) };
    await expect(createPurchaseIdempotent(prisma, noCreate, "a", input(w))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPurchaseIdempotent(prisma, noPrice, "b", input(w))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.purchase.count()).toBe(0);
  });

  it("[Review Focus 2] cùng Idempotency-Key (kể cả gửi ĐỒNG THỜI) → 1 phiếu, 1 lớp, 1 dòng công nợ, cùng kết quả", async () => {
    const rs = await Promise.all(Array.from({ length: 4 }, () => createPurchaseIdempotent(prisma, w.actor, "dup", input(w))));
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect([await prisma.purchase.count(), await prisma.costLayer.count(), await prisma.partnerLedger.count()]).toEqual([1, 1, 1]);
  });

  it("2 phiếu liên tiếp nhận mã PN000001, PN000002", async () => {
    const a = await createPurchaseIdempotent(prisma, w.actor, "a", input(w));
    const b = await createPurchaseIdempotent(prisma, w.actor, "b", input(w));
    expect([a.code, b.code]).toEqual(["PN000001", "PN000002"]);
  });
});
```

- [ ] **Step 7: Chạy → đỏ**; **Step 8: Viết `src/server/purchase/service.ts`** (phần chung + tạo)

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { toIct } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import {
  docTimestamp, PeriodClosedError, postReceipt, productsOfDocument, removeDocument, unitCostOf, updateLayerCost, withInventoryTx,
  type EngineCtx,
} from "@/server/inventory";
import { convertToBase, resolveFactor } from "@/server/products/units";
import { formatDocCode, nextDocId } from "./codes";
import { allocateFreight, FREIGHT_IN_COST } from "./freight";
import type { PurchaseInput } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), D(0));
const ymd = (d: Date) => { const t = toIct(d); return `${t.y}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`; };
const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

/** Lập/sửa phiếu nhập cần biết GIÁ ⇒ cần thêm purchase_price.view (không biết giá thì không nhập giá được). */
function assertWriter(actor: Actor, perm: "purchase.create" | "purchase.edit") {
  assertCan(actor.perms, perm);
  assertCan(actor.perms, "purchase_price.view");
}

async function ensureSupplier(tx: Tx, partnerId: number, alreadyOn?: number) {
  const p = await tx.partner.findUnique({ where: { id: partnerId }, select: { isSupplier: true, isActive: true, mergedIntoId: true } });
  if (!p || !p.isSupplier || p.mergedIntoId !== null) throw new DomainError("Nhà cung cấp không hợp lệ.", 400);
  if (!p.isActive && partnerId !== alreadyOn) throw new DomainError("Nhà cung cấp đã tắt, hãy chọn nhà cung cấp khác.", 400);
}

interface Prepared {
  id?: number; productId: number; qty: Prisma.Decimal; unit: string; factor: Prisma.Decimal; qtyBase: Prisma.Decimal;
  purchasePrice: Prisma.Decimal; purchaseAmount: Prisma.Decimal; rollInfo: string | null;
}
interface Costed extends Prepared { allocatedFreight: Prisma.Decimal; unitCost: Prisma.Decimal }

/** Kiểm dòng + quy đổi về đơn vị gốc (D-12). `keepInactive`: mã ĐÃ có trên phiếu được phép ngừng bán (sửa phiếu cũ). */
async function prepareLines(tx: Tx, lines: PurchaseInput["lines"], keepInactive: Set<number>): Promise<Prepared[]> {
  const products = await tx.product.findMany({ where: { id: { in: sortedUnique(lines.map((l) => l.productId)) } }, include: { units: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  return lines.map((l, i) => {
    const p = byId.get(l.productId);
    if (!p) throw new DomainError(`Dòng ${i + 1}: sản phẩm không tồn tại.`, 400);
    if (!p.isActive && !keepInactive.has(p.id)) throw new DomainError(`Dòng ${i + 1}: sản phẩm ${p.code} đã ngừng bán.`, 400);
    resolveFactor(p, l.unit); // đơn vị phải là đơn vị gốc hoặc đã khai báo (ném 400 "chưa khai báo đơn vị")
    if (l.unit === p.baseUnit && !D(l.factor).eq(1)) throw new DomainError(`Dòng ${i + 1}: đơn vị gốc (${p.baseUnit}) phải có hệ số 1.`, 400);
    const qty = D(l.qty);
    const qtyBase = convertToBase(qty, l.factor);
    if (!qtyBase.gt(0)) throw new DomainError(`Dòng ${i + 1}: số lượng quá nhỏ (quy đổi ra ${p.baseUnit} bằng 0).`, 400);
    return {
      ...(l.id === undefined ? {} : { id: l.id }), productId: p.id, qty, unit: l.unit, factor: D(l.factor), qtyBase,
      purchasePrice: D(l.purchasePrice), purchaseAmount: round2(qty.times(l.purchasePrice)), rollInfo: l.rollInfo || null,
    };
  });
}

/** Phân bổ cước theo giá trị → giá vốn đơn vị của từng lô = (tiền hàng + cước phân bổ) ÷ SL gốc, HALF_UP 4 số (engine `unitCostOf`). */
function costLines(lines: Prepared[], freight: Prisma.Decimal): Costed[] {
  const alloc = FREIGHT_IN_COST ? allocateFreight(lines.map((l) => l.purchaseAmount), freight) : lines.map(() => D(0));
  return lines.map((l, i) => ({ ...l, allocatedFreight: alloc[i]!, unitCost: unitCostOf(l.purchaseAmount.plus(alloc[i]!), l.qtyBase) }));
}

const lineData = (l: Costed) => ({
  productId: l.productId, qty: l.qty, unit: l.unit, factorUsed: l.factor, qtyBase: l.qtyBase, purchasePrice: l.purchasePrice,
  purchaseAmount: l.purchaseAmount, allocatedFreight: l.allocatedFreight, rollInfo: l.rollInfo, rollSearch: normalizeSearch(l.rollInfo ?? ""),
});

/** Ghi lại dòng công nợ phải trả của phiếu: đúng 1 dòng credit = tiền hàng (D-13). Sửa/hủy: xoá rồi ghi lại (D-8 — vết nằm ở audit). */
async function rewritePartnerLedger(tx: Tx, ctx: EngineCtx, actor: Actor, p: { id: number; partnerId: number; at: Date }, total: Prisma.Decimal) {
  await tx.partnerLedger.deleteMany({ where: { docType: "PURCHASE", docId: p.id } });
  if (total.gt(0)) {
    await tx.partnerLedger.create({ data: { periodId: ctx.period.id, partnerId: p.partnerId, credit: total, docType: "PURCHASE", docId: p.id, at: p.at, createdBy: actor.userId } });
  }
}

/** Tóm tắt cho audit — dùng ĐÚNG tên field nhạy cảm đã đăng ký để đường đọc audit (redactDeep) ẩn giá theo quyền. */
const auditSummary = (p: { code: string; partnerId: number; at: Date; freightCost: Prisma.Decimal; purchaseTotal: Prisma.Decimal }, lineCount: number) => ({
  code: p.code, partnerId: p.partnerId, date: ymd(p.at), freightCost: p.freightCost.toString(), purchaseTotal: p.purchaseTotal.toString(), lineCount,
});

// ───────────────────────── tạo ─────────────────────────

/** Chạy TRONG withInventoryTx (ctx đã khoá đủ mã hàng của `input`). */
export async function createPurchase(ctx: EngineCtx, actor: Actor, input: PurchaseInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertWriter(actor, "purchase.create");
  const tx = ctx.tx;
  await ensureSupplier(tx, input.partnerId);
  const lines = costLines(await prepareLines(tx, input.lines, new Set()), D(input.freightCost));
  const at = docTimestamp(input.date, now);
  const total = sum(lines.map((l) => l.purchaseAmount));
  const id = await nextDocId(tx, "purchases");
  const code = formatDocCode("PN", id);
  const header = await tx.purchase.create({
    data: { id, code, periodId: ctx.period.id, partnerId: input.partnerId, at, freightCost: D(input.freightCost), purchaseTotal: total, note: input.note || null, createdBy: actor.userId },
  });
  for (const l of lines) {
    const row = await tx.purchaseLine.create({ data: { purchaseId: id, ...lineData(l) } });
    const { seq } = await postReceipt(ctx, { productId: l.productId, qty: l.qtyBase, unitCost: l.unitCost, docType: "PURCHASE", docId: id, docLineId: row.id, at });
    await tx.purchaseLine.update({ where: { id: row.id }, data: { seq } });
  }
  await rewritePartnerLedger(tx, ctx, actor, header, total);
  await writeAudit(tx, { userId: actor.userId, action: "purchase.create", entity: "Purchase", entityId: id, after: auditSummary(header, lines.length) });
  return { id, code };
}

/** Điểm vào của route: quyền → Idempotency-Key → giao dịch kho (khai báo mã hàng tăng dần). */
export async function createPurchaseIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: PurchaseInput) {
  assertWriter(actor, "purchase.create"); // từ chối SỚM: lặp lại không lách được quyền
  return withIdempotentInventoryTx(
    prisma, { userId: actor.userId, products: sortedUnique(input.lines.map((l) => l.productId)), scope: "purchase.create", key },
    (ctx) => createPurchase(ctx, actor, input),
  );
}
```

Ghi chú: `PeriodClosedError`, `updateLayerCost`, `removeDocument`, `productsOfDocument`, `withInventoryTx` được import ở đầu file để dùng ở 11.4 (sửa/hủy); nếu lint báo "unused" trước khi làm 11.4 thì tạm bỏ khỏi dòng import rồi thêm lại ở bước đó.

- [ ] **Step 9: Chạy → xanh** (`rtk proxy npx vitest run tests/purchase/service.test.ts`); commit:

```bash
git add src/server/purchase tests/purchase
git commit -m "feat(purchase): lập phiếu nhập — quy đổi, phân bổ cước theo giá trị, lớp FIFO, công nợ phải trả, idempotent"
```

#### 11.4 Sửa, hủy, cước nhập sau

- [ ] **Step 10: Test (đỏ)** — `tests/purchase/edit.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { docTimestamp, postIssue, withInventoryTx } from "@/server/inventory";
import { cancelPurchaseTx, createPurchaseIdempotent, updatePurchaseFreightTx, updatePurchaseTx } from "@/server/purchase/service";
import { prisma } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { assertLedgerBalanced, useNoopCostOwners } from "../inventory/helpers";
import { input, todayIct, world, type World } from "./helpers";

useNoopCostOwners(); // test kho: dòng bán chưa có module bán hàng ⇒ khai báo rõ "không có cột giá vốn cần ghi ngược"

let w: World;
beforeEach(async () => { w = await world(); });

const sale = (productId: number, qty: number, docId: number) =>
  withInventoryTx(prisma, { userId: w.actor.userId, products: [productId] }, (ctx) =>
    postIssue(ctx, { productId, qty, docType: "SALE", docId, docLineId: docId, at: docTimestamp(todayIct(), new Date()) }));
const saleCost = async (docId: number) => (await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId } })).unitCostOut.toString();

async function buyTon(over: Partial<Parameters<typeof input>[1]> = {}) {
  return createPurchaseIdempotent(prisma, w.actor, `k-${Math.random()}`, input(w, {
    lines: [{ productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 20_000, rollInfo: "" }], ...over,
  }));
}
const lineOf = async (purchaseId: number) => prisma.purchaseLine.findFirstOrThrow({ where: { purchaseId } });

describe("updatePurchaseTx — sửa phiếu giữa chuỗi", () => {
  it("đổi đơn giá → giá vốn các dòng bán đã ăn lô cập nhật; dòng cũ GIỮ seq (vị trí FIFO); sổ kho cân", async () => {
    const p = await buyTon();
    await sale(w.tonId, 30, 1);
    expect(await saleCost(1)).toBe("20000");
    const before = await lineOf(p.id);
    await updatePurchaseTx(prisma, w.actor, p.id, input(w, {
      lines: [{ id: before.id, productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 25_000, rollInfo: "" }],
    }));
    expect(await saleCost(1)).toBe("25000");
    const after = await lineOf(p.id);
    expect([after.id, after.seq]).toEqual([before.id, before.seq]); // giữ dòng + seq
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).purchaseTotal.toString()).toBe("2500000");
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "PURCHASE", docId: p.id } })).credit.toString()).toBe("2500000");
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("ngày KHÔNG đổi → dùng lại at đã lưu (không xê dịch thứ tự FIFO); ĐỔI ngày → at mới", async () => {
    const p = await buyTon();
    const at0 = (await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).at;
    const l = await lineOf(p.id);
    const same = input(w, { note: "sửa ghi chú", lines: [{ id: l.id, productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 20_000, rollInfo: "" }] });
    await updatePurchaseTx(prisma, w.actor, p.id, same);
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).at.getTime()).toBe(at0.getTime());
    await updatePurchaseTx(prisma, w.actor, p.id, { ...same, date: todayIct(-1) });
    const at1 = (await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).at;
    expect(at1.getTime()).toBeLessThan(at0.getTime());
    expect((await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: p.id } })).at.getTime()).toBe(at1.getTime());
  });

  it("thêm dòng mới, bỏ dòng cũ, đổi NCC → sổ kho/lớp/công nợ khớp; audit có trước/sau", async () => {
    const p = await buyTon({ lines: [
      { productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 20_000, rollInfo: "" },
      { productId: w.giayId, qty: 10, unit: "m2", factor: 1, purchasePrice: 5_000, rollInfo: "" },
    ] });
    const [keep, giayOld] = await prisma.purchaseLine.findMany({ where: { purchaseId: p.id }, orderBy: { id: "asc" } });
    const other = await makePartner({ isCustomer: false, isSupplier: true });
    await updatePurchaseTx(prisma, w.actor, p.id, input(w, {
      partnerId: other.id,
      lines: [{ id: keep!.id, productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 20_000, rollInfo: "" }, { productId: w.giayId, qty: 4, unit: "m2", factor: 1, purchasePrice: 6_000, rollInfo: "mới" }],
    }));
    const lines = await prisma.purchaseLine.findMany({ where: { purchaseId: p.id }, orderBy: { id: "asc" } });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.id).toBe(keep!.id);
    expect(lines[1]!.id).not.toBe(giayOld!.id); // dòng giấy bạc cũ đã bị bỏ, dòng giấy bạc trong input là dòng MỚI (id khác)
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "PURCHASE", docId: p.id } })).partnerId).toBe(other.id);
    expect(await prisma.stockLedger.count({ where: { docType: "PURCHASE", docId: p.id } })).toBe(2);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "purchase.update" } });
    expect(log.beforeJson).toMatchObject({ lineCount: 2 });
    expect(log.afterJson).toMatchObject({ lineCount: 2, purchaseTotal: "2024000" });
    await assertLedgerBalanced(w.giayId, w.periodId);
  });

  it("sửa nhỏ lô đã bán vượt → dòng bán trở thành ĐƠN TREO (không lỗi, không âm tồn ngầm)", async () => {
    const p = await buyTon();
    await sale(w.tonId, 80, 1);
    const l = await lineOf(p.id);
    await updatePurchaseTx(prisma, w.actor, p.id, input(w, { lines: [{ id: l.id, productId: w.tonId, qty: 50, unit: "md", factor: 1, purchasePrice: 20_000, rollInfo: "" }] }));
    const s = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: 1 } });
    expect(s.qtyProvisional.toString()).toBe("30");
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("phiếu đã hủy / không tồn tại → 409 / 404", async () => {
    const p = await buyTon();
    await cancelPurchaseTx(prisma, w.actor, p.id, "nhập nhầm");
    const l = await lineOf(p.id);
    await expect(updatePurchaseTx(prisma, w.actor, p.id, input(w, { lines: [{ id: l.id, productId: w.tonId, qty: 1, unit: "md", factor: 1, purchasePrice: 1, rollInfo: "" }] }))).rejects.toMatchObject({ status: 409 });
    await expect(updatePurchaseTx(prisma, w.actor, 999999, input(w))).rejects.toMatchObject({ status: 404 });
  });

  it("id dòng không thuộc phiếu này → 400", async () => {
    const a = await buyTon(); const b = await buyTon();
    const lb = await lineOf(b.id);
    await expect(updatePurchaseTx(prisma, w.actor, a.id, input(w, { lines: [{ id: lb.id, productId: w.tonId, qty: 1, unit: "md", factor: 1, purchasePrice: 1, rollInfo: "" }] }))).rejects.toMatchObject({ status: 400 });
  });

  it("[Review Focus 6] 2 người sửa CÙNG phiếu đồng thời (đổi cả mã hàng) → không 500/ProductNotLocked, kết quả nhất quán, sổ kho cân", async () => {
    const p = await buyTon();
    const l = await lineOf(p.id);
    const edit = (productId: number, unit: string, price: number) => updatePurchaseTx(prisma, w.actor, p.id, input(w, { lines: [{ id: l.id, productId, qty: 10, unit, factor: 1, purchasePrice: price, rollInfo: "" }] }));
    const rs = await Promise.allSettled([edit(w.giayId, "m2", 7_000), edit(w.tonId, "md", 9_000)]);
    for (const r of rs) if (r.status === "rejected") expect((r.reason as { status?: number }).status, String(r.reason)).toBe(409);
    expect(rs.some((r) => r.status === "fulfilled")).toBe(true);
    const line = await lineOf(p.id);
    const layers = await prisma.costLayer.findMany({ where: { sourceDocId: p.id } });
    expect(layers).toHaveLength(1);
    expect(layers[0]!.productId).toBe(line.productId);
    await assertLedgerBalanced(w.tonId, w.periodId);
    await assertLedgerBalanced(w.giayId, w.periodId);
  });

  it("[Review Focus 3] phiếu của kỳ đã kết sổ: sửa/hủy → 'Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.', không ghi gì", async () => {
    const p = await buyTon();
    const l = await lineOf(p.id);
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null, closedAt: new Date() } });
    await prisma.period.create({ data: { name: "Kỳ mới", status: "OPEN", isOpen: true } });
    const layersBefore = await prisma.costLayer.count();
    await expect(updatePurchaseTx(prisma, w.actor, p.id, input(w, { lines: [{ id: l.id, productId: w.tonId, qty: 1, unit: "md", factor: 1, purchasePrice: 1, rollInfo: "" }] }))).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    await expect(cancelPurchaseTx(prisma, w.actor, p.id, "x")).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    await expect(updatePurchaseFreightTx(prisma, w.actor, p.id, 1000)).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    expect(await prisma.costLayer.count()).toBe(layersBefore);
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).isCancelled).toBe(false);
  });
});

describe("cancelPurchaseTx — hủy phiếu", () => {
  it("gỡ dòng sổ + lớp + công nợ; phiếu đánh dấu đã hủy kèm lý do/người hủy; audit; dòng bán đã ăn lô thành đơn treo", async () => {
    const p = await buyTon();
    await sale(w.tonId, 40, 1);
    await cancelPurchaseTx(prisma, w.actor, p.id, "nhập nhầm NCC");
    const row = await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.isCancelled, row.cancelReason, row.cancelledBy]).toEqual([true, "nhập nhầm NCC", w.actor.userId]);
    expect(await prisma.stockLedger.count({ where: { docType: "PURCHASE", docId: p.id } })).toBe(0);
    expect(await prisma.costLayer.count({ where: { sourceDocId: p.id } })).toBe(0);
    expect(await prisma.partnerLedger.count({ where: { docType: "PURCHASE", docId: p.id } })).toBe(0);
    expect((await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: 1 } })).qtyProvisional.toString()).toBe("40");
    expect(await prisma.auditLog.count({ where: { action: "purchase.cancel", entityId: String(p.id) } })).toBe(1);
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("hủy 2 lần → 409; thiếu purchase.cancel → Forbidden", async () => {
    const p = await buyTon();
    await expect(cancelPurchaseTx(prisma, { ...w.actor, perms: new Set(["purchase.edit"]) }, p.id, "x")).rejects.toMatchObject({ status: 403 });
    await cancelPurchaseTx(prisma, w.actor, p.id, "x");
    await expect(cancelPurchaseTx(prisma, w.actor, p.id, "y")).rejects.toMatchObject({ status: 409 });
  });
});

describe("updatePurchaseFreightTx — cước nhập SAU phiếu hàng (spec 3.1)", () => {
  it("[Review Focus 1] cập nhật giá vốn lô + giá vốn dòng bán đã ăn lô đó; phân bổ lại theo giá trị; sổ kho cân", async () => {
    const p = await buyTon({ lines: [
      { productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: 30_000, rollInfo: "" },
      { productId: w.giayId, qty: 100, unit: "m2", factor: 1, purchasePrice: 10_000, rollInfo: "" },
    ] });
    await sale(w.tonId, 40, 1);
    expect(await saleCost(1)).toBe("30000");
    await updatePurchaseFreightTx(prisma, w.actor, p.id, 400_000); // 300k cho tôn, 100k cho giấy (tỉ lệ 3:1)
    const lines = await prisma.purchaseLine.findMany({ where: { purchaseId: p.id }, orderBy: { id: "asc" } });
    expect(lines.map((l) => l.allocatedFreight.toString())).toEqual(["300000", "100000"]);
    expect(await saleCost(1)).toBe("33000"); // (3.000.000 + 300.000) / 100
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } })).freightCost.toString()).toBe("400000");
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docId: p.id } })).credit.toString()).toBe("4000000"); // công nợ KHÔNG đổi (D-13)
    expect(await prisma.auditLog.count({ where: { action: "purchase.update_freight" } })).toBe(1);
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("đặt cước lại về 0 → hoàn giá vốn; cước < 0 bị zod chặn ở route (service không nhận âm)", async () => {
    const p = await buyTon();
    await updatePurchaseFreightTx(prisma, w.actor, p.id, 100_000);
    expect((await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: p.id } })).unitCost.toString()).toBe("21000");
    await updatePurchaseFreightTx(prisma, w.actor, p.id, 0);
    expect((await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: p.id } })).unitCost.toString()).toBe("20000");
    await expect(updatePurchaseFreightTx(prisma, w.actor, p.id, -1)).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 11: Chạy → đỏ**; **Step 12: Viết tiếp `service.ts` — sửa / hủy / cước nhập sau** (nối vào cuối file 11.3):

```ts
// ───────────────────────── sửa ─────────────────────────

async function lockPurchase(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`; // tuần tự hoá sửa/hủy đồng thời CÙNG phiếu (engine-fifo.md §5)
  const p = await tx.purchase.findUnique({ where: { id }, include: { lines: true } });
  if (!p) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  return p;
}

/** Mã cũ của phiếu phải nằm trong tập đã khoá — nếu không, người khác vừa đổi mã hàng của phiếu giữa lúc ta khai báo và lúc khoá. */
async function assertOldProductsLocked(ctx: EngineCtx, id: number) {
  const now = await productsOfDocument(ctx.tx, "PURCHASE", id);
  if (now.some((p) => !ctx.locked.has(p))) throw new DomainError("Phiếu vừa được người khác sửa, hãy tải lại trang rồi thử lại.", 409);
}

export async function updatePurchase(ctx: EngineCtx, actor: Actor, id: number, input: PurchaseInput, now: Date = new Date()): Promise<{ id: number }> {
  assertWriter(actor, "purchase.edit");
  const tx = ctx.tx;
  const cur = await lockPurchase(tx, id);
  if (cur.isCancelled) throw new DomainError("Phiếu đã hủy, không sửa được.", 409);
  if (cur.periodId !== ctx.period.id) throw new PeriodClosedError();
  await assertOldProductsLocked(ctx, id);

  const owned = new Map(cur.lines.map((l) => [l.id, l]));
  for (const l of input.lines) if (l.id !== undefined && !owned.has(l.id)) throw new DomainError("Dòng hàng không thuộc phiếu này.", 400);
  await ensureSupplier(tx, input.partnerId, cur.partnerId);
  const lines = costLines(await prepareLines(tx, input.lines, new Set(cur.lines.map((l) => l.productId))), D(input.freightCost));
  // Ngày KHÔNG đổi ⇒ dùng lại `at` đã lưu (engine-fifo.md §8 mục 4); đổi ngày ⇒ docTimestamp
  const at = ymd(cur.at) === input.date ? cur.at : docTimestamp(input.date, now);
  const total = sum(lines.map((l) => l.purchaseAmount));
  const before = auditSummary(cur, cur.lines.length);

  await removeDocument(ctx, "PURCHASE", id); // gỡ dòng sổ + lớp + consumption; tính lại chuỗi ở flush
  const kept = new Set(lines.flatMap((l) => (l.id === undefined ? [] : [l.id])));
  await tx.purchaseLine.deleteMany({ where: { purchaseId: id, id: { notIn: [...kept] } } });
  for (const l of lines) {
    const row = l.id === undefined
      ? await tx.purchaseLine.create({ data: { purchaseId: id, ...lineData(l) } })
      : await tx.purchaseLine.update({ where: { id: l.id }, data: lineData(l) });
    // engine tự dùng lại seq theo khoá (docType, docId, docLineId, productId) ⇒ dòng giữ nguyên vị trí FIFO
    const { seq } = await postReceipt(ctx, { productId: l.productId, qty: l.qtyBase, unitCost: l.unitCost, docType: "PURCHASE", docId: id, docLineId: row.id, at });
    await tx.purchaseLine.update({ where: { id: row.id }, data: { seq } });
  }
  const header = await tx.purchase.update({ where: { id }, data: { partnerId: input.partnerId, at, freightCost: D(input.freightCost), purchaseTotal: total, note: input.note || null } });
  await rewritePartnerLedger(tx, ctx, actor, header, total);
  await writeAudit(tx, { userId: actor.userId, action: "purchase.update", entity: "Purchase", entityId: id, before, after: auditSummary(header, lines.length) });
  return { id };
}

/** Điểm vào: khai báo mã cũ + mã mới (tăng dần) và kỳ của phiếu (kỳ đã đóng ⇒ PeriodClosedError trước khi ghi gì). */
export async function updatePurchaseTx(prisma: PrismaClient, actor: Actor, id: number, input: PurchaseInput) {
  assertWriter(actor, "purchase.edit");
  const pre = await prisma.purchase.findUnique({ where: { id }, select: { periodId: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const products = sortedUnique([...(await productsOfDocument(prisma, "PURCHASE", id)), ...input.lines.map((l) => l.productId)]);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products }, (ctx) => updatePurchase(ctx, actor, id, input));
}

// ───────────────────────── hủy ─────────────────────────

export async function cancelPurchase(ctx: EngineCtx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "purchase.cancel");
  const tx = ctx.tx;
  const cur = await lockPurchase(tx, id);
  if (cur.isCancelled) throw new DomainError("Phiếu đã hủy trước đó.", 409);
  if (cur.periodId !== ctx.period.id) throw new PeriodClosedError();
  await assertOldProductsLocked(ctx, id);
  await removeDocument(ctx, "PURCHASE", id); // dòng bán từng ăn lô này sẽ thành đơn treo (engine tính lại)
  await tx.partnerLedger.deleteMany({ where: { docType: "PURCHASE", docId: id } });
  await tx.purchase.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "purchase.cancel", entity: "Purchase", entityId: id, before: auditSummary(cur, cur.lines.length), after: { isCancelled: true, reason } });
}

export async function cancelPurchaseTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "purchase.cancel");
  const pre = await prisma.purchase.findUnique({ where: { id }, select: { periodId: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const products = await productsOfDocument(prisma, "PURCHASE", id);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products }, (ctx) => cancelPurchase(ctx, actor, id, reason));
}

// ───────────────────────── cước nhập sau ─────────────────────────

/** Cước vận chuyển nhập SAU phiếu hàng: phân bổ lại theo giá trị → `updateLayerCost` từng lô → engine tính lại chuỗi (spec 3.1, 3.7 "cước nhập sau"). Công nợ NCC không đổi (D-13). */
export async function updatePurchaseFreight(ctx: EngineCtx, actor: Actor, id: number, freightCost: number): Promise<void> {
  assertWriter(actor, "purchase.edit");
  if (!(freightCost >= 0)) throw new DomainError("Cước không được âm.", 400);
  const tx = ctx.tx;
  const cur = await lockPurchase(tx, id);
  if (cur.isCancelled) throw new DomainError("Phiếu đã hủy, không sửa được.", 409);
  if (cur.periodId !== ctx.period.id) throw new PeriodClosedError();
  await assertOldProductsLocked(ctx, id);

  const freight = D(freightCost);
  const alloc = FREIGHT_IN_COST ? allocateFreight(cur.lines.map((l) => l.purchaseAmount), freight) : cur.lines.map(() => D(0));
  for (const [i, l] of cur.lines.entries()) {
    await tx.purchaseLine.update({ where: { id: l.id }, data: { allocatedFreight: alloc[i]! } });
    await updateLayerCost(ctx, { docType: "PURCHASE", docId: id, docLineId: l.id, unitCost: unitCostOf(l.purchaseAmount.plus(alloc[i]!), l.qtyBase) });
  }
  await tx.purchase.update({ where: { id }, data: { freightCost: freight } });
  await writeAudit(tx, { userId: actor.userId, action: "purchase.update_freight", entity: "Purchase", entityId: id, before: { freightCost: cur.freightCost.toString() }, after: { freightCost: freight.toString() } });
}

export async function updatePurchaseFreightTx(prisma: PrismaClient, actor: Actor, id: number, freightCost: number) {
  assertWriter(actor, "purchase.edit");
  const pre = await prisma.purchase.findUnique({ where: { id }, select: { periodId: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const products = await productsOfDocument(prisma, "PURCHASE", id);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products }, (ctx) => updatePurchaseFreight(ctx, actor, id, freightCost));
}
```

- [ ] **Step 13: Chạy → xanh** (`rtk proxy npx vitest run tests/purchase tests/inventory`) — nếu test đồng thời (Review Focus 6) đỏ vì `EngineBusyError` hoặc lỗi khác ngoài 409, đọc thông điệp và xử lý **ở module này** (không sửa engine); ghi kết quả vào `.superpowers/sdd/03b/progress.md`. Commit:

```bash
git add src/server/purchase tests/purchase
git commit -m "feat(purchase): sửa/hủy phiếu nhập giữa chuỗi + cước nhập sau — engine tính lại, khoá dòng, kỳ đã kết sổ bị chặn"
```

#### 11.5 Danh sách, chi tiết, export (đã lọc theo quyền)

- [ ] **Step 14: Test (đỏ)** — `tests/purchase/queries.test.ts`

```ts
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import type { Actor } from "@/lib/permissions/scope";
import { exportPurchasesXlsx } from "@/server/purchase/export";
import { getPurchase, listPurchases, PURCHASE_FILTER_KEYS } from "@/server/purchase/queries";
import { createPurchaseIdempotent, cancelPurchaseTx } from "@/server/purchase/service";
import { prisma } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { input, world, type World } from "./helpers";

const P = (sp: Record<string, string> = {}) => parseListParams(sp, PURCHASE_FILTER_KEYS);
let w: World;
let stockKeeper: Actor; // có purchase.view nhưng KHÔNG có purchase_price.view / cost.view

beforeEach(async () => {
  w = await world();
  stockKeeper = { userId: w.actor.userId, perms: new Set(["purchase.view"]) };
});
const make = (key: string, over = {}) => createPurchaseIdempotent(prisma, w.actor, key, input(w, over));

describe("listPurchases", () => {
  it("mặc định chỉ kỳ ĐANG MỞ; ?period=all hiện mọi kỳ", async () => {
    await make("a");
    const old = await prisma.period.create({ data: { name: "Cũ", status: "CLOSED", isOpen: null } });
    const p2 = await prisma.purchase.create({ data: { code: "PN999", periodId: old.id, partnerId: w.supplierId, at: new Date("2026-01-01"), createdBy: w.actor.userId } });
    expect((await listPurchases(prisma, w.actor, P())).rows.map((r) => r.code)).toEqual(["PN000001"]);
    expect((await listPurchases(prisma, w.actor, P({ period: "all" }))).total).toBe(2);
    expect((await listPurchases(prisma, w.actor, P({ period: String(old.id) }))).rows[0]!.id).toBe(p2.id);
  });

  it("[Review Focus 1 của 03a] tìm theo mã phiếu và tên NCC KHÔNG dấu", async () => {
    const other = await makePartner({ isCustomer: false, isSupplier: true, name: "Đông Á", searchText: "dong a" });
    await make("a"); await make("b", { partnerId: other.id });
    expect((await listPurchases(prisma, w.actor, P({ q: "hoa sen" }))).rows).toHaveLength(1);
    expect((await listPurchases(prisma, w.actor, P({ q: "ĐÔNG" }))).rows.map((r) => r.partnerName)).toEqual(["Đông Á"]);
    expect((await listPurchases(prisma, w.actor, P({ q: "pn000002" }))).rows.map((r) => r.code)).toEqual(["PN000002"]);
  });

  it("trạng thái Hiệu lực/Đã hủy + thống kê không lệch theo bộ lọc trạng thái", async () => {
    const a = await make("a"); await make("b");
    await cancelPurchaseTx(prisma, w.actor, a.id, "sai");
    const r = await listPurchases(prisma, w.actor, P({ status: "cancelled" }));
    expect(r.rows.map((x) => x.code)).toEqual(["PN000001"]);
    expect(r.stats).toEqual({ all: 2, active: 1, cancelled: 1 });
  });

  it("[Review Focus 5] người KHÔNG có purchase_price.view: DTO không chứa tổng tiền/cước/giá; KHÔNG sắp xếp được theo cột tiền", async () => {
    await make("a", { freightCost: 1000 });
    const r = await listPurchases(prisma, stockKeeper, P({ sort: "purchaseTotal" }));
    const json = JSON.stringify(r.rows);
    expect(json).not.toMatch(/purchaseTotal|freightCost|55500000/);
    expect(r.rows[0]).toMatchObject({ code: "PN000001", partnerName: "Tôn Hoa Sen", lineCount: 1 });
    // sort theo cột tiền bị bỏ qua (không lộ thứ tự): kết quả y hệt sort mặc định
    expect((await listPurchases(prisma, stockKeeper, P({ sort: "-purchaseTotal" }))).rows.map((x) => x.id)).toEqual(r.rows.map((x) => x.id));
    // có quyền: thấy tổng tiền
    expect((await listPurchases(prisma, w.actor, P())).rows[0]).toMatchObject({ purchaseTotal: "55500000", freightCost: "1000" });
  });

  it("phân trang server + đếm dòng (lineCount) + tên người lập", async () => {
    for (let i = 0; i < 25; i++) await make(`k${i}`);
    const r = await listPurchases(prisma, w.actor, { ...P(), page: 2, pageSize: 20 });
    expect([r.total, r.rows.length]).toEqual([25, 5]);
    expect(r.rows[0]!.createdByName).toBeTruthy();
  });
});

describe("getPurchase", () => {
  it("có quyền giá: dòng có purchasePrice, purchaseAmount, allocatedFreight, unitCost (giá vốn/đơn vị gốc)", async () => {
    const p = await make("a", { freightCost: 555_000 });
    const d = await getPurchase(prisma, w.actor, p.id);
    expect(d).toMatchObject({ code: "PN000001", partnerName: "Tôn Hoa Sen", isCancelled: false, purchaseTotal: "55500000", freightCost: "555000" });
    expect(d.lines[0]).toMatchObject({ productCode: "TL045", qty: "3000", unit: "kg", factorUsed: "2.4", qtyBase: "1250", baseUnit: "md", purchasePrice: "18500", purchaseAmount: "55500000", allocatedFreight: "555000", unitCost: "44844" });
  });

  it("[Review Focus 5] thiếu purchase_price.view/cost.view: chi tiết chỉ còn số lượng, KHÔNG có bất kỳ trường giá nào", async () => {
    const p = await make("a", { freightCost: 555_000 });
    const d = await getPurchase(prisma, stockKeeper, p.id);
    expect(JSON.stringify(d)).not.toMatch(/purchasePrice|purchaseAmount|purchaseTotal|freightCost|allocatedFreight|unitCost/);
    expect(d.lines[0]).toMatchObject({ qty: "3000", qtyBase: "1250", unit: "kg" });
  });

  it("không tồn tại → 404", async () => {
    await expect(getPurchase(prisma, w.actor, 9999)).rejects.toMatchObject({ status: 404 });
  });
});

describe("exportPurchasesXlsx", () => {
  it("[Review Focus 5] file xuất của người không có quyền giá KHÔNG có cột tiền; người có quyền có", async () => {
    await make("a");
    const load = async (actor: Actor) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await exportPurchasesXlsx(prisma, actor, P())) as unknown as ArrayBuffer);
      return (wb.worksheets[0]!.getRow(1).values as unknown[]).slice(1).map(String);
    };
    expect(await load(w.actor)).toEqual(expect.arrayContaining(["Mã phiếu", "Tổng tiền hàng", "Cước"]));
    const cols = await load(stockKeeper);
    expect(cols).toContain("Mã phiếu");
    expect(cols).not.toContain("Tổng tiền hàng");
    expect(cols).not.toContain("Cước");
  });
});
```

- [ ] **Step 15: Viết `src/server/purchase/queries.ts`** và `export.ts`

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { timeRangeWhere } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";
import { unitCostOf } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;

export const PURCHASE_FILTER_KEYS = ["status", "period", "supplier"] as const;

export interface PurchaseRowDTO {
  id: number; code: string; at: Date; periodId: number; partnerId: number; partnerCode: string; partnerName: string;
  lineCount: number; isCancelled: boolean; note: string | null; createdByName: string | null;
  /** Nhạy cảm — bị `redactDeep` loại nếu thiếu purchase_price.view. */
  purchaseTotal?: string; freightCost?: string;
}
export interface PurchaseLineDTO {
  id: number; productId: number; productCode: string; productName: string; baseUnit: string;
  qty: string; unit: string; factorUsed: string; qtyBase: string; rollInfo: string | null;
  purchasePrice?: string; purchaseAmount?: string; allocatedFreight?: string; unitCost?: string;
}
export interface PurchaseDetailDTO extends Omit<PurchaseRowDTO, "lineCount"> {
  cancelReason: string | null; cancelledAt: Date | null; lines: PurchaseLineDTO[];
}

/** Mỗi từ khoá phải khớp mã phiếu (viết hoa) HOẶC tên/mã NCC không dấu. */
function searchWhere(q: string | undefined): Prisma.PurchaseWhereInput {
  const terms = normalizeSearch(q ?? "").split(" ").filter(Boolean);
  if (terms.length === 0) return {};
  return { AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })) };
}

async function periodWhere(db: Db, params: ListParams): Promise<Prisma.PurchaseWhereInput> {
  const raw = params.filters.period?.[0];
  if (raw === "all") return {};
  const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { periodId: Number.isSafeInteger(n) && n > 0 ? n : (await getOpenPeriod(db)).id }; // mặc định: kỳ đang mở
}

export async function purchaseWhere(db: Db, params: ListParams, opts: { ignoreStatus?: boolean } = {}): Promise<Prisma.PurchaseWhereInput> {
  const and: Prisma.PurchaseWhereInput[] = [await periodWhere(db, params), searchWhere(params.q)];
  const range = listTimeRange(params);
  if (range) and.push({ at: timeRangeWhere(range) });
  const suppliers = (params.filters.supplier ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (suppliers.length) and.push({ partnerId: { in: suppliers } });
  const status = params.filters.status?.[0];
  if (!opts.ignoreStatus && (status === "active" || status === "cancelled")) and.push({ isCancelled: status === "cancelled" });
  return { AND: and };
}

const userNames = async (db: Db, ids: number[]) =>
  new Map((await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

export async function listPurchases(db: Db, actor: Actor, params: ListParams) {
  const canSeePrice = actor.perms.has("purchase_price.view");
  // KHÔNG cho sắp xếp theo cột tiền khi thiếu quyền giá — thứ tự sắp xếp cũng là một cách lộ số liệu
  const sortable = ["code", "at", ...(canSeePrice ? ["purchaseTotal"] : [])];
  const where = await purchaseWhere(db, params);
  const base = await purchaseWhere(db, params, { ignoreStatus: true });
  const [rows, total, all, cancelled] = await Promise.all([
    db.purchase.findMany({
      where, orderBy: [sortToOrderBy(params.sort, sortable, { at: "desc" }), { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
    }),
    db.purchase.count({ where }),
    db.purchase.count({ where: base }),
    db.purchase.count({ where: { AND: [base, { isCancelled: true }] } }),
  ]);
  const names = await userNames(db, rows.map((r) => r.createdBy));
  const dto: PurchaseRowDTO[] = rows.map((p) => ({
    id: p.id, code: p.code, at: p.at, periodId: p.periodId, partnerId: p.partnerId, partnerCode: p.partner.code, partnerName: p.partner.name,
    lineCount: p._count.lines, isCancelled: p.isCancelled, note: p.note, createdByName: names.get(p.createdBy) ?? null,
    purchaseTotal: p.purchaseTotal.toString(), freightCost: p.freightCost.toString(),
  }));
  return { rows: redactDeep(dto, actor.perms), total, stats: { all, active: all - cancelled, cancelled } };
}

export async function getPurchase(db: Db, actor: Actor, id: number): Promise<PurchaseDetailDTO> {
  const p = await db.purchase.findUnique({
    where: { id },
    include: { partner: { select: { code: true, name: true } }, lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, baseUnit: true } } } } },
  });
  if (!p) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const names = await userNames(db, [p.createdBy]);
  const dto: PurchaseDetailDTO = {
    id: p.id, code: p.code, at: p.at, periodId: p.periodId, partnerId: p.partnerId, partnerCode: p.partner.code, partnerName: p.partner.name,
    isCancelled: p.isCancelled, note: p.note, createdByName: names.get(p.createdBy) ?? null, cancelReason: p.cancelReason, cancelledAt: p.cancelledAt,
    purchaseTotal: p.purchaseTotal.toString(), freightCost: p.freightCost.toString(),
    lines: p.lines.map((l) => ({
      id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, baseUnit: l.product.baseUnit,
      qty: l.qty.toString(), unit: l.unit, factorUsed: l.factorUsed.toString(), qtyBase: l.qtyBase.toString(), rollInfo: l.rollInfo,
      purchasePrice: l.purchasePrice.toString(), purchaseAmount: l.purchaseAmount.toString(), allocatedFreight: l.allocatedFreight.toString(),
      unitCost: unitCostOf(l.purchaseAmount.plus(l.allocatedFreight), l.qtyBase).toString(), // giá vốn/đơn vị gốc của lô
    })),
  };
  return redactDeep(dto, actor.perms);
}
```

`src/server/purchase/export.ts` — cùng `purchaseWhere`, cột tiền chỉ thêm khi có `purchase_price.view`; export cũng đi qua `redactDeep`:

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx, type XlsxColumn } from "@/server/export/xlsx";
import { purchaseWhere } from "./queries";

const MAX_EXPORT = 20_000;

export async function exportPurchasesXlsx(db: Prisma.TransactionClient | PrismaClient, actor: Actor, params: ListParams): Promise<Buffer> {
  const price = actor.perms.has("purchase_price.view");
  const rows = await db.purchase.findMany({
    where: await purchaseWhere(db, params), orderBy: [{ at: "desc" }, { id: "desc" }], take: MAX_EXPORT,
    include: { partner: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
  });
  const columns: XlsxColumn[] = [
    { header: "Mã phiếu", key: "code", width: 14, text: true },
    { header: "Ngày", key: "at", width: 14 },
    { header: "Mã NCC", key: "partnerCode", width: 14, text: true },
    { header: "Nhà cung cấp", key: "partnerName", width: 30 },
    { header: "Số dòng", key: "lineCount", width: 10 },
    ...(price ? [{ header: "Tổng tiền hàng", key: "purchaseTotal", width: 18, numFmt: "#,##0" }, { header: "Cước", key: "freightCost", width: 14, numFmt: "#,##0" }] : []),
    { header: "Trạng thái", key: "status", width: 12 },
    { header: "Ghi chú", key: "note", width: 30 },
  ];
  return buildXlsx("Phiếu nhập", columns, rows.map((p) => ({
    code: p.code, at: p.at, partnerCode: p.partner.code, partnerName: p.partner.name, lineCount: p._count.lines,
    ...(price ? { purchaseTotal: p.purchaseTotal, freightCost: p.freightCost } : {}),
    status: p.isCancelled ? "Đã hủy" : "Hiệu lực", note: p.note,
  })));
}
```
- [ ] **Step 16: Chạy → xanh, lint, typecheck, commit**

```bash
rtk proxy npx vitest run tests/purchase
rtk proxy npm run lint && rtk proxy npm run typecheck
git add src/server/purchase tests/purchase
git commit -m "feat(purchase): danh sách/chi tiết/export phiếu nhập — lọc theo quyền giá ở tầng server, không sắp xếp theo cột tiền khi thiếu quyền"
```

---

### Task 12: Phiếu nhập hàng — API và giao diện (danh sách, lập phiếu, chi tiết, sửa, hủy, cước nhập sau)

**Mã:** 19, 20. **Files:**
- Modify: `src/lib/time.ts` (thêm `ictYmd`), `tests/lib/time.test.ts`; `src/server/purchase/service.ts` (dùng `ictYmd`); `src/server/products/queries.ts` (thêm `productOptionsByIds`); `src/components/ui/index.ts`
- Create: `src/components/ui/ReasonDialog.tsx`
- Create: `src/app/api/purchases/route.ts`, `src/app/api/purchases/[id]/section-update/route.ts`, `src/app/api/purchases/[id]/cancel/route.ts`, `src/app/api/purchases/export/route.ts`
- Create: `src/components/purchase/{PurchaseFormFields,PurchaseNewForm,PurchaseTable,PurchaseDetail}.tsx`
- Create: `src/app/(app)/purchase/orders/{page.tsx,new/page.tsx,[id]/page.tsx}`
- Modify: `src/config/app.config.ts` (bỏ `planned` của `purchase-new`, `purchase-list`)
- Test: `tests/ui/{purchase-form,purchase-detail,purchase-pages,reason-dialog}.test.tsx`

**Interfaces:**
- Consumes: Task 11 (service/queries/schemas), `searchProducts` (`/api/products/search`), `searchPartners` (`/api/partner-lists/suppliers/search`), `EditableSection`, `Field`, `Combobox`, `NewPage`, `DetailPage`.
- Produces: `POST /api/purchases` (Idempotency-Key) → `{ id, code }`; `PATCH /api/purchases/:id/section-update` body `{ section: "content", …purchaseInput } | { section: "freight", freightCost }`; `POST /api/purchases/:id/cancel` body `{ reason }`; `GET /api/purchases/export`; `ictYmd(date: Date): string`; component `ReasonDialog`; `PurchaseFormFields` (dùng lại cho nhập không NCC nếu cần).

- [ ] **Step 1: `ictYmd` + `productOptionsByIds` (nền cho form).**

Test thêm vào `tests/lib/time.test.ts`:

```ts
import { ictYmd } from "@/lib/time";

describe("ictYmd", () => {
  it("ngày theo lịch Việt Nam, không theo múi giờ máy", () => {
    expect(ictYmd(new Date("2026-09-30T16:59:59Z"))).toBe("2026-09-30");
    expect(ictYmd(new Date("2026-09-30T17:00:00Z"))).toBe("2026-10-01"); // 00:00 ICT ngày kế tiếp
    expect(ictYmd(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });
});
```

Thêm vào `src/lib/time.ts`:

```ts
/** yyyy-mm-dd theo lịch Việt Nam (ICT) của một thời điểm. */
export function ictYmd(date: Date): string {
  const t = toIct(date);
  return `${t.y}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
}
```

Trong `src/server/purchase/service.ts` xoá hàm cục bộ `ymd`, thêm `import { ictYmd } from "@/lib/time";` (bỏ `toIct` nếu không còn dùng) và đổi mọi `ymd(` thành `ictYmd(`. Trong `tests/purchase/helpers.ts` thay `todayIct` bằng `(offset = 0) => ictYmd(new Date(Date.now() + offset * 86_400_000))`.

Thêm vào `src/server/products/queries.ts` (form sửa phiếu cần đơn vị của các mã ĐÃ có trên phiếu, kể cả mã đã ngừng bán):

```ts
/** Như searchProducts nhưng theo danh sách id, KHÔNG lọc đang-bán (dùng khi mở lại chứng từ cũ). */
export async function productOptionsByIds(db: Db, ids: number[]): Promise<ProductOption[]> {
  const rows = await db.product.findMany({ where: { id: { in: [...new Set(ids)] } }, include: { units: true } });
  return rows.map((p) => ({
    value: p.id, label: `${p.code} — ${p.name}`, hint: p.baseUnit, baseUnit: p.baseUnit, kind: p.kind,
    units: p.units.map((u) => ({ unit: u.unit, factor: u.factor.toString() })),
  }));
}
```
(và test 1 dòng trong `tests/products/queries.test.ts`: mã ngừng bán vẫn được trả.)

Run: `rtk proxy npx vitest run tests/lib/time.test.ts tests/products tests/purchase` → xanh.

- [ ] **Step 2: `ReasonDialog` dùng chung (hủy chứng từ có lý do)** — test `tests/ui/reason-dialog.test.tsx` rồi component:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReasonDialog } from "@/components/ui/ReasonDialog";

afterEach(cleanup);
const open = (onConfirm = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) =>
  render(<ReasonDialog open title="Hủy phiếu PN000001?" confirmLabel="Hủy phiếu" onClose={onClose} onConfirm={onConfirm} />);

describe("ReasonDialog", () => {
  it("bắt buộc nhập lý do: để trống → lỗi tiếng Việt, KHÔNG gọi onConfirm", async () => {
    const onConfirm = vi.fn();
    open(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu" }));
    expect(await screen.findByText("Nhập lý do.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("nhập lý do → onConfirm(lý do đã cắt khoảng trắng); chỉ gọi 1 lần dù bấm liên tiếp", async () => {
    let done!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { done = r; }));
    open(onConfirm);
    await userEvent.type(screen.getByLabelText("Lý do"), "  nhập nhầm NCC  ");
    const btn = screen.getByRole("button", { name: "Hủy phiếu" });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("nhập nhầm NCC");
    done();
  });

  it("onConfirm lỗi → hiện thông điệp lỗi trong hộp thoại, không đóng", async () => {
    const onClose = vi.fn();
    open(vi.fn().mockRejectedValue(new Error("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.")), onClose);
    await userEvent.type(screen.getByLabelText("Lý do"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu" }));
    expect(await screen.findByText("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

```tsx
// src/components/ui/ReasonDialog.tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  onClose: () => void;
  /** Ném Error(message tiếng Việt) khi lỗi — hộp thoại hiện thông điệp và GIỮ lý do đã nhập. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Hộp thoại xác nhận hành động phá huỷ CÓ LÝ DO (hủy phiếu/đơn — spec 34a). Lý do bắt buộc, lưu vào chứng từ + audit. */
export function ReasonDialog({ open, title, description, confirmLabel, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const r = reason.trim();
    if (!r) { setError("Nhập lý do."); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(r);
      setReason("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thực hiện được, vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-2 text-sm text-fg-secondary">{description}</Dialog.Description>}
          <label htmlFor="reason-input" className="mt-4 block text-xs text-fg-muted">Lý do</label>
          <textarea id="reason-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
            aria-invalid={!!error} className="mt-1 w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
          {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button>
            <button type="button" onClick={() => void submit()} disabled={busy} className="h-11 rounded-sm bg-danger px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">
              {busy ? "Đang xử lý" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```
Thêm `export { ReasonDialog } from "./ReasonDialog";` vào `src/components/ui/index.ts`. Run → xanh.

- [ ] **Step 3: Routes API** (mỗi file TỰ gọi `requireActorApi(`).

`src/app/api/purchases/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { purchaseInputSchema } from "@/server/purchase/schemas";
import { createPurchaseIdempotent } from "@/server/purchase/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("purchase.create");
  const key = readIdempotencyKey(req);
  return createPurchaseIdempotent(prisma, actor, key, purchaseInputSchema.parse(await readJson(req)));
});
```

`src/app/api/purchases/[id]/section-update/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { freightSchema, purchaseInputSchema } from "@/server/purchase/schemas";
import { updatePurchaseFreightTx, updatePurchaseTx } from "@/server/purchase/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("purchase.edit");
  const id = idParam.parse((await ctx.params).id);
  const raw = await readJson(req);
  const { section } = z.object({ section: z.string().optional() }).parse(raw);
  switch (section) {
    case "content": await updatePurchaseTx(prisma, actor, id, purchaseInputSchema.parse(raw)); break;
    case "freight": await updatePurchaseFreightTx(prisma, actor, id, freightSchema.parse(raw).freightCost); break;
    default: throw new ValidationError("Phần dữ liệu không hợp lệ.");
  }
  return { ok: true };
});
```

`src/app/api/purchases/[id]/cancel/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelPurchaseSchema } from "@/server/purchase/schemas";
import { cancelPurchaseTx } from "@/server/purchase/service";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("purchase.cancel");
  const id = idParam.parse((await ctx.params).id);
  await cancelPurchaseTx(prisma, actor, id, cancelPurchaseSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
```

`src/app/api/purchases/export/route.ts` (khuôn export của 03a; `requireActorApi("purchase.view")`; `parseListParams(sp, PURCHASE_FILTER_KEYS)`; `exportPurchasesXlsx(prisma, actor, params)`; `xlsxResponse("phieu-nhap.xlsx", …)`; bọc `try/catch → toErrorResponse`).

- [ ] **Step 4: Trường form phiếu (dùng cho lập mới và sửa)** — `src/components/purchase/PurchaseFormFields.tsx`

```tsx
"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { Combobox, type ComboOption } from "@/components/ui/Combobox";
import { Field, inputClass } from "@/components/ui/Field";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import type { PurchaseInput } from "@/server/purchase/schemas";
import type { ProductOption } from "@/server/products/queries";

/** Dòng trống mới. Số để `undefined` (KHÔNG 0): người dùng chưa nhập ≠ 0 — zod báo "Nhập số lượng." */
export const emptyLine = { productId: undefined, qty: undefined, unit: "", factor: 1, purchasePrice: undefined, rollInfo: "" } as unknown as PurchaseInput["lines"][number];

const searchSuppliers = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/suppliers/search?q=${encodeURIComponent(q)}`);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface Props {
  form: UseFormReturn<PurchaseInput>;
  /** NCC hiện tại (khi sửa) để ô chọn hiện đúng nhãn. */
  initialSupplier?: ComboOption | null;
  /** Sản phẩm đã có trên phiếu (khi sửa) — cần đơn vị/hệ số của chúng. */
  initialProducts?: ProductOption[];
  maxDate: string;
}

export function PurchaseFormFields({ form, initialSupplier = null, initialProducts = [], maxDate }: Props) {
  const { register, control, watch, setValue, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const [supplier, setSupplier] = useState<ComboOption | null>(initialSupplier);
  const [meta, setMeta] = useState<Record<number, ProductOption>>(() => Object.fromEntries(initialProducts.map((p) => [p.value, p])));
  const lines = watch("lines");
  const freight = Number(watch("freightCost")) || 0;
  const goods = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.purchasePrice) || 0), 0);

  const loadProducts = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setMeta((m) => ({ ...m, ...Object.fromEntries(rows.map((r) => [r.value, r])) }));
    return rows;
  };
  const pickProduct = (i: number, o: ProductOption | null) => {
    if (o) setMeta((m) => ({ ...m, [o.value]: o }));
    setValue(`lines.${i}.productId`, (o ? Number(o.value) : undefined) as number, { shouldDirty: true, shouldValidate: true });
    setValue(`lines.${i}.unit`, o ? o.baseUnit : "", { shouldDirty: true, shouldValidate: true });
    setValue(`lines.${i}.factor`, 1, { shouldDirty: true });
  };
  const pickUnit = (i: number, unit: string) => {
    const p = meta[lines[i]?.productId as number];
    const def = p && unit !== p.baseUnit ? Number(p.units.find((u) => u.unit === unit)?.factor ?? 1) : 1;
    setValue(`lines.${i}.unit`, unit, { shouldDirty: true, shouldValidate: true });
    setValue(`lines.${i}.factor`, def, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Combobox label="Nhà cung cấp" value={supplier} loadOptions={searchSuppliers} placeholder="Tìm nhà cung cấp…"
          onChange={(o) => { setSupplier(o); setValue("partnerId", (o ? Number(o.value) : undefined) as number, { shouldDirty: true, shouldValidate: true }); }}
          {...(errors.partnerId?.message ? { error: errors.partnerId.message } : {})} />
        <Field id="date" label="Ngày nhập" error={errors.date?.message}>
          <input id="date" type="date" max={maxDate} {...register("date")} aria-invalid={!!errors.date} aria-describedby={errors.date ? "date-error" : undefined} className={inputClass(errors.date)} />
        </Field>
        <Field id="freightCost" label="Cước vận chuyển (₫)" hint="Phân bổ vào giá vốn theo giá trị dòng hàng" error={errors.freightCost?.message}>
          <input id="freightCost" type="number" min={0} step="any" {...register("freightCost", { valueAsNumber: true })} aria-invalid={!!errors.freightCost}
            aria-describedby={errors.freightCost ? "freightCost-error" : "freightCost-hint"} className={`${inputClass(errors.freightCost)} tabular text-right`} />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">
              <th className="w-64 px-2 py-2">Sản phẩm</th><th className="w-24 px-2 py-2">Đơn vị</th><th className="w-28 px-2 py-2 text-right">Số lượng</th>
              <th className="w-24 px-2 py-2 text-right">Hệ số</th><th className="w-32 px-2 py-2 text-right">SL gốc</th><th className="w-32 px-2 py-2 text-right">Đơn giá</th>
              <th className="w-36 px-2 py-2 text-right">Thành tiền</th><th className="px-2 py-2">Ghi chú cuộn</th><th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const l = lines[i];
              const p = meta[l?.productId as number];
              const e = errors.lines?.[i];
              const qtyBase = l?.qty && l?.factor ? round3(Number(l.qty) / Number(l.factor)) : null;
              const units = p ? [p.baseUnit, ...p.units.map((u) => u.unit)] : [];
              return (
                <tr key={f.id} className="border-b border-border align-top last:border-b-0">
                  <td className="px-2 py-2 [&_label]:sr-only">
                    <Controller control={control} name={`lines.${i}.productId`} render={() => (
                      <Combobox label={`Sản phẩm dòng ${i + 1}`} value={p ?? null} loadOptions={loadProducts} placeholder="Tìm mã, tên…"
                        onChange={(o) => pickProduct(i, o as ProductOption | null)} {...(e?.productId?.message ? { error: e.productId.message } : {})} />
                    )} />
                  </td>
                  <td className="px-2 py-2">
                    <select aria-label={`Đơn vị dòng ${i + 1}`} value={l?.unit ?? ""} onChange={(ev) => pickUnit(i, ev.target.value)} className={inputClass(e?.unit)}>
                      <option value="">—</option>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    {e?.unit?.message && <p className="mt-1 text-xs text-danger">{e.unit.message}</p>}
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label={`Số lượng dòng ${i + 1}`} type="number" min={0} step="any" {...register(`lines.${i}.qty`, { valueAsNumber: true })} aria-invalid={!!e?.qty} className={`${inputClass(e?.qty)} tabular text-right`} />
                    {e?.qty?.message && <p className="mt-1 text-xs text-danger">{e.qty.message}</p>}
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label={`Hệ số dòng ${i + 1}`} type="number" min={0} step="any" {...register(`lines.${i}.factor`, { valueAsNumber: true })} aria-invalid={!!e?.factor} className={`${inputClass(e?.factor)} tabular text-right`} />
                    {e?.factor?.message && <p className="mt-1 text-xs text-danger">{e.factor.message}</p>}
                  </td>
                  <td className="tabular px-2 py-3 text-right text-fg-secondary">{qtyBase === null ? "—" : `≈ ${formatQty(qtyBase)} ${p?.baseUnit ?? ""}`}</td>
                  <td className="px-2 py-2">
                    <input aria-label={`Đơn giá dòng ${i + 1}`} type="number" min={0} step="any" {...register(`lines.${i}.purchasePrice`, { valueAsNumber: true })} aria-invalid={!!e?.purchasePrice} className={`${inputClass(e?.purchasePrice)} tabular text-right`} />
                    {e?.purchasePrice?.message && <p className="mt-1 text-xs text-danger">{e.purchasePrice.message}</p>}
                  </td>
                  <td className="tabular px-2 py-3 text-right font-medium">{formatCurrency((Number(l?.qty) || 0) * (Number(l?.purchasePrice) || 0))}</td>
                  <td className="px-2 py-2">
                    <input aria-label={`Ghi chú cuộn dòng ${i + 1}`} {...register(`lines.${i}.rollInfo`)} placeholder="số cuộn, quy cách…" className={inputClass(e?.rollInfo)} />
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" aria-label={`Xóa dòng ${i + 1}`} onClick={() => remove(i)} disabled={fields.length === 1} className="flex h-9 w-9 items-center justify-center rounded-sm text-danger hover:bg-hover disabled:opacity-40"><Trash2 size={16} aria-hidden /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {typeof errors.lines?.message === "string" && <p role="alert" className="text-xs text-danger">{errors.lines.message}</p>}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <button type="button" onClick={() => append(emptyLine)} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-9"><Plus size={14} aria-hidden /> Thêm dòng</button>
        <dl className="min-w-64 space-y-1 text-sm">
          <div className="flex justify-between gap-6"><dt className="text-fg-muted">Tiền hàng (công nợ phải trả NCC)</dt><dd className="tabular font-semibold">{formatCurrency(goods)}</dd></div>
          <div className="flex justify-between gap-6"><dt className="text-fg-muted">Cước (vào giá vốn, không cộng công nợ)</dt><dd className="tabular">{formatCurrency(freight)}</dd></div>
        </dl>
      </div>

      <Field id="note" label="Ghi chú" error={errors.note?.message}>
        <textarea id="note" rows={2} {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
      </Field>
    </div>
  );
}
```

`src/components/purchase/PurchaseNewForm.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { NewPage } from "@/components/ui/NewPage";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { emptyLine, PurchaseFormFields } from "./PurchaseFormFields";

/** `today`: yyyy-mm-dd theo ICT do SERVER tính (tránh lệch múi giờ trình duyệt và lệch hydration). */
export function PurchaseNewForm({ today }: { today: string }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const form = useForm<PurchaseInput>({
    resolver: zodResolver(purchaseInputSchema),
    defaultValues: { partnerId: undefined as unknown as number, date: today, freightCost: 0, note: "", lines: [emptyLine] },
  });

  const submit = form.handleSubmit(async (v) => {
    // Cùng khoá cho mọi lần gửi lại của form: bấm đúp / mất mạng rồi gửi lại KHÔNG lập 2 phiếu (Review Focus 2)
    const r = await apiFetch<{ id: number }>("/api/purchases", { method: "POST", json: v, idempotencyKey: idem.key });
    router.replace(`/purchase/orders/${r.id}`);
  });

  return (
    <NewPage backHref="/purchase/orders" backLabel="Quay lại phiếu nhập" title="Lập phiếu nhập" submitLabel="Lưu phiếu nhập"
      isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }}>
      <PurchaseFormFields form={form} maxDate={today} />
    </NewPage>
  );
}
```

`src/app/(app)/purchase/orders/new/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { PurchaseNewForm } from "@/components/purchase/PurchaseNewForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewPurchasePage() {
  const actor = await requireActor("purchase.create");
  if (!actor.perms.has("purchase_price.view")) redirect("/403"); // không biết giá thì không nhập giá được
  return <PurchaseNewForm today={ictYmd(new Date())} />;
}
```

- [ ] **Step 5: Test form lập phiếu (đỏ → xanh)** — `tests/ui/purchase-form.test.tsx`

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseNewForm } from "@/components/purchase/PurchaseNewForm";
import { ApiError } from "@/lib/api-fetch";

const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const supplier = { value: 5, label: "NCC000001 — Tôn Hoa Sen" };
const ton = { value: 11, label: "TL045 — Tôn lạnh 0.45", hint: "md", baseUnit: "md", kind: "HANG", units: [{ unit: "kg", factor: "2.4" }] };

beforeEach(() => {
  replace.mockReset(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/partner-lists/suppliers/search")) return [supplier];
    if (url.startsWith("/api/products/search")) return [ton];
    if (url === "/api/purchases") return { id: 3, code: "PN000003" };
    throw new Error(`URL ngoài dự kiến: ${url}`);
  });
});
afterEach(cleanup);

const post = () => apiFetch.mock.calls.find((c) => c[0] === "/api/purchases");

async function pick(label: string, optionName: string) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(optionName) }));
}

describe("PurchaseNewForm", () => {
  it("gửi form rỗng → lỗi tiếng Việt (NCC, sản phẩm, số lượng, đơn giá), KHÔNG gọi API tạo phiếu", async () => {
    render(<PurchaseNewForm today="2026-09-27" />);
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu nhập" }));
    expect(await screen.findByText("Chọn nhà cung cấp.")).toBeInTheDocument();
    expect(screen.getByText("Chọn sản phẩm.")).toBeInTheDocument();
    expect(screen.getByText("Nhập số lượng.")).toBeInTheDocument();
    expect(screen.getByText("Nhập đơn giá.")).toBeInTheDocument();
    expect(post()).toBeUndefined();
  });

  it("[Review Focus 4] chọn sản phẩm → đơn vị gốc; đổi sang kg → hệ số 2,4 tự điền; 3.000 kg → '≈ 1.250 md'; tiền hàng 55.500.000 ₫", async () => {
    render(<PurchaseNewForm today="2026-09-27" />);
    await pick("Sản phẩm dòng 1", "TL045");
    expect(screen.getByLabelText("Đơn vị dòng 1")).toHaveValue("md");
    await userEvent.selectOptions(screen.getByLabelText("Đơn vị dòng 1"), "kg");
    expect(screen.getByLabelText("Hệ số dòng 1")).toHaveValue(2.4);
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "3000");
    await userEvent.type(screen.getByLabelText("Đơn giá dòng 1"), "18500");
    expect(screen.getByText(/≈ 1\.250 md/)).toBeInTheDocument();
    expect(screen.getAllByText("55.500.000 ₫").length).toBeGreaterThan(0);
  });

  it("hợp lệ → POST /api/purchases kèm Idempotency-Key + payload đúng, rồi chuyển sang chi tiết", async () => {
    render(<PurchaseNewForm today="2026-09-27" />);
    await pick("Nhà cung cấp", "Tôn Hoa Sen");
    await pick("Sản phẩm dòng 1", "TL045");
    await userEvent.selectOptions(screen.getByLabelText("Đơn vị dòng 1"), "kg");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "3000");
    await userEvent.type(screen.getByLabelText("Đơn giá dòng 1"), "18500");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu nhập" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/purchase/orders/3"));
    const [, init] = post()!;
    expect(init.method).toBe("POST");
    expect(init.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(init.json).toMatchObject({
      partnerId: 5, date: "2026-09-27", freightCost: 0,
      lines: [{ productId: 11, qty: 3000, unit: "kg", factor: 2.4, purchasePrice: 18500 }],
    });
  });

  it("số lượng 0 và hệ số 0 → lỗi tại từng ô; thêm/xóa dòng (dòng cuối không xóa được)", async () => {
    render(<PurchaseNewForm today="2026-09-27" />);
    expect(screen.getByRole("button", { name: "Xóa dòng 1" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Thêm dòng" }));
    expect(screen.getByLabelText("Số lượng dòng 2")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu nhập" }));
    expect(await screen.findAllByText("Số lượng phải lớn hơn 0.")).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Xóa dòng 2" }));
    expect(screen.queryByLabelText("Số lượng dòng 2")).toBeNull();
  });

  it("máy chủ báo lỗi (vd kho bận) → hiện banner, GIỮ nguyên dữ liệu đang nhập, không chuyển trang", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/partner-lists/suppliers/search")) return [supplier];
      if (url.startsWith("/api/products/search")) return [ton];
      throw new ApiError(409, "Kho đang bận xử lý giao dịch khác trên cùng mã hàng, vui lòng thử lại sau giây lát.", "INVENTORY_BUSY");
    });
    render(<PurchaseNewForm today="2026-09-27" />);
    await pick("Nhà cung cấp", "Tôn Hoa Sen");
    await pick("Sản phẩm dòng 1", "TL045");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "10");
    await userEvent.type(screen.getByLabelText("Đơn giá dòng 1"), "1000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu nhập" }));
    expect(await screen.findByText(/Kho đang bận/)).toBeInTheDocument();
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue(10);
    expect(replace).not.toHaveBeenCalled();
  });
});
```

Ghi chú: các `<select>` đơn vị dùng `aria-label`, ô số dùng `aria-label` theo dòng nên test chọn theo nhãn ổn định; `Combobox` có `<label>` sr-only ("Sản phẩm dòng N"). Nếu `formatCurrency(55500000)` in dạng khác `55.500.000 ₫`, chỉnh chuỗi kỳ vọng theo `src/lib/format.ts` (dấu chấm ngăn nghìn + " ₫").

- [ ] **Step 6: Danh sách phiếu nhập** — `src/components/purchase/PurchaseTable.tsx` và `src/app/(app)/purchase/orders/page.tsx`

```tsx
// src/components/purchase/PurchaseTable.tsx
"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { PurchaseRowDTO } from "@/server/purchase/queries";

const BASE = "/purchase/orders";

/** `purchaseTotal`/`freightCost` chỉ có trong DTO khi người xem có purchase_price.view (server đã lọc) → cột chỉ hiện khi có dữ liệu. */
export function PurchaseTable({ rows, canEdit, params }: { rows: PurchaseRowDTO[]; canEdit: boolean; params: ListParams }) {
  const showPrice = rows.some((r) => r.purchaseTotal !== undefined);
  const columns: Column<PurchaseRowDTO>[] = [
    { key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { key: "at", label: "Ngày nhập", sortable: true, render: (p) => formatDate(p.at) },
    { key: "supplier", label: "Nhà cung cấp", render: (p) => p.partnerName },
    { key: "lineCount", label: "Số dòng", align: "right", render: (p) => p.lineCount },
    ...(showPrice ? [
      { key: "purchaseTotal", label: "Tiền hàng", align: "right" as const, sortable: true, render: (p: PurchaseRowDTO) => formatCurrency(p.purchaseTotal) },
      { key: "freightCost", label: "Cước", align: "right" as const, hiddenByDefault: true, render: (p: PurchaseRowDTO) => (Number(p.freightCost) > 0 ? formatCurrency(p.freightCost) : null) },
    ] : []),
    { key: "status", label: "Trạng thái", render: (p) => (p.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge>) },
    { key: "createdBy", label: "Người lập", hiddenByDefault: true, render: (p) => p.createdByName },
  ];
  const actions = (p: PurchaseRowDTO): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `${BASE}/${p.id}` },
    ...(canEdit && !p.isCancelled ? [{ key: "edit", label: "Sửa", icon: "pencil" as const, href: `${BASE}/${p.id}?edit=content` }] : []),
  ];
  return <DataTable id="purchases" columns={columns} rows={rows} rowKey={(p) => p.id} rowHref={(p) => `${BASE}/${p.id}`} rowActions={actions}
    sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />;
}
```

```tsx
// src/app/(app)/purchase/orders/page.tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { PurchaseTable } from "@/components/purchase/PurchaseTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, QuickTimeFilter, SearchBox, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listPurchases, PURCHASE_FILTER_KEYS } from "@/server/purchase/queries";

const BASE = "/purchase/orders";

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("purchase.view");
  const params = parseListParams(await searchParams, PURCHASE_FILTER_KEYS);
  const { rows, total, stats } = await listPurchases(prisma, actor, params);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const status = params.filters.status?.[0];
  const allPeriods = params.filters.period?.[0] === "all";
  const canCreate = actor.perms.has("purchase.create") && actor.perms.has("purchase_price.view");
  const canEdit = actor.perms.has("purchase.edit") && actor.perms.has("purchase_price.view");
  const filtered = !!(params.q || params.filters.status || params.timePreset || params.filters.period);
  const pill = "flex h-10 items-center rounded-sm border px-3 text-sm";

  return (
    <ListPageLayout
      title="Phiếu nhập hàng"
      actions={<>
        <ExportButton href={buildExportHref("/api/purchases/export", params)} />
        {canCreate && <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Lập phiếu nhập</Link>}
      </>}
      stats={<>
        <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
        <StatCard label="Hiệu lực" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
        <StatCard label="Đã hủy" value={stats.cancelled} tone="danger" href={href({ filters: { status: ["cancelled"] } })} active={status === "cancelled"} />
      </>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã phiếu, nhà cung cấp…" />
          <QuickTimeFilter basePath={BASE} params={params} />
          <Link href={href({ filters: { period: [] } })} aria-current={!allPeriods ? "true" : undefined} className={`${pill} ${!allPeriods ? "border-accent bg-accent-soft text-accent" : "border-border"}`}>Kỳ đang mở</Link>
          <Link href={href({ filters: { period: ["all"] } })} aria-current={allPeriods ? "true" : undefined} className={`${pill} ${allPeriods ? "border-accent bg-accent-soft text-accent" : "border-border"}`}>Tất cả kỳ</Link>
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0 ? (
        filtered
          ? <EmptyState kind="no-result" title="Không tìm thấy phiếu nhập phù hợp" description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title="Chưa có phiếu nhập nào trong kỳ này" action={canCreate ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Lập phiếu nhập đầu tiên</Link> : undefined} />
      ) : (
        <PurchaseTable rows={rows} canEdit={canEdit} params={params} />
      )}
    </ListPageLayout>
  );
}
```

- [ ] **Step 7: Trang chi tiết + sửa từng phần + hủy + cước nhập sau.**

`src/components/purchase/PurchaseDetail.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Badge, DetailField, DetailPage, EditableSection, Field, inputClass, ReasonDialog, useDetailNav } from "@/components/ui";
import type { ComboOption } from "@/components/ui/Combobox";
import type { TabRenderCtx } from "@/components/ui/DetailPage";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatQty } from "@/lib/format";
import type { ProductOption } from "@/server/products/queries";
import type { PurchaseDetailDTO } from "@/server/purchase/queries";
import { freightSchema, purchaseInputSchema, type PurchaseInput } from "@/server/purchase/schemas";
import { PurchaseFormFields } from "./PurchaseFormFields";

interface Props {
  purchase: PurchaseDetailDTO;
  /** yyyy-mm-dd (ICT) của ngày chứng từ + hôm nay. */
  date: string;
  today: string;
  supplier: ComboOption;
  products: ProductOption[];
  history: { id: number; action: string; at: string; by: string }[];
  canEdit: boolean;
  canCancel: boolean;
}

const ACTION_LABEL: Record<string, string> = { "purchase.create": "Lập phiếu", "purchase.update": "Sửa phiếu", "purchase.update_freight": "Nhập cước vận chuyển", "purchase.cancel": "Hủy phiếu" };

export function PurchaseDetail(p: Props) {
  const router = useRouter();
  const x = p.purchase;
  const nav = useDetailNav(["info", "history"], { content: "info", freight: "info" });
  const [cancelOpen, setCancelOpen] = useState(false);
  const showPrice = x.purchaseTotal !== undefined;
  const editable = p.canEdit && !x.isCancelled && showPrice; // sửa cần thấy giá (D: purchase_price.view)
  const patch = (section: string) => (v: object) => apiFetch(`/api/purchases/${x.id}/section-update`, { method: "PATCH", json: { section, ...v } }).then(() => {});

  const defaults: PurchaseInput = {
    partnerId: x.partnerId, date: p.date, freightCost: Number(x.freightCost ?? 0), note: x.note ?? "",
    lines: x.lines.map((l) => ({ id: l.id, productId: l.productId, qty: Number(l.qty), unit: l.unit, factor: Number(l.factorUsed), purchasePrice: Number(l.purchasePrice ?? 0), rollInfo: l.rollInfo ?? "" })),
  };

  const content = (ctx: TabRenderCtx) => (
    <EditableSection ctx={ctx} k="content" title="Nội dung phiếu" editLabel="Chỉnh sửa nội dung phiếu" canEdit={editable}
      schema={purchaseInputSchema} save={patch("content")} defaults={defaults}
      view={
        <div className="space-y-4">
          <dl className="grid gap-2 sm:grid-cols-3">
            <DetailField label="Nhà cung cấp">{x.partnerName}</DetailField>
            <DetailField label="Ngày nhập">{formatDate(x.at)}</DetailField>
            <DetailField label="Ghi chú">{x.note}</DetailField>
          </dl>
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-border text-left text-xs font-semibold uppercase text-fg-secondary">
                <th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2 text-right">SL nhập</th><th className="px-2 py-2 text-right">Hệ số</th><th className="px-2 py-2 text-right">SL gốc</th>
                {showPrice && <><th className="px-2 py-2 text-right">Đơn giá</th><th className="px-2 py-2 text-right">Thành tiền</th><th className="px-2 py-2 text-right">Cước PB</th><th className="px-2 py-2 text-right">Giá vốn/đv</th></>}
                <th className="px-2 py-2">Ghi chú cuộn</th>
              </tr></thead>
              <tbody>
                {x.lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-2"><span className="font-mono text-xs">{l.productCode}</span> {l.productName}</td>
                    <td className="tabular px-2 py-2 text-right">{formatQty(l.qty)} {l.unit}</td>
                    <td className="tabular px-2 py-2 text-right">{formatNumber(l.factorUsed, 6)}</td>
                    <td className="tabular px-2 py-2 text-right">{formatQty(l.qtyBase)} {l.baseUnit}</td>
                    {showPrice && <>
                      <td className="tabular px-2 py-2 text-right">{formatCurrency(l.purchasePrice)}</td>
                      <td className="tabular px-2 py-2 text-right">{formatCurrency(l.purchaseAmount)}</td>
                      <td className="tabular px-2 py-2 text-right">{Number(l.allocatedFreight) > 0 ? formatCurrency(l.allocatedFreight) : "—"}</td>
                      <td className="tabular px-2 py-2 text-right">{l.unitCost === undefined ? "—" : formatCurrency(l.unitCost)}</td>
                    </>}
                    <td className="px-2 py-2">{l.rollInfo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
      edit={(f) => <PurchaseFormFields form={f} initialSupplier={p.supplier} initialProducts={p.products} maxDate={p.today} />} />
  );

  const freight = (ctx: TabRenderCtx) =>
    !showPrice ? null : (
      <EditableSection ctx={ctx} k="freight" title="Cước vận chuyển" editLabel="Chỉnh sửa cước" canEdit={editable}
        schema={freightSchema} save={patch("freight")} defaults={{ freightCost: Number(x.freightCost ?? 0) }}
        view={<dl><DetailField label="Cước (phân bổ vào giá vốn, không cộng công nợ NCC)">{Number(x.freightCost) > 0 ? formatCurrency(x.freightCost) : null}</DetailField></dl>}
        edit={(f) => (
          <Field id="freightCost" label="Cước vận chuyển (₫)" hint="Nhập cước SAU khi đã lập phiếu: giá vốn lô và giá vốn các dòng bán đã ăn lô này được cập nhật" error={f.formState.errors.freightCost?.message}>
            <input id="freightCost" type="number" min={0} step="any" {...f.register("freightCost", { valueAsNumber: true })} aria-invalid={!!f.formState.errors.freightCost} className={`${inputClass(f.formState.errors.freightCost)} tabular text-right`} />
          </Field>
        )} />
    );

  async function cancel(reason: string) {
    try {
      await apiFetch(`/api/purchases/${x.id}/cancel`, { method: "POST", json: { reason } });
    } catch (e) {
      throw e instanceof Error ? e : new Error("Không hủy được, vui lòng thử lại."); // ApiError là Error: thông điệp tiếng Việt của máy chủ hiện trong hộp thoại
    }
    toast.success("Đã hủy phiếu nhập.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {x.isCancelled && (
        <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          Phiếu đã hủy lúc {formatDateTime(x.cancelledAt)}. Lý do: {x.cancelReason}. Lô hàng và công nợ của phiếu đã được gỡ.
        </div>
      )}
      <DetailPage
        backHref="/purchase/orders" backLabel="Quay lại phiếu nhập"
        headerActions={p.canCancel && !x.isCancelled ? (
          <button type="button" onClick={() => setCancelOpen(true)} className="flex h-11 items-center gap-2 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-hover md:h-10"><Ban size={16} aria-hidden /> Hủy phiếu</button>
        ) : undefined}
        summary={{
          title: x.code, code: x.partnerName,
          badges: [x.isCancelled ? { label: "Đã hủy", tone: "danger" } : { label: "Hiệu lực", tone: "success" }],
          facts: [
            { label: "Ngày nhập", value: formatDate(x.at) }, { label: "Số dòng", value: x.lines.length },
            ...(showPrice ? [{ label: "Tiền hàng", value: formatCurrency(x.purchaseTotal) }, { label: "Cước", value: Number(x.freightCost) > 0 ? formatCurrency(x.freightCost) : "—" }] : []),
            { label: "Người lập", value: x.createdByName ?? "—" },
          ],
        }}
        tabs={[
          { key: "info", label: "Chi tiết", render: (ctx) => <div className="space-y-6">{content(ctx)}{freight(ctx)}</div> },
          {
            key: "history", label: "Nhật ký", count: p.history.length,
            render: () => p.history.length === 0
              ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Chưa có thao tác nào ghi nhận.</p>
              : <ul className="divide-y divide-[var(--border-default)]">{p.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{ACTION_LABEL[h.action] ?? h.action} <span className="text-fg-muted">— {h.by}</span></span><span className="tabular text-xs text-fg-muted">{formatDateTime(h.at)}</span></li>
                ))}</ul>,
          },
        ]}
        {...nav}
        initialEditing={editable ? nav.initialEditing : null}
      />
      <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Hủy phiếu ${x.code}?`} confirmLabel="Hủy phiếu"
        description="Dòng sổ kho và lô hàng của phiếu bị gỡ; các đơn bán đã ăn lô này sẽ thành đơn treo chờ nhập bù. Không hoàn tác được." onConfirm={cancel} />
    </div>
  );
}
```

Ghi chú thực thi: `Link`, `Badge`, `z`, `zodResolver` import ở đầu file chỉ cần nếu dùng — bỏ import thừa khi lint báo. Nếu `PurchaseInput["lines"][number]` yêu cầu `id?` khớp `purchaseLineSchema`, `defaults` khai `id: l.id` (số) là đúng.

`src/app/(app)/purchase/orders/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { PurchaseDetail } from "@/components/purchase/PurchaseDetail";
import { ictYmd } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { productOptionsByIds } from "@/server/products/queries";
import { getPurchase } from "@/server/purchase/queries";

const MAX_INT32 = 2_147_483_647;

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("purchase.view");
  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0;
  if (id <= 0 || id > MAX_INT32) notFound();
  const purchase = await getPurchase(prisma, actor, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const [products, supplier, history] = await Promise.all([
    productOptionsByIds(prisma, purchase.lines.map((l) => l.productId)),
    prisma.partner.findUniqueOrThrow({ where: { id: purchase.partnerId }, select: { id: true, code: true, name: true } }),
    prisma.auditLog.findMany({ where: { entity: "Purchase", entityId: String(id) }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, at: true, userId: true } }),
  ]);
  const ids = [...new Set(history.map((h) => h.userId).filter((x): x is number => x !== null))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return (
    <PurchaseDetail
      purchase={JSON.parse(JSON.stringify(purchase))} date={ictYmd(purchase.at)} today={ictYmd(new Date())}
      supplier={{ value: supplier.id, label: `${supplier.code} — ${supplier.name}` }} products={products}
      history={history.map((h) => ({ id: h.id, action: h.action, at: h.at.toISOString(), by: h.userId ? names.get(h.userId) ?? `#${h.userId}` : "Hệ thống" }))}
      canEdit={actor.perms.has("purchase.edit")} canCancel={actor.perms.has("purchase.cancel")}
    />
  );
}
```

Nhật ký của phiếu chứa `purchaseTotal`/`freightCost` trong `afterJson` — nhưng trang này chỉ hiện `action/at/by`, KHÔNG hiện JSON. Màn Nhật ký thao tác (mã 5, `audit.view`) đã `redactDeep` `beforeJson/afterJson` (GĐ0b) nên người thiếu `purchase_price.view` không thấy giá — kiểm bằng test ở Step 8.

- [ ] **Step 8: Test chi tiết + trang + audit (đỏ → xanh)**

`tests/ui/purchase-detail.test.tsx` (mock `next/navigation` như `product-detail.test.tsx`): (a) phiếu hiệu lực + `canEdit` + có giá → có bút chì "Chỉnh sửa nội dung phiếu" và "Chỉnh sửa cước"; (b) thiếu giá (DTO không có `purchaseTotal`) → KHÔNG có bút chì, KHÔNG có cột Đơn giá/Thành tiền, KHÔNG có mục Cước; (c) sửa cước → `PATCH /api/purchases/7/section-update` `{ section: "freight", freightCost: 400000 }`; (d) bấm "Hủy phiếu" → hộp thoại, nhập lý do → `POST /api/purchases/7/cancel` `{ reason }` rồi `router.refresh`; hủy khi máy chủ báo kỳ đã kết sổ → thông điệp hiện trong hộp thoại; (e) phiếu đã hủy → biểu ngữ có lý do, không có nút Hủy phiếu và không bút chì.

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseDetail } from "@/components/purchase/PurchaseDetail";
import { ApiError } from "@/lib/api-fetch";
import type { PurchaseDetailDTO } from "@/server/purchase/queries";

const apiFetch = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }), usePathname: () => "/purchase/orders/7", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const full: PurchaseDetailDTO = {
  id: 7, code: "PN000007", at: new Date("2026-09-25T03:00:00Z"), periodId: 1, partnerId: 5, partnerCode: "NCC000001", partnerName: "Tôn Hoa Sen",
  isCancelled: false, note: null, createdByName: "Nam", cancelReason: null, cancelledAt: null, purchaseTotal: "4000000", freightCost: "0",
  lines: [{
    id: 1, productId: 11, productCode: "TL045", productName: "Tôn lạnh 0.45", baseUnit: "md", qty: "100", unit: "md", factorUsed: "1", qtyBase: "100", rollInfo: null,
    purchasePrice: "40000", purchaseAmount: "4000000", allocatedFreight: "0", unitCost: "40000",
  }],
};
const noPrice = (): PurchaseDetailDTO => {
  const { purchaseTotal: _t, freightCost: _f, ...rest } = full;
  return { ...rest, lines: full.lines.map(({ purchasePrice: _p, purchaseAmount: _a, allocatedFreight: _al, unitCost: _u, ...l }) => l) };
};
const base = { date: "2026-09-25", today: "2026-09-27", supplier: { value: 5, label: "NCC000001 — Tôn Hoa Sen" }, products: [], history: [], canEdit: true, canCancel: true };

beforeEach(() => { apiFetch.mockReset(); refresh.mockReset(); });
afterEach(cleanup);

describe("PurchaseDetail", () => {
  it("có giá + quyền: hiện cột giá, bút chì nội dung + cước, nút Hủy phiếu", () => {
    render(<PurchaseDetail purchase={full} {...base} />);
    expect(screen.getByRole("button", { name: "Chỉnh sửa nội dung phiếu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chỉnh sửa cước" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy phiếu" })).toBeInTheDocument();
    expect(screen.getByText("Đơn giá")).toBeInTheDocument();
  });

  it("[Review Focus 5] DTO không có giá (thiếu purchase_price.view): không cột giá, không mục cước, KHÔNG sửa được", () => {
    render(<PurchaseDetail purchase={noPrice()} {...base} />);
    expect(screen.queryByText("Đơn giá")).toBeNull();
    expect(screen.queryByText("Thành tiền")).toBeNull();
    expect(screen.queryByText(/Cước/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
  });

  it("nhập cước sau: chỉ gửi section 'freight'", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    render(<PurchaseDetail purchase={full} {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa cước" }));
    const input = screen.getByLabelText(/^Cước vận chuyển/);
    await userEvent.clear(input);
    await userEvent.type(input, "400000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/purchases/7/section-update", { method: "PATCH", json: { section: "freight", freightCost: 400000 } });
  });

  it("hủy phiếu: bắt buộc lý do → POST cancel → làm mới trang", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    render(<PurchaseDetail purchase={full} {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu" }));
    await userEvent.type(screen.getByLabelText("Lý do"), "nhập nhầm NCC");
    await userEvent.click(screen.getAllByRole("button", { name: "Hủy phiếu" }).at(-1)!);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/purchases/7/cancel", { method: "POST", json: { reason: "nhập nhầm NCC" } });
  });

  it("[Review Focus 3] kỳ đã kết sổ → thông điệp của máy chủ hiện trong hộp thoại, không làm mới", async () => {
    apiFetch.mockRejectedValue(new ApiError(409, "Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.", "PERIOD_CLOSED"));
    render(<PurchaseDetail purchase={full} {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu" }));
    await userEvent.type(screen.getByLabelText("Lý do"), "x");
    await userEvent.click(screen.getAllByRole("button", { name: "Hủy phiếu" }).at(-1)!);
    expect(await screen.findByText("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("phiếu đã hủy: biểu ngữ kèm lý do; không có nút Hủy phiếu, không bút chì", () => {
    render(<PurchaseDetail purchase={{ ...full, isCancelled: true, cancelReason: "nhập nhầm", cancelledAt: new Date("2026-09-26T03:00:00Z") }} {...base} />);
    expect(screen.getByRole("status")).toHaveTextContent("nhập nhầm");
    expect(screen.queryByRole("button", { name: "Hủy phiếu" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
  });
});
```

`tests/ui/purchase-pages.test.tsx` (mẫu `product-pages.test.tsx`): (1) trang danh sách cần `purchase.view`, từ chối thì không gọi `listPurchases`; (2) `?period=all&status=cancelled&q=hoa` → `params.filters.period=["all"]`, `filters.status=["cancelled"]`, `q="hoa"`; (3) thiếu `purchase_price.view` → không link "Lập phiếu nhập" dù có `purchase.create`; (4) trang lập phiếu: thiếu `purchase_price.view` → `redirect("/403")` (mock `next/navigation` `redirect` ném `REDIRECT:/403`); (5) trang chi tiết id rác → notFound.

```tsx
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PurchaseDetailPage from "@/app/(app)/purchase/orders/[id]/page";
import NewPurchasePage from "@/app/(app)/purchase/orders/new/page";
import PurchasesPage from "@/app/(app)/purchase/orders/page";

const requireActor = vi.fn();
const listPurchases = vi.fn();
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOTFOUND"); }, redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/purchase/queries", async (orig) => ({ ...(await orig<typeof import("@/server/purchase/queries")>()), listPurchases: (...a: unknown[]) => listPurchases(...a) }));
vi.mock("@/components/purchase/PurchaseTable", () => ({ PurchaseTable: () => null }));
vi.mock("@/components/purchase/PurchaseNewForm", () => ({ PurchaseNewForm: () => null }));
vi.mock("@/components/purchase/PurchaseDetail", () => ({ PurchaseDetail: () => null }));

const actor = (...perms: string[]) => ({ userId: 7, perms: new Set(perms) });
beforeEach(() => {
  requireActor.mockReset(); listPurchases.mockReset();
  listPurchases.mockResolvedValue({ rows: [], total: 0, stats: { all: 0, active: 0, cancelled: 0 } });
});
const list = (sp = {}) => PurchasesPage({ searchParams: Promise.resolve(sp) });
const has = (node: ReactNode, href: string): boolean => JSON.stringify(node).includes(href);

describe("/purchase/orders (server)", () => {
  it("cần purchase.view; bị từ chối thì KHÔNG đọc dữ liệu", async () => {
    requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
    await expect(list()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("purchase.view");
    expect(listPurchases).not.toHaveBeenCalled();
  });

  it("tham số URL qua parseListParams: q, kỳ, trạng thái", async () => {
    requireActor.mockResolvedValue(actor("purchase.view"));
    await list({ period: "all", status: "cancelled", q: "hoa" });
    expect(listPurchases.mock.calls[0]![2]).toMatchObject({ q: "hoa", filters: { period: ["all"], status: ["cancelled"] } });
  });

  it("nút Lập phiếu nhập cần purchase.create VÀ purchase_price.view", async () => {
    requireActor.mockResolvedValueOnce(actor("purchase.view", "purchase.create"));
    expect(has(await list(), "/purchase/orders/new")).toBe(false);
    requireActor.mockResolvedValueOnce(actor("purchase.view", "purchase.create", "purchase_price.view"));
    expect(has(await list(), "/purchase/orders/new")).toBe(true);
  });

  it("trang lập phiếu: thiếu purchase_price.view → /403", async () => {
    requireActor.mockResolvedValue(actor("purchase.create"));
    await expect(NewPurchasePage()).rejects.toThrow("REDIRECT:/403");
    expect(requireActor).toHaveBeenCalledWith("purchase.create");
  });

  it("trang chi tiết: id rác → 404", async () => {
    requireActor.mockResolvedValue(actor("purchase.view"));
    for (const id of ["1e2", "abc", "0", "99999999999"]) await expect(PurchaseDetailPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NOTFOUND");
  });
});
```

Test nhật ký (đã có ở GĐ0b) — thêm 1 test vào `tests/audit/queries.test.ts` (hoặc file mới `tests/purchase/audit-redaction.test.ts`): tạo phiếu bằng `createPurchaseIdempotent`, đọc nhật ký bằng hàm truy vấn audit (`src/server/audit/queries.ts`) với actor thiếu `purchase_price.view` → `afterJson` KHÔNG có `purchaseTotal`/`freightCost` nhưng vẫn có `code`, `lineCount`; có quyền → có. **(Review Focus 5, đường "nhật ký")**.

```ts
// tests/purchase/audit-redaction.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { AUDIT_FILTER_KEYS, listAuditLogs } from "@/server/audit/queries";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { prisma } from "../helpers/db";
import { input, world, type World } from "./helpers";

let w: World;
beforeEach(async () => { w = await world(); });

describe("nhật ký của phiếu nhập không lộ giá cho người thiếu quyền", () => {
  it("afterJson: có purchase_price.view thấy purchaseTotal; thiếu thì không, nhưng vẫn thấy mã phiếu", async () => {
    await createPurchaseIdempotent(prisma, w.actor, "k", input(w, { freightCost: 1000 }));
    const params = parseListParams({ entity: "Purchase" }, AUDIT_FILTER_KEYS);
    const withPrice = (await listAuditLogs(prisma, { userId: 1, perms: new Set(["audit.view", "purchase_price.view"]) }, params)).rows[0]!;
    const without = (await listAuditLogs(prisma, { userId: 1, perms: new Set(["audit.view"]) }, params)).rows[0]!;
    expect(JSON.stringify(withPrice.afterJson)).toContain("purchaseTotal");
    expect(JSON.stringify(without.afterJson)).not.toMatch(/purchaseTotal|freightCost/);
    expect(JSON.stringify(without.afterJson)).toContain("PN000001");
  });
});
```
Ghi chú: tên hàm/tham số của `src/server/audit/queries.ts` (`listAuditLogs`, `AUDIT_FILTER_KEYS`) đọc đúng file hiện có trước khi viết (chữ ký thật có thể là `listAudit(db, params, perms)`); mục tiêu kiểm giữ nguyên.

- [ ] **Step 9: Mở menu + kiểm tay.** Xoá `planned: P` của `purchase-new`, `purchase-list`. `npm run dev`: đăng nhập **Kế toán** → lập phiếu 3.000 kg (đo: gõ SL → thấy "≈ 1.250 md"), nhập cước sau, sửa giá, hủy; đăng nhập tài khoản chỉ có `purchase.view` (tạo nhóm quyền thử): không thấy giá ở danh sách/chi tiết/export; kiểm dark/light. Mở **Nhật ký** kiểm dòng `purchase.create`.

- [ ] **Step 10: Lint + typecheck + test + commit**

```bash
rtk proxy npx vitest run tests/ui tests/purchase tests/api tests/lib
rtk proxy npm run lint && rtk proxy npm run typecheck
git add -A src tests
git commit -m "feat(purchase): màn Phiếu nhập hàng — lập phiếu (quy đổi, cước), danh sách, chi tiết sửa từng phần, hủy có lý do, cước nhập sau"
```

---

### Task 13: Nhập kho không NCC (mã 21)

**Mã:** 21 (spec 6.10 — khác K1). **Files:**
- Create: `src/server/purchase/{adjustment-in,last-cost}.ts`
- Create: `src/app/api/stock-adjustments-in/route.ts`, `src/app/api/stock-adjustments-in/[id]/cancel/route.ts`
- Create: `src/components/purchase/{AdjustmentInForm,AdjustmentInTable,AdjustmentInDetail}.tsx`
- Create: `src/app/(app)/purchase/adjustments-in/{page.tsx,new/page.tsx,[id]/page.tsx}`
- Modify: `src/config/app.config.ts` (bỏ `planned` của `stock-in-adj`)
- Test: `tests/purchase/{adjustment-in,last-cost}.test.ts`, `tests/ui/adjustment-in-form.test.tsx`

**Interfaces:**
- Consumes: `withIdempotentInventoryTx`, `withInventoryTx`, `postReceipt`, `removeDocument`, `productsOfDocument`, `docTimestamp`, `nextDocId`/`formatDocCode` (Task 11), `searchProducts`, `ReasonDialog`.
- Produces: `adjustmentInSchema`, `createAdjustmentInIdempotent(prisma, actor, key, input): Promise<{ id; code }>`, `cancelAdjustmentInTx(prisma, actor, id, reason)`, `lastPurchaseCost(db, productId): Promise<Prisma.Decimal | null>`, `listAdjustmentsIn(db, actor, params)`, `getAdjustmentIn(db, actor, id)`; API `POST /api/stock-adjustments-in` (Idempotency-Key), `POST /api/stock-adjustments-in/:id/cancel`.

- [ ] **Step 1: Test `lastPurchaseCost` + nhập không NCC (đỏ)** — `tests/purchase/adjustment-in.test.ts`

```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions/guard";
import { docTimestamp, postIssue, withInventoryTx } from "@/server/inventory";
import { cancelAdjustmentInTx, createAdjustmentInIdempotent, getAdjustmentIn, listAdjustmentsIn } from "@/server/purchase/adjustment-in";
import { lastPurchaseCost } from "@/server/purchase/last-cost";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { parseListParams } from "@/lib/query-params";
import { prisma } from "../helpers/db";
import { assertLedgerBalanced, useNoopCostOwners } from "../inventory/helpers";
import { input, todayIct, world, type World } from "./helpers";

useNoopCostOwners();
let w: World;
let keeper: World["actor"]; // Thủ kho: stock_adjust.manage nhưng KHÔNG cost.view
beforeEach(async () => {
  w = await world();
  w.actor.perms.add("stock_adjust.manage");
  keeper = { userId: w.actor.userId, perms: new Set(["stock_adjust.manage"]) };
});

const adj = (over: Record<string, unknown> = {}) => ({ date: todayIct(), note: "", lines: [{ productId: w.tonId, qty: 10, unitCost: null as number | null }], ...over });
const buy = (price = 20_000, freight = 0) => createPurchaseIdempotent(prisma, w.actor, `b-${Math.random()}`, input(w, {
  freightCost: freight, lines: [{ productId: w.tonId, qty: 100, unit: "md", factor: 1, purchasePrice: price, rollInfo: "" }],
}));

describe("lastPurchaseCost — giá vốn lô của lần nhập MUA gần nhất (theo đơn vị gốc, gồm cước)", () => {
  it("chưa từng nhập mua → null; có → giá lô mới nhất; phiếu đã hủy không tính", async () => {
    expect(await lastPurchaseCost(prisma, w.tonId)).toBeNull();
    await buy(20_000);
    const b = await buy(22_000, 100_000); // (2.200.000 + 100.000) / 100 = 23.000
    expect((await lastPurchaseCost(prisma, w.tonId))!.toString()).toBe("23000");
    const { cancelPurchaseTx } = await import("@/server/purchase/service");
    await cancelPurchaseTx(prisma, w.actor, b.id, "sai");
    expect((await lastPurchaseCost(prisma, w.tonId))!.toString()).toBe("20000");
  });
});

describe("createAdjustmentInIdempotent", () => {
  it("mặc định giá = giá nhập gần nhất; sinh lớp ADJ_IN, dòng sổ, mã NK000001; KHÔNG sinh công nợ", async () => {
    await buy(20_000);
    const r = await createAdjustmentInIdempotent(prisma, keeper, "k1", adj());
    expect(r).toEqual({ id: expect.any(Number), code: "NK000001" });
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "ADJ_IN", sourceDocId: r.id } });
    expect([layer.qtyIn.toString(), layer.unitCost.toString()]).toEqual(["10", "20000"]);
    expect(await prisma.partnerLedger.count({ where: { docId: r.id } })).toBe(0);
    const line = await prisma.stockAdjustmentLine.findFirstOrThrow({ where: { adjustmentId: r.id } });
    expect(line.seq).not.toBeNull();
    expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: r.id } })).type).toBe("IN_NO_SUPPLIER");
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("nhập tay đơn giá (cần cost.view) — ghi đè mặc định", async () => {
    await buy(20_000);
    const r = await createAdjustmentInIdempotent(prisma, w.actor, "k2", adj({ lines: [{ productId: w.tonId, qty: 5, unitCost: 18_500 }] }));
    expect((await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: r.id, sourceDocType: "ADJ_IN" } })).unitCost.toString()).toBe("18500");
  });

  it("[Review Focus 9] mã chưa từng nhập mua & không nhập giá → 400 hướng dẫn, KHÔNG tạo lớp giá 0", async () => {
    await expect(createAdjustmentInIdempotent(prisma, w.actor, "k3", adj())).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Chưa có giá nhập gần nhất.*TL045/) });
    expect(await prisma.costLayer.count()).toBe(0);
    expect(await prisma.stockAdjustment.count()).toBe(0);
  });

  it("[Review Focus 9] người KHÔNG có cost.view: nhập kèm đơn giá → 403; để trống (dùng giá mặc định) → được", async () => {
    await buy(20_000);
    await expect(createAdjustmentInIdempotent(prisma, keeper, "k4", adj({ lines: [{ productId: w.tonId, qty: 1, unitCost: 5 }] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAdjustmentInIdempotent(prisma, keeper, "k5", adj())).resolves.toMatchObject({ code: expect.stringMatching(/^NK/) });
    await expect(createAdjustmentInIdempotent(prisma, { ...keeper, perms: new Set() }, "k6", adj())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nhập bù đơn treo: dòng bán trước đó (bán âm kho) được khớp khi nhập không NCC (mục 3.3)", async () => {
    await buy(20_000);
    await withInventoryTx(prisma, { userId: w.actor.userId, products: [w.tonId] }, (ctx) => postIssue(ctx, { productId: w.tonId, qty: 130, docType: "SALE", docId: 1, docLineId: 1, at: docTimestamp(todayIct(), new Date()) }));
    expect((await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } })).qtyProvisional.toString()).toBe("30");
    await createAdjustmentInIdempotent(prisma, w.actor, "k7", adj({ lines: [{ productId: w.tonId, qty: 30, unitCost: 21_000 }] }));
    expect((await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } })).qtyProvisional.toString()).toBe("0");
    await assertLedgerBalanced(w.tonId, w.periodId);
  });

  it("[Review Focus 2] cùng Idempotency-Key gửi đồng thời → 1 phiếu, 1 lớp", async () => {
    await buy(20_000);
    const rs = await Promise.all(Array.from({ length: 3 }, () => createAdjustmentInIdempotent(prisma, w.actor, "dup", adj())));
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect(await prisma.stockAdjustment.count()).toBe(1);
    expect(await prisma.costLayer.count({ where: { sourceDocType: "ADJ_IN" } })).toBe(1);
  });

  it("ngày tương lai → 400; số lượng ≤ 0 bị schema chặn", async () => {
    await buy(20_000);
    await expect(createAdjustmentInIdempotent(prisma, w.actor, "f", adj({ date: todayIct(1) }))).rejects.toMatchObject({ status: 400 });
  });
});

describe("cancelAdjustmentInTx", () => {
  it("gỡ lớp + dòng sổ, đánh dấu hủy có lý do, audit; hủy 2 lần → 409; kỳ đã kết sổ → 'không sửa/hủy được'", async () => {
    await buy(20_000);
    const r = await createAdjustmentInIdempotent(prisma, w.actor, "k", adj());
    await cancelAdjustmentInTx(prisma, w.actor, r.id, "nhập nhầm");
    expect(await prisma.costLayer.count({ where: { sourceDocType: "ADJ_IN" } })).toBe(0);
    expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: r.id } })).isCancelled).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "stock_adjustment.cancel" } })).toBe(1);
    await expect(cancelAdjustmentInTx(prisma, w.actor, r.id, "x")).rejects.toMatchObject({ status: 409 });
    const r2 = await createAdjustmentInIdempotent(prisma, w.actor, "k2", adj());
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null } });
    await prisma.period.create({ data: { name: "Kỳ mới", status: "OPEN", isOpen: true } });
    await expect(cancelAdjustmentInTx(prisma, w.actor, r2.id, "x")).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
  });
});

describe("listAdjustmentsIn / getAdjustmentIn", () => {
  it("[Review Focus 5] người thiếu cost.view không thấy giá vốn của dòng; có quyền thì thấy", async () => {
    await buy(20_000);
    const r = await createAdjustmentInIdempotent(prisma, w.actor, "k", adj());
    const d1 = await getAdjustmentIn(prisma, w.actor, r.id);
    const d2 = await getAdjustmentIn(prisma, keeper, r.id);
    expect(d1.lines[0]).toMatchObject({ productCode: "TL045", qty: "10", unitCost: "20000" });
    expect(JSON.stringify(d2)).not.toContain("unitCost");
    expect(d2.lines[0]).toMatchObject({ qty: "10" });
    const list = await listAdjustmentsIn(prisma, keeper, parseListParams({}, ["status"]));
    expect(list.rows[0]).toMatchObject({ code: "NK000001", lineCount: 1, isCancelled: false });
    expect(list.total).toBe(1);
  });
});
```

- [ ] **Step 2: Chạy → đỏ**; **Step 3: Viết `last-cost.ts` và `adjustment-in.ts`**

```ts
// src/server/purchase/last-cost.ts
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Giá vốn (theo đơn vị GỐC, đã gồm cước phân bổ) của lô nhập MUA gần nhất của mã hàng — mặc định cho nhập không NCC
 * (spec 6.10) và gợi ý giá nhập ở màn bán hàng (plan 04). Xét mọi kỳ (giá nhập gần nhất không dừng ở ranh giới kỳ);
 * lô của phiếu đã hủy đã bị gỡ khỏi `cost_layers` nên không tính.
 */
export async function lastPurchaseCost(db: Prisma.TransactionClient | PrismaClient, productId: number): Promise<Prisma.Decimal | null> {
  const layer = await db.costLayer.findFirst({
    where: { productId, sourceDocType: "PURCHASE" },
    orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }],
    select: { unitCost: true },
  });
  return layer?.unitCost ?? null;
}
```

Schema zod tách file RIÊNG (thuần zod) để form phía trình duyệt import được mà không kéo prisma/engine vào bundle:

```ts
// src/server/purchase/adjustment-schemas.ts
import { z } from "zod";

export const adjustmentInSchema = z.object({
  date: z.string({ required_error: "Chọn ngày." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ."),
  note: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự."),
  lines: z.array(z.object({
    productId: z.number({ required_error: "Chọn sản phẩm.", invalid_type_error: "Chọn sản phẩm." }).int().positive("Chọn sản phẩm."),
    /** Theo ĐƠN VỊ GỐC (hàng lệch/dư đếm tại kho). */
    qty: z.number({ required_error: "Nhập số lượng.", invalid_type_error: "Nhập số lượng." }).gt(0, "Số lượng phải lớn hơn 0.").max(999_999_999, "Số lượng quá lớn."),
    /** null = dùng giá nhập gần nhất. Nhập tay cần quyền cost.view. */
    unitCost: z.number({ invalid_type_error: "Nhập đơn giá." }).min(0, "Đơn giá không được âm.").max(9_999_999_999, "Đơn giá quá lớn.").nullable(),
  })).min(1, "Thêm ít nhất 1 dòng hàng.").max(200, "Tối đa 200 dòng."),
});
export type AdjustmentInInput = z.infer<typeof adjustmentInSchema>;

```

```ts
// src/server/purchase/adjustment-in.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, PeriodClosedError, postReceipt, productsOfDocument, removeDocument, withInventoryTx, type EngineCtx } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "./codes";
import { lastPurchaseCost } from "./last-cost";

import { adjustmentInSchema, type AdjustmentInInput } from "./adjustment-schemas";

export { adjustmentInSchema, type AdjustmentInInput };


const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function createAdjustmentIn(ctx: EngineCtx, actor: Actor, input: AdjustmentInInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "stock_adjust.manage");
  const tx = ctx.tx;
  if (input.lines.some((l) => l.unitCost !== null)) assertCan(actor.perms, "cost.view"); // nhập giá vốn tay = biết/quyết giá vốn
  const products = await tx.product.findMany({ where: { id: { in: sortedUnique(input.lines.map((l) => l.productId)) } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const costs: Prisma.Decimal[] = [];
  for (const [i, l] of input.lines.entries()) {
    const p = byId.get(l.productId);
    if (!p) throw new DomainError(`Dòng ${i + 1}: sản phẩm không tồn tại.`, 400);
    if (!p.isActive) throw new DomainError(`Dòng ${i + 1}: sản phẩm ${p.code} đã ngừng bán.`, 400);
    const cost = l.unitCost !== null ? D(l.unitCost) : await lastPurchaseCost(tx, p.id);
    if (cost === null) throw new DomainError(`Chưa có giá nhập gần nhất của ${p.code} — hãy nhập đơn giá (cần quyền xem giá vốn) hoặc lập phiếu nhập mua trước.`, 400);
    costs.push(cost);
  }
  const at = docTimestamp(input.date, now);
  const id = await nextDocId(tx, "stock_adjustments");
  const code = formatDocCode("NK", id);
  await tx.stockAdjustment.create({ data: { id, code, periodId: ctx.period.id, type: "IN_NO_SUPPLIER", at, note: input.note || null, createdBy: actor.userId } });
  for (const [i, l] of input.lines.entries()) {
    const row = await tx.stockAdjustmentLine.create({ data: { adjustmentId: id, productId: l.productId, qty: D(l.qty), unitCost: costs[i]! } });
    const { seq } = await postReceipt(ctx, { productId: l.productId, qty: l.qty, unitCost: costs[i]!, docType: "ADJ_IN", docId: id, docLineId: row.id, at });
    await tx.stockAdjustmentLine.update({ where: { id: row.id }, data: { seq } });
  }
  await writeAudit(tx, { userId: actor.userId, action: "stock_adjustment.create", entity: "StockAdjustment", entityId: id, after: { code, type: "IN_NO_SUPPLIER", lineCount: input.lines.length } });
  return { id, code };
}

export async function createAdjustmentInIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: AdjustmentInInput) {
  assertCan(actor.perms, "stock_adjust.manage");
  return withIdempotentInventoryTx(
    prisma, { userId: actor.userId, products: sortedUnique(input.lines.map((l) => l.productId)), scope: "stock_adjustment_in.create", key },
    (ctx) => createAdjustmentIn(ctx, actor, input),
  );
}

export async function cancelAdjustmentIn(ctx: EngineCtx, actor: Actor, id: number, reason: string, now: Date = new Date()): Promise<void> {
  assertCan(actor.perms, "stock_adjust.manage");
  const tx = ctx.tx;
  await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
  const cur = await tx.stockAdjustment.findUnique({ where: { id } });
  if (!cur) throw new DomainError("Không tìm thấy phiếu nhập kho.", 404);
  if (cur.isCancelled) throw new DomainError("Phiếu đã hủy trước đó.", 409);
  if (cur.periodId !== ctx.period.id) throw new PeriodClosedError();
  if ((await productsOfDocument(tx, "ADJ_IN", id)).some((p) => !ctx.locked.has(p))) throw new DomainError("Phiếu vừa được người khác sửa, hãy tải lại trang rồi thử lại.", 409);
  await removeDocument(ctx, "ADJ_IN", id);
  await tx.stockAdjustment.update({ where: { id }, data: { isCancelled: true, cancelledAt: now, cancelledBy: actor.userId, cancelReason: reason } });
  await writeAudit(tx, { userId: actor.userId, action: "stock_adjustment.cancel", entity: "StockAdjustment", entityId: id, before: { code: cur.code }, after: { isCancelled: true, reason } });
}

export async function cancelAdjustmentInTx(prisma: PrismaClient, actor: Actor, id: number, reason: string) {
  assertCan(actor.perms, "stock_adjust.manage");
  const pre = await prisma.stockAdjustment.findUnique({ where: { id }, select: { periodId: true } });
  if (!pre) throw new DomainError("Không tìm thấy phiếu nhập kho.", 404);
  return withInventoryTx(prisma, { userId: actor.userId, periodId: pre.periodId, products: await productsOfDocument(prisma, "ADJ_IN", id) }, (ctx) => cancelAdjustmentIn(ctx, actor, id, reason));
}

// ── đọc (đã lọc theo quyền) ──
export interface AdjustmentRowDTO { id: number; code: string; at: Date; note: string | null; lineCount: number; isCancelled: boolean; createdByName: string | null }
export interface AdjustmentDetailDTO extends Omit<AdjustmentRowDTO, "lineCount"> {
  cancelReason: string | null;
  lines: { id: number; productId: number; productCode: string; productName: string; baseUnit: string; qty: string; unitCost?: string }[];
}

export async function listAdjustmentsIn(db: Prisma.TransactionClient | PrismaClient, actor: Actor, params: ListParams) {
  const period = await getOpenPeriod(db);
  const status = params.filters.status?.[0];
  const where: Prisma.StockAdjustmentWhereInput = { type: "IN_NO_SUPPLIER", periodId: period.id, ...(status === "cancelled" ? { isCancelled: true } : status === "active" ? { isCancelled: false } : {}) };
  const base: Prisma.StockAdjustmentWhereInput = { type: "IN_NO_SUPPLIER", periodId: period.id };
  const [rows, total, all, cancelled] = await Promise.all([
    db.stockAdjustment.findMany({ where, orderBy: [sortToOrderBy(params.sort, ["code", "at"], { at: "desc" }), { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize, include: { _count: { select: { lines: true } } } }),
    db.stockAdjustment.count({ where }), db.stockAdjustment.count({ where: base }), db.stockAdjustment.count({ where: { ...base, isCancelled: true } }),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const dto: AdjustmentRowDTO[] = rows.map((r) => ({ id: r.id, code: r.code, at: r.at, note: r.note, lineCount: r._count.lines, isCancelled: r.isCancelled, createdByName: names.get(r.createdBy) ?? null }));
  return { rows: dto, total, stats: { all, active: all - cancelled, cancelled } };
}

export async function getAdjustmentIn(db: Prisma.TransactionClient | PrismaClient, actor: Actor, id: number): Promise<AdjustmentDetailDTO> {
  const a = await db.stockAdjustment.findUnique({ where: { id }, include: { lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, baseUnit: true } } } } } });
  if (!a || a.type !== "IN_NO_SUPPLIER") throw new DomainError("Không tìm thấy phiếu nhập kho.", 404);
  const creator = await db.user.findUnique({ where: { id: a.createdBy }, select: { fullName: true } });
  const dto: AdjustmentDetailDTO = {
    id: a.id, code: a.code, at: a.at, note: a.note, isCancelled: a.isCancelled, cancelReason: a.cancelReason, createdByName: creator?.fullName ?? null,
    lines: a.lines.map((l) => ({ id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, baseUnit: l.product.baseUnit, qty: l.qty.toString(), unitCost: l.unitCost.toString() })),
  };
  return redactDeep(dto, actor.perms); // unitCost (cost.view)
}
```

- [ ] **Step 4: Chạy → xanh** (`rtk proxy npx vitest run tests/purchase/adjustment-in.test.ts`).

- [ ] **Step 5: Routes + giao diện.**

`src/app/api/stock-adjustments-in/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { createAdjustmentInIdempotent } from "@/server/purchase/adjustment-in";
import { adjustmentInSchema } from "@/server/purchase/adjustment-schemas";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("stock_adjust.manage");
  const key = readIdempotencyKey(req);
  return createAdjustmentInIdempotent(prisma, actor, key, adjustmentInSchema.parse(await readJson(req)));
});
```

`src/app/api/stock-adjustments-in/[id]/cancel/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelAdjustmentInTx } from "@/server/purchase/adjustment-in";
import { cancelPurchaseSchema } from "@/server/purchase/schemas";

export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("stock_adjust.manage");
  const id = idParam.parse((await ctx.params).id);
  await cancelAdjustmentInTx(prisma, actor, id, cancelPurchaseSchema.parse(await readJson(req)).reason);
  return { ok: true };
});
```

`src/components/purchase/AdjustmentInForm.tsx` (khuôn `PurchaseFormFields`, gọn hơn: không NCC/cước/quy đổi — số lượng luôn theo ĐƠN VỊ GỐC):

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Combobox } from "@/components/ui/Combobox";
import { Field, inputClass } from "@/components/ui/Field";
import { NewPage } from "@/components/ui/NewPage";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ProductOption } from "@/server/products/queries";
import { adjustmentInSchema, type AdjustmentInInput } from "@/server/purchase/adjustment-schemas";

const emptyLine = { productId: undefined, qty: undefined, unitCost: null } as unknown as AdjustmentInInput["lines"][number];
/** Ô đơn giá để trống ⇒ null (dùng giá nhập gần nhất); KHÔNG ép thành 0. */
const costValue = (v: unknown) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/** `canSetCost` = cost.view: thấy/nhập giá vốn tay. Không có → ô đơn giá không hiện, server dùng giá nhập gần nhất. */
export function AdjustmentInForm({ today, canSetCost }: { today: string; canSetCost: boolean }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [meta, setMeta] = useState<Record<number, ProductOption>>({});
  const form = useForm<AdjustmentInInput>({ resolver: zodResolver(adjustmentInSchema), defaultValues: { date: today, note: "", lines: [emptyLine] } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const { register, control, formState: { errors } } = form;

  const load = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setMeta((m) => ({ ...m, ...Object.fromEntries(rows.map((r) => [r.value, r])) }));
    return rows;
  };
  const submit = form.handleSubmit(async (v) => {
    const r = await apiFetch<{ id: number }>("/api/stock-adjustments-in", { method: "POST", json: v, idempotencyKey: idem.key });
    router.replace(`/purchase/adjustments-in/${r.id}`);
  });

  return (
    <NewPage backHref="/purchase/adjustments-in" backLabel="Quay lại nhập kho không NCC" title="Nhập kho không NCC" submitLabel="Lưu phiếu"
      isDirty={() => form.formState.isDirty} onSubmit={async () => { await submit(); }}>
      <div className="space-y-5">
        <p className="text-sm text-fg-secondary">Cho hàng lệch, hàng dư không theo nhà cung cấp. Tạo lô FIFO mới, <strong>không sinh công nợ</strong>. Số lượng tính theo đơn vị gốc.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="date" label="Ngày nhập" error={errors.date?.message}>
            <input id="date" type="date" max={today} {...register("date")} aria-invalid={!!errors.date} className={inputClass(errors.date)} />
          </Field>
          <Field id="note" label="Ghi chú" error={errors.note?.message}>
            <input id="note" {...register("note")} className={inputClass(errors.note)} />
          </Field>
        </div>
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">
              <th className="w-72 px-2 py-2">Sản phẩm</th><th className="w-40 px-2 py-2 text-right">Số lượng (đv gốc)</th>
              {canSetCost && <th className="w-48 px-2 py-2 text-right">Đơn giá vốn</th>}<th className="w-10 px-2 py-2" />
            </tr></thead>
            <tbody>
              {fields.map((f, i) => {
                const e = errors.lines?.[i];
                const pid = form.watch(`lines.${i}.productId`);
                const p = meta[pid as number];
                return (
                  <tr key={f.id} className="border-b border-border align-top last:border-b-0">
                    <td className="px-2 py-2 [&_label]:sr-only">
                      <Controller control={control} name={`lines.${i}.productId`} render={({ field }) => (
                        <Combobox label={`Sản phẩm dòng ${i + 1}`} value={p ?? null} loadOptions={load} placeholder="Tìm mã, tên…"
                          onChange={(o) => { if (o) setMeta((m) => ({ ...m, [o.value]: o as ProductOption })); field.onChange(o ? Number(o.value) : undefined); }}
                          {...(e?.productId?.message ? { error: e.productId.message } : {})} />
                      )} />
                    </td>
                    <td className="px-2 py-2">
                      <input aria-label={`Số lượng dòng ${i + 1}`} type="number" min={0} step="any" {...register(`lines.${i}.qty`, { valueAsNumber: true })} aria-invalid={!!e?.qty} className={`${inputClass(e?.qty)} tabular text-right`} />
                      {p && <p className="mt-1 text-right text-xs text-fg-muted">{p.baseUnit}</p>}
                      {e?.qty?.message && <p className="mt-1 text-xs text-danger">{e.qty.message}</p>}
                    </td>
                    {canSetCost && (
                      <td className="px-2 py-2">
                        <input aria-label={`Đơn giá vốn dòng ${i + 1}`} type="number" min={0} step="any" placeholder="Mặc định: giá nhập gần nhất" {...register(`lines.${i}.unitCost`, { setValueAs: costValue })} className={`${inputClass(e?.unitCost)} tabular text-right`} />
                        {e?.unitCost?.message && <p className="mt-1 text-xs text-danger">{e.unitCost.message}</p>}
                      </td>
                    )}
                    <td className="px-2 py-2"><button type="button" aria-label={`Xóa dòng ${i + 1}`} onClick={() => remove(i)} disabled={fields.length === 1} className="flex h-9 w-9 items-center justify-center rounded-sm text-danger hover:bg-hover disabled:opacity-40"><Trash2 size={16} aria-hidden /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {typeof errors.lines?.message === "string" && <p role="alert" className="text-xs text-danger">{errors.lines.message}</p>}
        <button type="button" onClick={() => append(emptyLine)} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-9"><Plus size={14} aria-hidden /> Thêm dòng</button>
      </div>
    </NewPage>
  );
}
```

`src/components/purchase/AdjustmentInTable.tsx`:

```tsx
"use client";

import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { AdjustmentRowDTO } from "@/server/purchase/adjustment-in";

const BASE = "/purchase/adjustments-in";

export function AdjustmentInTable({ rows, params }: { rows: AdjustmentRowDTO[]; params: ListParams }) {
  const columns: Column<AdjustmentRowDTO>[] = [
    { key: "code", label: "Mã phiếu", sortable: true, primaryOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "at", label: "Ngày nhập", sortable: true, render: (r) => formatDate(r.at) },
    { key: "lineCount", label: "Số dòng", align: "right", render: (r) => r.lineCount },
    { key: "note", label: "Ghi chú", render: (r) => r.note },
    { key: "status", label: "Trạng thái", render: (r) => (r.isCancelled ? <Badge tone="danger">Đã hủy</Badge> : <Badge tone="success">Hiệu lực</Badge>) },
    { key: "createdBy", label: "Người lập", hiddenByDefault: true, render: (r) => r.createdByName },
  ];
  const actions = (r: AdjustmentRowDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${r.id}` }];
  return <DataTable id="adjustments-in" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `${BASE}/${r.id}`} rowActions={actions}
    sort={params.sort} buildSortHref={(s) => buildListHref(BASE, params, { sort: s })} />;
}
```

`src/components/purchase/AdjustmentInDetail.tsx`:

```tsx
"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { AdjustmentDetailDTO } from "@/server/purchase/adjustment-in";

export function AdjustmentInDetail({ adjustment: x, canCancel }: { adjustment: AdjustmentDetailDTO; canCancel: boolean }) {
  const router = useRouter();
  const nav = useDetailNav(["info"]);
  const [open, setOpen] = useState(false);
  const showCost = x.lines.some((l) => l.unitCost !== undefined);

  async function cancel(reason: string) {
    await apiFetch(`/api/stock-adjustments-in/${x.id}/cancel`, { method: "POST", json: { reason } });
    toast.success("Đã hủy phiếu nhập kho.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {x.isCancelled && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Phiếu đã hủy. Lý do: {x.cancelReason}. Lô hàng của phiếu đã được gỡ.</div>}
      <DetailPage
        backHref="/purchase/adjustments-in" backLabel="Quay lại nhập kho không NCC"
        headerActions={canCancel && !x.isCancelled ? (
          <button type="button" onClick={() => setOpen(true)} className="flex h-11 items-center gap-2 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-hover md:h-10"><Ban size={16} aria-hidden /> Hủy phiếu</button>
        ) : undefined}
        summary={{
          title: x.code, code: "Nhập kho không NCC",
          badges: [x.isCancelled ? { label: "Đã hủy", tone: "danger" } : { label: "Hiệu lực", tone: "success" }],
          facts: [{ label: "Ngày nhập", value: formatDate(x.at) }, { label: "Số dòng", value: x.lines.length }, { label: "Người lập", value: x.createdByName ?? "—" }],
        }}
        tabs={[{
          key: "info", label: "Chi tiết",
          render: () => (
            <div className="space-y-4">
              <dl><DetailField label="Ghi chú">{x.note}</DetailField><DetailField label="Ngày lập">{formatDateTime(x.at)}</DetailField></dl>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs font-semibold uppercase text-fg-secondary"><th className="py-2">Sản phẩm</th><th className="py-2 text-right">Số lượng</th>{showCost && <th className="py-2 text-right">Giá vốn/đv</th>}</tr></thead>
                <tbody>{x.lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-b-0">
                    <td className="py-2"><span className="font-mono text-xs">{l.productCode}</span> {l.productName}</td>
                    <td className="tabular py-2 text-right">{formatQty(l.qty)} {l.baseUnit}</td>
                    {showCost && <td className="tabular py-2 text-right">{formatCurrency(l.unitCost)}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ),
        }]}
        {...nav}
      />
      <ReasonDialog open={open} onClose={() => setOpen(false)} title={`Hủy phiếu ${x.code}?`} confirmLabel="Hủy phiếu" onConfirm={cancel}
        description="Lô hàng của phiếu bị gỡ; các đơn bán đã ăn lô này sẽ thành đơn treo chờ nhập bù. Không hoàn tác được." />
    </div>
  );
}
```

Trang (`requireActor(` trong từng file):

```tsx
// src/app/(app)/purchase/adjustments-in/page.tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { AdjustmentInTable } from "@/components/purchase/AdjustmentInTable";
import { EmptyState, ListPageLayout, PaginationFooter, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { listAdjustmentsIn } from "@/server/purchase/adjustment-in";

const BASE = "/purchase/adjustments-in";

export default async function AdjustmentsInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock_adjust.manage");
  const params = parseListParams(await searchParams, ["status"]);
  const { rows, total, stats } = await listAdjustmentsIn(prisma, actor, params);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const status = params.filters.status?.[0];
  return (
    <ListPageLayout
      title="Nhập kho không NCC"
      actions={<Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Lập phiếu</Link>}
      stats={<>
        <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
        <StatCard label="Hiệu lực" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
        <StatCard label="Đã hủy" value={stats.cancelled} tone="danger" href={href({ filters: { status: ["cancelled"] } })} active={status === "cancelled"} />
      </>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0
        ? <EmptyState kind="empty" title="Chưa có phiếu nhập kho không NCC trong kỳ này" action={<Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Lập phiếu đầu tiên</Link>} />
        : <AdjustmentInTable rows={rows} params={params} />}
    </ListPageLayout>
  );
}
```

```tsx
// src/app/(app)/purchase/adjustments-in/new/page.tsx
import { AdjustmentInForm } from "@/components/purchase/AdjustmentInForm";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";

export default async function NewAdjustmentInPage() {
  const actor = await requireActor("stock_adjust.manage");
  return <AdjustmentInForm today={ictYmd(new Date())} canSetCost={actor.perms.has("cost.view")} />;
}
```

```tsx
// src/app/(app)/purchase/adjustments-in/[id]/page.tsx
import { notFound } from "next/navigation";
import { AdjustmentInDetail } from "@/components/purchase/AdjustmentInDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getAdjustmentIn } from "@/server/purchase/adjustment-in";

const MAX_INT32 = 2_147_483_647;

export default async function AdjustmentInDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("stock_adjust.manage");
  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0;
  if (id <= 0 || id > MAX_INT32) notFound();
  const adjustment = await getAdjustmentIn(prisma, actor, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  return <AdjustmentInDetail adjustment={JSON.parse(JSON.stringify(adjustment))} canCancel />;
}
```

Test UI `tests/ui/adjustment-in-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustmentInForm } from "@/components/purchase/AdjustmentInForm";
import { ApiError } from "@/lib/api-fetch";

const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const ton = { value: 11, label: "TL045 — Tôn lạnh 0.45", hint: "md", baseUnit: "md", kind: "HANG", units: [] };
beforeEach(() => {
  replace.mockReset(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/products/search")) return [ton];
    if (url === "/api/stock-adjustments-in") return { id: 4, code: "NK000004" };
    throw new Error(`URL ngoài dự kiến: ${url}`);
  });
});
afterEach(cleanup);
const post = () => apiFetch.mock.calls.find((c) => c[0] === "/api/stock-adjustments-in");
async function pickProduct() {
  await userEvent.click(screen.getByRole("combobox", { name: "Sản phẩm dòng 1" }));
  await userEvent.click(await screen.findByRole("option", { name: /TL045/ }));
}

describe("AdjustmentInForm", () => {
  it("form rỗng → 'Chọn sản phẩm.', 'Nhập số lượng.'; không gọi API", async () => {
    render(<AdjustmentInForm today="2026-09-27" canSetCost />);
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    expect(await screen.findByText("Chọn sản phẩm.")).toBeInTheDocument();
    expect(screen.getByText("Nhập số lượng.")).toBeInTheDocument();
    expect(post()).toBeUndefined();
  });

  it("[Review Focus 9] thiếu cost.view → KHÔNG có ô đơn giá vốn; payload unitCost = null (server dùng giá nhập gần nhất)", async () => {
    render(<AdjustmentInForm today="2026-09-27" canSetCost={false} />);
    expect(screen.queryByLabelText(/Đơn giá vốn/)).toBeNull();
    await pickProduct();
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/purchase/adjustments-in/4"));
    const [, init] = post()!;
    expect(init.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(init.json).toMatchObject({ date: "2026-09-27", lines: [{ productId: 11, qty: 10, unitCost: null }] });
  });

  it("có cost.view: để trống đơn giá → null; nhập 18500 → 18500", async () => {
    render(<AdjustmentInForm today="2026-09-27" canSetCost />);
    await pickProduct();
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "5");
    await userEvent.type(screen.getByLabelText("Đơn giá vốn dòng 1"), "18500");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    await vi.waitFor(() => expect(post()).toBeDefined());
    expect(post()![1].json.lines[0]).toMatchObject({ qty: 5, unitCost: 18500 });
  });

  it("máy chủ báo chưa có giá nhập gần nhất → banner hướng dẫn, giữ dữ liệu, không chuyển trang", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/products/search")) return [ton];
      throw new ApiError(400, "Chưa có giá nhập gần nhất của TL045 — hãy nhập đơn giá (cần quyền xem giá vốn) hoặc lập phiếu nhập mua trước.");
    });
    render(<AdjustmentInForm today="2026-09-27" canSetCost />);
    await pickProduct();
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    expect(await screen.findByText(/Chưa có giá nhập gần nhất của TL045/)).toBeInTheDocument();
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue(5);
    expect(replace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Mở menu (`stock-in-adj`), kiểm tay** (tạo mã mới chưa từng nhập mua → thấy lỗi hướng dẫn; nhập kèm đơn giá), lint/typecheck/test, commit:

```bash
git add -A src tests
git commit -m "feat(purchase): nhập kho không NCC (mã 21) — giá mặc định = giá nhập gần nhất, không sinh công nợ, hủy có lý do"
```

---

### Task 14: Báo cáo kho — backend (tồn hiện tại, thẻ kho, XNT, tra cứu cuộn, tồn theo SP)

**Mã:** 22, 23, 24, 25, 30. **Files:**
- Create: `src/server/inventory-reports/{labels,on-hand,stock-card,xnt,rolls,product-stock,export}.ts`
- Test: `tests/inventory-reports/{helpers.ts,on-hand,stock-card,xnt,rolls,product-stock,perf}.test.ts`

**Interfaces:**
- Consumes: bảng `stock_ledger`, `cost_layers`, `products`, `purchase_lines`, `purchases`; `getOpenPeriod`; `redactDeep`; `listTimeRange`; `escapeLike`, `normalizeSearch`; `unitCostOf` không cần.
- Produces (DTO đã lọc theo quyền, `Decimal` → chuỗi):
  - `STOCK_FILTER_KEYS = ["stock", "kind"]`; `onHandList(db, actor, params, opts?: { forceStock?: "below" }): Promise<{ rows: StockRowDTO[]; total; stats: { products: number; inStock: number; below: number; pending: number } }>`
  - `stockCard(db, actor, q: { productId: number; periodId?: number; from?: Date; to?: Date; page: number; pageSize: number }): Promise<{ product; opening: { qty: string }; rows: StockCardRowDTO[]; total }>`
  - `xntReport(db, actor, q: { periodId?: number; from?: Date; to?: Date; q?: string; page; pageSize }): Promise<{ rows: XntRowDTO[]; total; totals: XntTotalsDTO }>`
  - `rollLookup(db, actor, params): Promise<{ rows: RollRowDTO[]; total }>`, `ROLL_FILTER_KEYS`
  - `productStock(db, actor, productId): Promise<ProductStockDTO>`
  - `docLabel(docType: string): string`, `docHref(docType: string, docId: number): string | null`

**Định nghĩa số liệu (khoá cho mọi màn):**
- **Tồn hiện tại** = Σ `cost_layers.qtyRemaining` − Σ `stock_stock_ledger.qtyProvisional` (âm khi đang bán âm kho — engine `getOnHand`). **Chờ nhập bù** = Σ `qtyProvisional`.
- **Số dư thẻ kho** = số dư tích luỹ `Σ(qtyIn − qtyOut)` theo thứ tự `(at, seq)` — **tính bằng hàm cửa sổ khi đọc**, không lưu (spec 1.3). Số dư cuối = tồn hiện tại **trừ** chờ nhập bù (vì phần xuất treo đã ghi ở `qtyOut`).
- **XNT giá trị** = Σ giá trị nhập (`qtyIn × layer.unitCost`) − Σ giá trị xuất (`qtyOut × unitCostOut`) — *giá trị sổ*; phần xuất treo tính theo giá tạm nên tồn cuối có đơn treo không bằng đúng "Σ lớp còn lại × giá" (đã ghi ở mục "Cần khách xác nhận"). Dòng `OPENING` luôn tính vào **tồn đầu** dù `at` nằm trong khoảng.

- [ ] **Step 1: Helper test dựng dữ liệu kho thật** — `tests/inventory-reports/helpers.ts`

```ts
import { ictStartOfDay, toIct } from "@/lib/time";
import { docTimestamp, postIssue, withInventoryTx } from "@/server/inventory";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { prisma } from "../helpers/db";
import { input, todayIct, world, type World } from "../purchase/helpers";

export interface StockWorld extends World { at: (offsetDays: number) => Date; /** 00:00 ICT của ngày (hôm nay + offset) — mốc "from" chuẩn cho báo cáo */ startOf: (offsetDays: number) => Date }

/**
 * Tôn TL045 (md): nhập 100 @20.000 (D-2), nhập 50 @22.000 (D-1), bán 120 hôm nay ⇒ tồn 30 @22.000.
 * Giấy bạc GB (m2): bán 5 khi chưa có hàng ⇒ ĐƠN TREO 5.
 */
export async function stockWorld(): Promise<StockWorld> {
  const w = await world();
  w.actor.perms.add("stock.view").add("product.view");
  const line = (productId: number, qty: number, price: number, rollInfo = "") => ({ productId, qty, unit: "md", factor: 1, purchasePrice: price, rollInfo });
  await createPurchaseIdempotent(prisma, w.actor, "p1", input(w, { date: todayIct(-2), lines: [line(w.tonId, 100, 20_000, "Cuộn 5 tấn 0.45")] }));
  await createPurchaseIdempotent(prisma, w.actor, "p2", input(w, { date: todayIct(-1), lines: [line(w.tonId, 50, 22_000)] }));
  const sell = (productId: number, qty: number, docId: number, day = 0) =>
    withInventoryTx(prisma, { userId: w.actor.userId, products: [productId] }, (ctx) => postIssue(ctx, { productId, qty, docType: "SALE", docId, docLineId: docId, at: docTimestamp(todayIct(day), new Date()) }));
  await sell(w.tonId, 120, 1);
  await sell(w.giayId, 5, 2);
  return Object.assign(w, {
    at: (d: number) => new Date(Date.now() + d * 86_400_000),
    startOf: (d: number) => { const t = toIct(new Date(Date.now() + d * 86_400_000)); return ictStartOfDay(t.y, t.m, t.d); },
  });
}
```
(Các test kho gọi `useNoopCostOwners()` từ `tests/inventory/helpers` ở đầu file vì có dòng `SALE`.)

- [ ] **Step 2: `labels.ts`** (nhãn loại chứng từ + liên kết; plan 04/05/06 bổ sung dòng của mình)

```ts
/** Nhãn tiếng Việt của loại chứng từ kho (StockDocType). */
const LABELS: Record<string, string> = {
  OPENING: "Số đầu kỳ", PURCHASE: "Phiếu nhập hàng", ADJ_IN: "Nhập kho không NCC", RETURN_IN: "Khách trả hàng",
  PRODUCTION_OUT: "Thành phẩm sản xuất", STOCKTAKE_IN: "Kiểm kho tăng",
  SALE: "Bán hàng", ADJ_LOSS: "Hao hụt", WRITE_OFF: "Xuất hủy", RETURN_SUPPLIER: "Trả nhà cung cấp",
  PRODUCTION_USE: "Xuất NVL sản xuất", PROCESSING_USE: "Xuất NVL gia công", STOCKTAKE_OUT: "Kiểm kho giảm",
};
export const docLabel = (docType: string): string => LABELS[docType] ?? docType;

/** Liên kết tới chứng từ gốc. CHỈ trả về khi route đã tồn tại (không tạo liên kết chết); plan 04+ thêm dòng của mình. */
export function docHref(docType: string, docId: number): string | null {
  if (docType === "PURCHASE") return `/purchase/orders/${docId}`;
  if (docType === "ADJ_IN") return `/purchase/adjustments-in/${docId}`;
  return null;
}
```

- [ ] **Step 3: Test tồn hiện tại (đỏ)** — `tests/inventory-reports/on-hand.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { onHandList, STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
import { prisma } from "../helpers/db";
import { useNoopCostOwners } from "../inventory/helpers";
import { stockWorld, type StockWorld } from "./helpers";

useNoopCostOwners();
const P = (sp: Record<string, string> = {}) => parseListParams(sp, STOCK_FILTER_KEYS);
let w: StockWorld;
beforeEach(async () => { w = await stockWorld(); });
const rowOf = async (code: string, actor = w.actor, sp: Record<string, string> = {}) => (await onHandList(prisma, actor, P({ q: code, ...sp }))).rows.find((r) => r.code === code)!;

describe("onHandList", () => {
  it("tồn = Σ lớp còn lại − chờ nhập bù; giá trị tồn = Σ lớp còn lại × giá (cần cost.view)", async () => {
    expect(await rowOf("TL045")).toMatchObject({ onHand: "30", pending: "0", stockValue: "660000", baseUnit: "md" });
    expect(await rowOf("GB")).toMatchObject({ onHand: "-5", pending: "5" }); // đơn treo: tồn ÂM, hiện rõ
  });

  it("[Review Focus 5] thiếu cost.view: KHÔNG có stockValue (ở tầng server, không phải ẩn CSS)", async () => {
    const keeper = { userId: 1, perms: new Set(["stock.view"]) };
    const r = await rowOf("TL045", keeper);
    expect(r.onHand).toBe("30");
    expect(JSON.stringify(r)).not.toContain("stockValue");
  });

  it("[Review Focus 1 của 03a] tìm không dấu 'ton', lọc theo loại", async () => {
    await prisma.product.update({ where: { id: w.tonId }, data: { kind: "NVL" } });
    expect((await onHandList(prisma, w.actor, P({ q: "TON" }))).rows.map((r) => r.code)).toEqual(["TL045"]);
    expect((await onHandList(prisma, w.actor, P({ kind: "NVL" }))).rows.map((r) => r.code)).toEqual(["TL045"]);
  });

  it("bộ lọc tồn: in (còn hàng) / zero (hết hoặc âm) / below (dưới định mức) / pending (chờ nhập bù)", async () => {
    await prisma.product.update({ where: { id: w.tonId }, data: { minStock: 50 } });
    const codes = async (stock: string) => (await onHandList(prisma, w.actor, P({ stock }))).rows.map((r) => r.code);
    expect(await codes("in")).toEqual(["TL045"]);
    expect(await codes("zero")).toEqual(["GB"]);
    expect(await codes("below")).toEqual(["TL045"]); // 30 < 50; GB không có định mức
    expect(await codes("pending")).toEqual(["GB"]);
  });

  it("thống kê: số mã / còn hàng / dưới định mức / chờ nhập bù — không lệch theo bộ lọc đang chọn", async () => {
    await prisma.product.update({ where: { id: w.tonId }, data: { minStock: 50 } });
    expect((await onHandList(prisma, w.actor, P({ stock: "pending" }))).stats).toEqual({ products: 2, inStock: 1, below: 1, pending: 1 });
  });

  it("forceStock=below (màn Định mức tồn): chỉ mã dưới định mức, kèm số thiếu", async () => {
    await prisma.product.update({ where: { id: w.tonId }, data: { minStock: 50 } });
    const r = await onHandList(prisma, w.actor, P(), { forceStock: "below" });
    expect(r.rows.map((x) => [x.code, x.shortage])).toEqual([["TL045", "20"]]);
  });

  it("chỉ tính kỳ ĐANG MỞ: lô/dòng sổ của kỳ đã đóng không cộng vào tồn", async () => {
    const closed = await prisma.period.create({ data: { name: "Cũ", status: "CLOSED", isOpen: null } });
    await prisma.stockLedger.create({ data: { periodId: closed.id, productId: w.tonId, docType: "OPENING", docId: 1, docLineId: 1, qtyIn: 999, at: new Date("2020-01-01"), createdBy: w.actor.userId } });
    expect((await rowOf("TL045")).onHand).toBe("30");
  });

  it("phân trang server + sắp xếp (mã, tồn); cột không cho phép bị bỏ qua", async () => {
    const r = await onHandList(prisma, w.actor, { ...P({ sort: "-onHand" }), pageSize: 1 });
    expect([r.total, r.rows.map((x) => x.code)]).toEqual([2, ["TL045"]]);
    await expect(onHandList(prisma, w.actor, P({ sort: "'; DROP TABLE products;--" }))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 4: Viết `src/server/inventory-reports/on-hand.ts`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;

export const STOCK_FILTER_KEYS = ["stock", "kind"] as const;
export type StockFilter = "in" | "zero" | "below" | "pending";

export interface StockRowDTO {
  productId: number; code: string; name: string; baseUnit: string; kind: string; minStock: string;
  onHand: string; pending: string; shortage: string | null;
  /** cost.view — bị redactDeep loại nếu thiếu quyền. */
  stockValue?: string;
}

const KINDS = new Set(["HANG", "NVL", "THANH_PHAM", "PHU_KIEN"]);

/** CTE dùng chung: mỗi mã → Σ lớp còn lại (+ giá trị) và Σ chờ nhập bù, CHỈ của kỳ `periodId`. */
const cte = (periodId: number) => Prisma.sql`
  lay AS (SELECT "productId", SUM("qtyRemaining") AS qty, SUM("qtyRemaining" * "unitCost") AS val FROM cost_layers WHERE "periodId" = ${periodId} GROUP BY "productId"),
  prv AS (SELECT "productId", SUM("qtyProvisional") AS pq FROM stock_ledger WHERE "periodId" = ${periodId} AND "qtyProvisional" > 0 GROUP BY "productId")`;

const ON_HAND = Prisma.sql`(COALESCE(lay.qty, 0) - COALESCE(prv.pq, 0))`;

const stockCond = (f: StockFilter | undefined): Prisma.Sql | null => {
  switch (f) {
    case "in": return Prisma.sql`${ON_HAND} > 0`;
    case "zero": return Prisma.sql`${ON_HAND} <= 0`;
    case "below": return Prisma.sql`p."minStock" > 0 AND ${ON_HAND} < p."minStock"`;
    case "pending": return Prisma.sql`COALESCE(prv.pq, 0) > 0`;
    default: return null;
  }
};

/** Điều kiện chung (không gồm bộ lọc tồn): tìm không dấu, loại. Mã ngừng bán chỉ hiện khi còn tồn khác 0. */
function baseConds(params: ListParams): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [Prisma.sql`(p."isActive" OR ${ON_HAND} <> 0)`];
  for (const t of normalizeSearch(params.q ?? "").split(" ").filter(Boolean)) conds.push(Prisma.sql`p."searchText" LIKE ${"%" + escapeLike(t) + "%"}`);
  const kinds = (params.filters.kind ?? []).filter((k) => KINDS.has(k));
  if (kinds.length) conds.push(Prisma.sql`p."kind"::text IN (${Prisma.join(kinds)})`);
  return conds;
}

const ORDER: Record<string, Prisma.Sql> = {
  code: Prisma.sql`p."code"`, name: Prisma.sql`p."name"`, onHand: Prisma.sql`"onHand"`, minStock: Prisma.sql`p."minStock"`,
};

export async function onHandList(db: Db, actor: Actor, params: ListParams, opts: { forceStock?: StockFilter } = {}) {
  const period = await getOpenPeriod(db);
  const filter = opts.forceStock ?? (["in", "zero", "below", "pending"].includes(params.filters.stock?.[0] ?? "") ? (params.filters.stock![0] as StockFilter) : undefined);
  const conds = baseConds(params);
  const extra = stockCond(filter);
  if (extra) conds.push(extra);
  const where = Prisma.join(conds, " AND ");

  const sortKey = params.sort?.replace(/^-/, "") ?? "";
  const key = Object.hasOwn(ORDER, sortKey) ? sortKey : "code";
  const desc = params.sort?.startsWith("-") && Object.hasOwn(ORDER, sortKey);
  const orderBy = Prisma.sql`${ORDER[key]!} ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`}`;

  const rows = await db.$queryRaw<{
    productId: number; code: string; name: string; baseUnit: string; kind: string; minStock: Prisma.Decimal;
    onHand: Prisma.Decimal; pending: Prisma.Decimal; stockValue: Prisma.Decimal; total: bigint;
  }[]>(Prisma.sql`
    WITH ${cte(period.id)}
    SELECT p.id AS "productId", p.code, p.name, p."baseUnit", p.kind::text AS kind, p."minStock",
           ${ON_HAND} AS "onHand", COALESCE(prv.pq, 0) AS pending, COALESCE(lay.val, 0) AS "stockValue", COUNT(*) OVER() AS total
      FROM products p LEFT JOIN lay ON lay."productId" = p.id LEFT JOIN prv ON prv."productId" = p.id
     WHERE ${where}
     ORDER BY ${orderBy}, p.id
     LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}`);

  // Thống kê KHÔNG áp bộ lọc tồn đang chọn (cùng nguồn với StatCard bấm-để-lọc)
  const [s] = await db.$queryRaw<{ products: bigint; inStock: bigint; below: bigint; pending: bigint }[]>(Prisma.sql`
    WITH ${cte(period.id)}
    SELECT COUNT(*) AS products,
           COUNT(*) FILTER (WHERE ${ON_HAND} > 0) AS "inStock",
           COUNT(*) FILTER (WHERE p."minStock" > 0 AND ${ON_HAND} < p."minStock") AS below,
           COUNT(*) FILTER (WHERE COALESCE(prv.pq, 0) > 0) AS pending
      FROM products p LEFT JOIN lay ON lay."productId" = p.id LEFT JOIN prv ON prv."productId" = p.id
     WHERE ${Prisma.join(baseConds(params), " AND ")}`);

  const dto: StockRowDTO[] = rows.map((r) => {
    const onHand = new Prisma.Decimal(r.onHand);
    const min = new Prisma.Decimal(r.minStock);
    return {
      productId: r.productId, code: r.code, name: r.name, baseUnit: r.baseUnit, kind: r.kind, minStock: min.toString(),
      onHand: onHand.toString(), pending: new Prisma.Decimal(r.pending).toString(),
      shortage: min.gt(0) && onHand.lt(min) ? min.minus(onHand).toString() : null,
      stockValue: new Prisma.Decimal(r.stockValue).toString(),
    };
  });
  return {
    rows: redactDeep(dto, actor.perms), total: Number(rows[0]?.total ?? 0),
    stats: { products: Number(s?.products ?? 0), inStock: Number(s?.inStock ?? 0), below: Number(s?.below ?? 0), pending: Number(s?.pending ?? 0) },
  };
}
```

Ghi chú SQL: `Prisma.sql` lồng nhau an toàn (mọi giá trị người dùng đi qua tham số `${}`; `ORDER` chỉ nhận khoá trong bảng trắng `ORDER`). `COUNT(*) OVER()` khi không có dòng nào → `rows[0]` undefined ⇒ `total = 0`.

- [ ] **Step 5: Test thẻ kho (đỏ)** — `tests/inventory-reports/stock-card.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { stockCard } from "@/server/inventory-reports/stock-card";
import { prisma } from "../helpers/db";
import { useNoopCostOwners } from "../inventory/helpers";
import { stockWorld, type StockWorld } from "./helpers";

useNoopCostOwners();
let w: StockWorld;
beforeEach(async () => { w = await stockWorld(); });
const card = (over: Record<string, unknown> = {}, actor = w.actor) => stockCard(prisma, actor, { productId: w.tonId, page: 1, pageSize: 50, ...over } as never);

describe("stockCard", () => {
  it("dòng theo (at, seq) kèm SỐ DƯ TÍCH LUỸ tính khi đọc: +100 → +50 → −120", async () => {
    const r = await card();
    expect(r.rows.map((x) => [x.docType, x.qtyIn, x.qtyOut, x.balance])).toEqual([
      ["PURCHASE", "100", "0", "100"], ["PURCHASE", "50", "0", "150"], ["SALE", "0", "120", "30"],
    ]);
    expect(r.rows.map((x) => x.docLabel)).toEqual(["Phiếu nhập hàng", "Phiếu nhập hàng", "Bán hàng"]);
    expect(r.rows[0]!.href).toMatch(/^\/purchase\/orders\/\d+$/);
    expect(r.rows[2]!.href).toBeNull(); // chưa có màn đơn bán ⇒ không sinh liên kết chết
    expect(r.total).toBe(3);
    expect(r.opening.qty).toBe("0");
  });

  it("giá vốn xuất: cần cost.view (bình quân FIFO 20.333,3333); thiếu quyền → KHÔNG có unitCostOut", async () => {
    expect((await card()).rows[2]!.unitCostOut).toBe("20333.3333");
    const keeper = { userId: 1, perms: new Set(["stock.view"]) };
    expect(JSON.stringify((await card({}, keeper)).rows)).not.toContain("unitCostOut");
  });

  it("[Review Focus 8] khoảng ngày: tồn ĐẦU = số dư trước 'from'; số dư từng dòng vẫn là số dư THẬT (không tính lại từ 0)", async () => {
    const r = await card({ from: w.startOf(-1) }); // từ đầu ngày D-1
    expect(r.opening.qty).toBe("100");
    expect(r.rows.map((x) => x.balance)).toEqual(["150", "30"]);
  });

  it("phân trang server: trang 2 giữ đúng số dư luỹ kế", async () => {
    const r = await card({ page: 2, pageSize: 2 });
    expect(r.rows.map((x) => x.balance)).toEqual(["30"]);
    expect(r.total).toBe(3);
  });

  it("đơn treo: dòng xuất có qtyProvisional; số dư đi âm (sổ), tồn hiện tại không tính phần treo", async () => {
    const r = await stockCard(prisma, w.actor, { productId: w.giayId, page: 1, pageSize: 10 });
    expect(r.rows).toEqual([expect.objectContaining({ docType: "SALE", qtyOut: "5", qtyProvisional: "5", balance: "-5" })]);
  });

  it("mã không tồn tại → 404", async () => {
    await expect(stockCard(prisma, w.actor, { productId: 999999, page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 6: Viết `src/server/inventory-reports/stock-card.ts`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import { getOpenPeriod } from "@/server/period/guard";
import { docHref, docLabel } from "./labels";

type Db = Prisma.TransactionClient | PrismaClient;

export interface StockCardRowDTO {
  id: number; at: Date; docType: string; docLabel: string; docId: number; href: string | null;
  qtyIn: string; qtyOut: string; qtyProvisional: string;
  /** Số dư tích luỹ theo (at, seq) — tính khi đọc bằng hàm cửa sổ, KHÔNG lưu (spec 1.3). */
  balance: string;
  /** cost.view */
  unitCostOut?: string;
}

const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);

export async function stockCard(
  db: Db, actor: Actor,
  q: { productId: number; periodId?: number; from?: Date; to?: Date; page: number; pageSize: number },
) {
  const product = await db.product.findUnique({ where: { id: q.productId }, select: { id: true, code: true, name: true, baseUnit: true } });
  if (!product) throw new DomainError("Không tìm thấy sản phẩm.", 404);
  const periodId = q.periodId ?? (await getOpenPeriod(db)).id;
  const inRange = Prisma.sql`${q.from ? Prisma.sql`AND "at" >= ${q.from}` : Prisma.empty} ${q.to ? Prisma.sql`AND "at" < ${q.to}` : Prisma.empty}`;

  // Số dư luỹ kế tính trên TOÀN BỘ dòng của mã trong kỳ rồi mới cắt khoảng ngày + phân trang ⇒ số dư đúng dù xem trang giữa
  const rows = await db.$queryRaw<{
    id: number; at: Date; seq: bigint; docType: string; docId: number; qtyIn: Prisma.Decimal; qtyOut: Prisma.Decimal;
    unitCostOut: Prisma.Decimal; qtyProvisional: Prisma.Decimal; balance: Prisma.Decimal; total: bigint;
  }[]>(Prisma.sql`
    WITH r AS (
      SELECT sl.id, sl."at" AS "at", sl.seq, sl."docType"::text AS "docType", sl."docId", sl."qtyIn", sl."qtyOut", sl."unitCostOut", sl."qtyProvisional",
             SUM(sl."qtyIn" - sl."qtyOut") OVER (ORDER BY sl."at", sl.seq ROWS UNBOUNDED PRECEDING) AS balance
        FROM stock_ledger sl WHERE sl."productId" = ${q.productId} AND sl."periodId" = ${periodId})
    SELECT r.*, COUNT(*) OVER() AS total FROM r WHERE TRUE ${inRange}
     ORDER BY "at", seq LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);

  let opening = dec(0);
  if (q.from) {
    const [o] = await db.$queryRaw<{ qty: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT SUM("qtyIn" - "qtyOut") AS qty FROM stock_ledger WHERE "productId" = ${q.productId} AND "periodId" = ${periodId} AND "at" < ${q.from}`);
    opening = dec(o?.qty);
  }

  const dto: StockCardRowDTO[] = rows.map((r) => ({
    id: r.id, at: r.at, docType: r.docType, docLabel: docLabel(r.docType), docId: r.docId, href: docHref(r.docType, r.docId),
    qtyIn: dec(r.qtyIn).toString(), qtyOut: dec(r.qtyOut).toString(), qtyProvisional: dec(r.qtyProvisional).toString(),
    balance: dec(r.balance).toString(), unitCostOut: dec(r.unitCostOut).toString(),
  }));
  return { product, opening: { qty: opening.toString() }, rows: redactDeep(dto, actor.perms), total: Number(rows[0]?.total ?? 0) };
}
```

- [ ] **Step 7: Test XNT (đỏ)** — `tests/inventory-reports/xnt.test.ts`

```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { onHandList, STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
import { stockCard } from "@/server/inventory-reports/stock-card";
import { xntReport } from "@/server/inventory-reports/xnt";
import { parseListParams } from "@/lib/query-params";
import { prisma } from "../helpers/db";
import { useNoopCostOwners } from "../inventory/helpers";
import { stockWorld, type StockWorld } from "./helpers";

useNoopCostOwners();
let w: StockWorld;
beforeEach(async () => { w = await stockWorld(); });
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const xnt = (over: Record<string, unknown> = {}, actor = w.actor) => xntReport(prisma, actor, { page: 1, pageSize: 50, ...over } as never);
const ton = async (over = {}) => (await xnt({ q: "TL045", ...over })).rows[0]!;

describe("xntReport", () => {
  it("cả kỳ: đầu 0, nhập 150, xuất 120, cuối 30; giá trị nhập 3.100.000, xuất ≈ 2.440.000, cuối ≈ 660.000", async () => {
    const r = await ton();
    expect([r.openingQty, r.inQty, r.outQty, r.closingQty]).toEqual(["0", "150", "120", "30"]);
    expect(D(r.inValue!).toString()).toBe("3100000");
    expect(D(r.outValue!).minus(2_440_000).abs().lte(1)).toBe(true);
    expect(D(r.closingValue!).minus(660_000).abs().lte(1)).toBe(true);
  });

  it("[Review Focus 8] khoảng từ hôm nay: tồn ĐẦU = 150 (giá trị 3.100.000), nhập 0, xuất 120, cuối 30", async () => {
    const r = await ton({ from: w.startOf(0) });
    expect([r.openingQty, r.inQty, r.outQty, r.closingQty]).toEqual(["150", "0", "120", "30"]);
    expect(D(r.openingValue!).toString()).toBe("3100000");
  });

  it("[Review Focus 8] XNT CÂN với thẻ kho và tồn hiện tại (kể cả mã có đơn treo)", async () => {
    const all = (await xnt()).rows;
    for (const row of all) {
      const card = await stockCard(prisma, w.actor, { productId: row.productId, page: 1, pageSize: 100 });
      const last = card.rows.at(-1)?.balance ?? "0";
      expect(row.closingQty, row.code).toBe(last);
      expect(D(row.openingQty).plus(row.inQty).minus(row.outQty).toString(), row.code).toBe(row.closingQty);
    }
    const oh = (await onHandList(prisma, w.actor, parseListParams({}, STOCK_FILTER_KEYS))).rows;
    for (const row of all) {
      const h = oh.find((x) => x.productId === row.productId)!;
      expect(row.closingQty, `${row.code} tồn cuối = tồn hiện tại`).toBe(h.onHand); // tồn hiện tại đã trừ phần treo, giống số dư sổ
    }
  });

  it("dòng OPENING luôn tính vào tồn ĐẦU (kể cả `at` nằm trong khoảng)", async () => {
    await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.giayId, docType: "OPENING", docId: 1, docLineId: 1, qtyIn: 40, at: w.at(0), createdBy: w.actor.userId } });
    const r = (await xnt({ q: "GB", from: w.startOf(0) })).rows[0]!;
    expect(r.openingQty).toBe("40");
    expect(r.inQty).toBe("0");
  });

  it("[Review Focus 5] thiếu cost.view: KHÔNG có cột giá trị; tổng cộng cũng không", async () => {
    const keeper = { userId: 1, perms: new Set(["stock.view"]) };
    const r = await xnt({}, keeper);
    expect(JSON.stringify(r)).not.toMatch(/Value/);
    expect(r.rows[0]!.closingQty).toBeDefined();
  });

  it("tổng cộng toàn bộ tập (không chỉ trang hiện tại)", async () => {
    const r = await xnt({ pageSize: 1 });
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.totals.inQty).toBe("150");
    expect(r.totals.outQty).toBe("125"); // 120 tôn + 5 giấy (treo)
  });

  it("chỉ mã có phát sinh đến hết khoảng; tìm không dấu", async () => {
    await prisma.product.create({ data: { code: "KHONG", name: "Không phát sinh", searchText: "khong", baseUnit: "cái" } });
    const codes = (await xnt()).rows.map((x) => x.code).sort();
    expect(codes).toEqual(["GB", "TL045"]);
    expect((await xnt({ q: "TON" })).rows.map((x) => x.code)).toEqual(["TL045"]);
  });
});
```

- [ ] **Step 8: Viết `src/server/inventory-reports/xnt.ts`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;
const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);

export interface XntRowDTO {
  productId: number; code: string; name: string; baseUnit: string;
  openingQty: string; inQty: string; outQty: string; closingQty: string;
  /** cost.view — giá trị SỔ (Σ nhập − Σ xuất theo giá đã ghi). */
  openingValue?: string; inValue?: string; outValue?: string; closingValue?: string;
}
export interface XntTotalsDTO { openingQty: string; inQty: string; outQty: string; closingQty: string; openingValue?: string; inValue?: string; outValue?: string; closingValue?: string }

/**
 * Xuất–nhập–tồn theo khoảng [from, to). Tồn ĐẦU = mọi dòng có `at < from` HOẶC loại OPENING (số đầu kỳ). Không truyền
 * `from` ⇒ từ đầu kỳ; không truyền `to` ⇒ đến hết kỳ. Giá trị nhập = SL × giá lô hiện tại (đã tính lại theo cước/sửa), giá trị xuất = SL × unitCostOut.
 */
export async function xntReport(
  db: Db, actor: Actor,
  q: { periodId?: number; from?: Date; to?: Date; q?: string; page: number; pageSize: number },
) {
  const periodId = q.periodId ?? (await getOpenPeriod(db)).id;
  const from = q.from ?? new Date(0);
  const to = q.to ?? new Date("9999-01-01T00:00:00Z");
  const terms = normalizeSearch(q.q ?? "").split(" ").filter(Boolean).map((t) => Prisma.sql`p."searchText" LIKE ${"%" + escapeLike(t) + "%"}`);
  const where = terms.length ? Prisma.sql`AND ${Prisma.join(terms, " AND ")}` : Prisma.empty;
  const opening = Prisma.sql`(sl."at" < ${from} OR sl."docType" = 'OPENING')`;
  const inValue = Prisma.sql`COALESCE(cl."unitCost" * sl."qtyIn", 0)`;

  const rows = await db.$queryRaw<{
    productId: number; code: string; name: string; baseUnit: string;
    openingQty: Prisma.Decimal; openingValue: Prisma.Decimal; inQty: Prisma.Decimal; inValue: Prisma.Decimal; outQty: Prisma.Decimal; outValue: Prisma.Decimal;
    total: bigint; sOQ: Prisma.Decimal; sIQ: Prisma.Decimal; sXQ: Prisma.Decimal; sOV: Prisma.Decimal; sIV: Prisma.Decimal; sXV: Prisma.Decimal;
  }[]>(Prisma.sql`
    WITH agg AS (
      SELECT p.id AS "productId", p.code, p.name, p."baseUnit",
        COALESCE(SUM(CASE WHEN ${opening} THEN sl."qtyIn" - sl."qtyOut" END), 0) AS "openingQty",
        COALESCE(SUM(CASE WHEN ${opening} THEN ${inValue} - sl."qtyOut" * sl."unitCostOut" END), 0) AS "openingValue",
        COALESCE(SUM(CASE WHEN NOT ${opening} THEN sl."qtyIn" END), 0) AS "inQty",
        COALESCE(SUM(CASE WHEN NOT ${opening} THEN ${inValue} END), 0) AS "inValue",
        COALESCE(SUM(CASE WHEN NOT ${opening} THEN sl."qtyOut" END), 0) AS "outQty",
        COALESCE(SUM(CASE WHEN NOT ${opening} THEN sl."qtyOut" * sl."unitCostOut" END), 0) AS "outValue"
      FROM products p
      JOIN stock_ledger sl ON sl."productId" = p.id AND sl."periodId" = ${periodId} AND sl."at" < ${to}
      LEFT JOIN cost_layers cl ON cl."ledgerId" = sl.id
      WHERE TRUE ${where}
      GROUP BY p.id)
    SELECT agg.*, COUNT(*) OVER() AS total,
           SUM("openingQty") OVER() AS "sOQ", SUM("inQty") OVER() AS "sIQ", SUM("outQty") OVER() AS "sXQ",
           SUM("openingValue") OVER() AS "sOV", SUM("inValue") OVER() AS "sIV", SUM("outValue") OVER() AS "sXV"
      FROM agg ORDER BY code LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);

  const dto: XntRowDTO[] = rows.map((r) => {
    const oq = dec(r.openingQty), iq = dec(r.inQty), xq = dec(r.outQty);
    const ov = dec(r.openingValue), iv = dec(r.inValue), xv = dec(r.outValue);
    return {
      productId: r.productId, code: r.code, name: r.name, baseUnit: r.baseUnit,
      openingQty: oq.toString(), inQty: iq.toString(), outQty: xq.toString(), closingQty: oq.plus(iq).minus(xq).toString(),
      openingValue: ov.toString(), inValue: iv.toString(), outValue: xv.toString(), closingValue: ov.plus(iv).minus(xv).toString(),
    };
  });
  const t = rows[0];
  const totals: XntTotalsDTO = t
    ? {
        openingQty: dec(t.sOQ).toString(), inQty: dec(t.sIQ).toString(), outQty: dec(t.sXQ).toString(), closingQty: dec(t.sOQ).plus(t.sIQ).minus(t.sXQ).toString(),
        openingValue: dec(t.sOV).toString(), inValue: dec(t.sIV).toString(), outValue: dec(t.sXV).toString(), closingValue: dec(t.sOV).plus(t.sIV).minus(t.sXV).toString(),
      }
    : { openingQty: "0", inQty: "0", outQty: "0", closingQty: "0", openingValue: "0", inValue: "0", outValue: "0", closingValue: "0" };
  return { rows: redactDeep(dto, actor.perms), total: Number(t?.total ?? 0), totals: redactDeep(totals, actor.perms) };
}
```

- [ ] **Step 9: Test + viết tra cứu cuộn và tồn theo SP** — `tests/inventory-reports/rolls.test.ts`, `product-stock.test.ts`

```ts
// rolls.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { rollLookup, ROLL_FILTER_KEYS } from "@/server/inventory-reports/rolls";
import { cancelPurchaseTx, createPurchaseIdempotent } from "@/server/purchase/service";
import { prisma } from "../helpers/db";
import { input, todayIct, world, type World } from "../purchase/helpers";

const P = (sp: Record<string, string> = {}) => parseListParams(sp, ROLL_FILTER_KEYS);
let w: World;
beforeEach(async () => {
  w = await world();
  w.actor.perms.add("stock.view");
  await prisma.product.update({ where: { id: w.tonId }, data: { isCoil: true } });
});
const buy = (key: string, rollInfo: string, date = todayIct()) => createPurchaseIdempotent(prisma, w.actor, key, input(w, { date, lines: [{ productId: w.tonId, qty: 1000, unit: "md", factor: 1, purchasePrice: 40_000, rollInfo }] }));

describe("rollLookup — tra các dòng nhập tôn cuộn (mã 30, chỉ tra cứu)", () => {
  it("chỉ mã đánh dấu tôn cuộn; kèm ngày nhập, NCC, loại tôn, khối lượng (SL gốc), ghi chú cuộn; KHÔNG có giá", async () => {
    await buy("a", "Cuộn 5 tấn, 0.45 x 1200");
    await prisma.purchaseLine.create({ data: { purchaseId: (await prisma.purchase.findFirstOrThrow()).id, productId: w.giayId, qty: 1, unit: "m2", factorUsed: 1, qtyBase: 1, purchasePrice: 1, purchaseAmount: 1, rollInfo: "không phải cuộn" } });
    const r = await rollLookup(prisma, w.actor, P());
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ purchaseCode: "PN000001", partnerName: "Tôn Hoa Sen", productCode: "TL045", qtyBase: "1000", baseUnit: "md", rollInfo: "Cuộn 5 tấn, 0.45 x 1200" });
    expect(JSON.stringify(r)).not.toMatch(/purchasePrice|purchaseAmount|unitCost/);
  });

  it("[Review Focus 1 của 03a] tìm ghi chú cuộn / NCC / sản phẩm KHÔNG dấu, hoa thường lẫn lộn", async () => {
    await buy("a", "Cuộn 5 tấn ĐỎ");
    await buy("b", "Lô khác");
    for (const q of ["cuon 5", "CUỘN  5  TẤN", "hoa sen", "ton lanh"]) expect((await rollLookup(prisma, w.actor, P({ q }))).total, q).toBeGreaterThan(0);
    expect((await rollLookup(prisma, w.actor, P({ q: "do" }))).rows.map((x) => x.rollInfo)).toEqual(["Cuộn 5 tấn ĐỎ"]);
  });

  it("phiếu đã hủy không hiện; lọc theo khoảng ngày (QuickTimeFilter) theo ngày phiếu", async () => {
    const a = await buy("a", "A", todayIct(-3));
    await buy("b", "B", todayIct());
    await cancelPurchaseTx(prisma, w.actor, a.id, "sai");
    expect((await rollLookup(prisma, w.actor, P())).rows.map((x) => x.rollInfo)).toEqual(["B"]);
    expect((await rollLookup(prisma, w.actor, P({ timePreset: "lastMonth" }))).total).toBe(0);
  });
});
```

`src/server/inventory-reports/rolls.ts`:

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { timeRangeWhere } from "@/lib/time-presets";

type Db = Prisma.TransactionClient | PrismaClient;
export const ROLL_FILTER_KEYS = [] as const;

export interface RollRowDTO {
  lineId: number; purchaseId: number; purchaseCode: string; at: Date; partnerName: string;
  productCode: string; productName: string; qtyBase: string; baseUnit: string; rollInfo: string | null;
}

/**
 * Tra cứu cuộn = tra các dòng nhập của SP đánh dấu `isCoil` (spec mã 30). Chỉ tra cứu: không tồn theo cuộn (X6) và KHÔNG có
 * giá (màn này cấp cho người có stock.view). Mặc định MỌI kỳ (tra lịch sử), bỏ phiếu đã hủy.
 */
export async function rollLookup(db: Db, _actor: Actor, params: ListParams) {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const range = listTimeRange(params);
  const where: Prisma.PurchaseLineWhereInput = {
    product: { isCoil: true },
    purchase: { isCancelled: false, ...(range ? { at: timeRangeWhere(range) } : {}) },
    ...(terms.length ? { AND: terms.map((t) => ({ OR: [{ rollSearch: { contains: escapeLike(t) } }, { product: { searchText: { contains: escapeLike(t) } } }, { purchase: { partner: { searchText: { contains: escapeLike(t) } } } }] })) } : {}),
  };
  const desc = sortToOrderBy(params.sort, ["at"], { at: "desc" });
  const [rows, total] = await Promise.all([
    db.purchaseLine.findMany({
      where, orderBy: [{ purchase: { at: (desc.at ?? "desc") as "asc" | "desc" } }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { product: { select: { code: true, name: true, baseUnit: true } }, purchase: { select: { id: true, code: true, at: true, partner: { select: { name: true } } } } },
    }),
    db.purchaseLine.count({ where }),
  ]);
  const dto: RollRowDTO[] = rows.map((l) => ({
    lineId: l.id, purchaseId: l.purchase.id, purchaseCode: l.purchase.code, at: l.purchase.at, partnerName: l.purchase.partner.name,
    productCode: l.product.code, productName: l.product.name, qtyBase: l.qtyBase.toString(), baseUnit: l.product.baseUnit, rollInfo: l.rollInfo,
  }));
  return { rows: dto, total };
}
```

`tests/inventory-reports/product-stock.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { productStock } from "@/server/inventory-reports/product-stock";
import { prisma } from "../helpers/db";
import { useNoopCostOwners } from "../inventory/helpers";
import { stockWorld, type StockWorld } from "./helpers";

useNoopCostOwners();
let w: StockWorld;
beforeEach(async () => { w = await stockWorld(); w.actor.perms.add("purchase_price.view"); });

describe("productStock — tab Tồn kho của sản phẩm", () => {
  it("tồn 30 md; 1 lô còn lại 30 @22.000 (FIFO: lô 20.000 đã hết, lô 22.000 còn 30); giá nhập gần nhất; giá trị tồn", async () => {
    const s = await productStock(prisma, w.actor, w.tonId);
    expect(s).toMatchObject({ productId: w.tonId, baseUnit: "md", onHand: "30", pending: "0", lastPurchasePrice: "22000", stockValue: "660000" });
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0]).toMatchObject({ qtyRemaining: "30", unitCost: "22000", docLabel: "Phiếu nhập hàng" });
    expect(s.layers[0]!.href).toMatch(/^\/purchase\/orders\/\d+$/);
  });

  it("[Review Focus 5] thiếu cost.view / purchase_price.view: KHÔNG có giá vốn lô, giá nhập gần nhất, giá trị tồn — chỉ còn số lượng", async () => {
    const keeper = { userId: 1, perms: new Set(["stock.view"]) };
    const s = await productStock(prisma, keeper, w.tonId);
    expect(s.onHand).toBe("30");
    expect(s.layers[0]).toMatchObject({ qtyRemaining: "30" });
    expect(JSON.stringify(s)).not.toMatch(/unitCost|lastPurchasePrice|stockValue/);
  });

  it("mã có đơn treo: tồn âm + chờ nhập bù; không có lô nào", async () => {
    const s = await productStock(prisma, w.actor, w.giayId);
    expect(s).toMatchObject({ onHand: "-5", pending: "5", layers: [] });
  });

  it("mã không tồn tại → 404", async () => {
    await expect(productStock(prisma, w.actor, 999999)).rejects.toMatchObject({ status: 404 });
  });
});
```

`src/server/inventory-reports/product-stock.ts`:

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import { getOnHand } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { docHref, docLabel } from "./labels";

type Db = Prisma.TransactionClient | PrismaClient;

export interface ProductStockDTO {
  productId: number; baseUnit: string; onHand: string; pending: string;
  layers: { id: number; at: Date; docLabel: string; href: string | null; qtyIn: string; qtyRemaining: string; unitCost?: string }[];
  /** purchase_price.view — giá mua theo đơn vị GỐC của lần nhập mua gần nhất (đơn giá × hệ số thực tế). */
  lastPurchasePrice?: string;
  /** cost.view — Σ lớp còn lại × giá. */
  stockValue?: string;
}

export async function productStock(db: Db, actor: Actor, productId: number): Promise<ProductStockDTO> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, baseUnit: true } });
  if (!product) throw new DomainError("Không tìm thấy sản phẩm.", 404);
  const period = await getOpenPeriod(db);
  const [onHand, provisional, layers, last] = await Promise.all([
    getOnHand(db, period.id, productId), // engine: Σ lớp còn lại − Σ chờ nhập bù
    db.stockLedger.aggregate({ where: { periodId: period.id, productId }, _sum: { qtyProvisional: true } }),
    db.costLayer.findMany({ where: { periodId: period.id, productId, qtyRemaining: { gt: 0 } }, orderBy: [{ at: "asc" }, { ledger: { seq: "asc" } }] }),
    db.purchaseLine.findFirst({ where: { productId, purchase: { isCancelled: false } }, orderBy: [{ purchase: { at: "desc" } }, { id: "desc" }], select: { purchasePrice: true, factorUsed: true } }),
  ]);
  const value = layers.reduce((s, l) => s.plus(l.qtyRemaining.times(l.unitCost)), new Prisma.Decimal(0));
  const dto: ProductStockDTO = {
    productId, baseUnit: product.baseUnit, onHand: onHand.toString(), pending: new Prisma.Decimal(provisional._sum.qtyProvisional ?? 0).toString(),
    layers: layers.map((l) => ({
      id: l.id, at: l.at, docLabel: docLabel(l.sourceDocType), href: docHref(l.sourceDocType, l.sourceDocId),
      qtyIn: l.qtyIn.toString(), qtyRemaining: l.qtyRemaining.toString(), unitCost: l.unitCost.toString(),
    })),
    stockValue: value.toString(),
    ...(last ? { lastPurchasePrice: last.purchasePrice.times(last.factorUsed).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString() } : {}),
  };
  return redactDeep(dto, actor.perms);
}
```


- [ ] **Step 10: Test hiệu năng (ghi log; ép khi `PERF_STRICT=1`)** — `tests/inventory-reports/perf.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { onHandList, STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
import { stockCard } from "@/server/inventory-reports/stock-card";
import { xntReport } from "@/server/inventory-reports/xnt";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod, makeUser } from "../helpers/factories";

const actor = { userId: 1, perms: new Set(["stock.view", "cost.view"]) };
let periodId: number;

beforeAll(async () => {
  await resetDb();
  const user = await makeUser();
  periodId = (await makePeriod({ openedAt: new Date("2026-01-01T00:00:00Z") })).id;
  // 1.300 mã × (10 lần nhập + 10 lần bán) = 26.000 dòng sổ + 13.000 lớp — dựng bằng SQL tập hợp (không qua engine) cho nhanh
  await prisma.$executeRaw`INSERT INTO products (code, name, "searchText", "baseUnit", "updatedAt") SELECT 'P' || g, 'Sản phẩm ' || g, 'p' || g || ' san pham ' || g, 'md', now() FROM generate_series(1, 1300) g`;
  await prisma.$executeRaw`
    INSERT INTO stock_ledger ("periodId", "productId", "docType", "docId", "docLineId", "qtyIn", "qtyOut", "unitCostOut", "qtyProvisional", "at", "createdBy")
    SELECT ${periodId}, pr.id, 'PURCHASE', s, s, 100, 0, 0, 0, TIMESTAMP '2026-03-01' + (s || ' days')::interval, ${user.id} FROM products pr, generate_series(1, 10) s`;
  await prisma.$executeRaw`
    INSERT INTO cost_layers ("periodId", "productId", "sourceDocType", "sourceDocId", "sourceLineId", "ledgerId", "qtyIn", "qtyRemaining", "unitCost", "at")
    SELECT sl."periodId", sl."productId", 'PURCHASE', sl."docId", sl."docLineId", sl.id, 100, 60, 10000, sl."at" FROM stock_ledger sl WHERE sl."qtyIn" > 0`;
  await prisma.$executeRaw`
    INSERT INTO stock_ledger ("periodId", "productId", "docType", "docId", "docLineId", "qtyIn", "qtyOut", "unitCostOut", "qtyProvisional", "at", "createdBy")
    SELECT ${periodId}, pr.id, 'SALE', 1000 + s, 1000 + s, 0, 40, 10000, 0, TIMESTAMP '2026-03-15' + (s || ' days')::interval, ${user.id} FROM products pr, generate_series(1, 10) s`;
}, 120_000);

const time = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0;
  console.info(`[perf] ${label}: ${ms.toFixed(0)} ms`);
  if (process.env.PERF_STRICT) expect(ms, label).toBeLessThan(3000);
  return r;
};

describe("hiệu năng báo cáo kho: 1.300 mã × 20 dòng (cam kết ≤ 3 s/màn — spec Phần 13)", () => {
  it("tồn hiện tại (trang đầu + thống kê)", async () => {
    const r = await time("onHandList", () => onHandList(prisma, actor, parseListParams({}, STOCK_FILTER_KEYS)));
    expect(r.total).toBe(1300);
    expect(r.rows[0]!.onHand).toBe("600"); // 1.000 nhập − 400 bán (theo sổ; lớp còn lại 60×10 = 600)
  });
  it("XNT cả kỳ + tổng cộng", async () => {
    const r = await time("xntReport", () => xntReport(prisma, actor, { page: 1, pageSize: 50 }));
    expect(r.total).toBe(1300);
    expect(r.totals.inQty).toBe("1300000");
  });
  it("thẻ kho 1 mã (20 dòng, số dư luỹ kế)", async () => {
    const p = await prisma.product.findFirstOrThrow({ where: { code: "P1" } });
    const r = await time("stockCard", () => stockCard(prisma, actor, { productId: p.id, page: 1, pageSize: 50 }));
    expect(r.total).toBe(20);
  });
});
```
Ghi chú: giá trị kỳ vọng `onHand "600"`: sổ nhập 1.000, xuất 400 ⇒ `Σ(in−out) = 600`; nhưng lớp `qtyRemaining` được dựng 60/lớp × 10 = 600 ⇒ `onHand = 600 − 0 = 600` ✓ nhất quán. Nếu index thiếu khiến vượt 3 s: thêm `@@index([periodId, productId, at])` đã có ở `stock_ledger`; kiểm `EXPLAIN` trước khi thêm index mới.

- [ ] **Step 11: Export báo cáo** — `src/server/inventory-reports/export.ts`: mỗi hàm gọi lại CHÍNH hàm truy vấn của màn hình (cùng lọc, cùng `redactDeep`) với `page: 1, pageSize: 50_000` rồi `buildXlsx` — file xuất không bao giờ rộng hơn những gì người dùng thấy; cột giá trị chỉ xuất hiện khi DTO có (đã lọc theo `cost.view`).

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx, type XlsxColumn } from "@/server/export/xlsx";
import { onHandList } from "./on-hand";
import { rollLookup } from "./rolls";
import { stockCard } from "./stock-card";
import { xntReport } from "./xnt";

type Db = Prisma.TransactionClient | PrismaClient;
const ALL = 50_000;
const QTY = "#,##0.###";
const MONEY = "#,##0";

export async function exportStockXlsx(db: Db, actor: Actor, params: ListParams, opts: { forceStock?: "below" } = {}): Promise<Buffer> {
  const { rows } = await onHandList(db, actor, { ...params, page: 1, pageSize: ALL }, opts);
  const showValue = rows.some((r) => r.stockValue !== undefined);
  const columns: XlsxColumn[] = [
    { header: "Mã", key: "code", width: 16, text: true }, { header: "Tên", key: "name", width: 40 }, { header: "Đơn vị", key: "baseUnit", width: 10 },
    { header: "Tồn", key: "onHand", width: 14, numFmt: QTY }, { header: "Chờ nhập bù", key: "pending", width: 14, numFmt: QTY }, { header: "Định mức", key: "minStock", width: 12, numFmt: QTY },
    ...(showValue ? [{ header: "Giá trị tồn", key: "stockValue", width: 18, numFmt: MONEY }] : []),
  ];
  return buildXlsx("Tồn kho", columns, rows);
}

export async function exportXntXlsx(db: Db, actor: Actor, q: Omit<Parameters<typeof xntReport>[2], "page" | "pageSize">): Promise<Buffer> {
  const { rows, totals } = await xntReport(db, actor, { ...q, page: 1, pageSize: ALL });
  const showValue = totals.closingValue !== undefined;
  const columns: XlsxColumn[] = [
    { header: "Mã", key: "code", width: 16, text: true }, { header: "Tên", key: "name", width: 40 }, { header: "Đơn vị", key: "baseUnit", width: 10 },
    { header: "Tồn đầu", key: "openingQty", width: 14, numFmt: QTY }, { header: "Nhập", key: "inQty", width: 14, numFmt: QTY }, { header: "Xuất", key: "outQty", width: 14, numFmt: QTY }, { header: "Tồn cuối", key: "closingQty", width: 14, numFmt: QTY },
    ...(showValue ? [
      { header: "Giá trị đầu", key: "openingValue", width: 18, numFmt: MONEY }, { header: "Giá trị nhập", key: "inValue", width: 18, numFmt: MONEY },
      { header: "Giá trị xuất", key: "outValue", width: 18, numFmt: MONEY }, { header: "Giá trị cuối", key: "closingValue", width: 18, numFmt: MONEY },
    ] : []),
  ];
  return buildXlsx("XNT", columns, [...rows, { code: "TỔNG CỘNG", name: "", baseUnit: "", ...totals }]);
}

export async function exportRollsXlsx(db: Db, actor: Actor, params: ListParams): Promise<Buffer> {
  const { rows } = await rollLookup(db, actor, { ...params, page: 1, pageSize: ALL });
  return buildXlsx("Tra cứu cuộn", [
    { header: "Ngày nhập", key: "at", width: 14 }, { header: "Mã phiếu", key: "purchaseCode", width: 14, text: true }, { header: "Nhà cung cấp", key: "partnerName", width: 30 },
    { header: "Mã SP", key: "productCode", width: 16, text: true }, { header: "Loại tôn", key: "productName", width: 34 },
    { header: "Khối lượng", key: "qtyBase", width: 14, numFmt: QTY }, { header: "Đơn vị", key: "baseUnit", width: 10 }, { header: "Ghi chú cuộn", key: "rollInfo", width: 36 },
  ], rows);
}

export async function exportStockCardXlsx(db: Db, actor: Actor, q: Omit<Parameters<typeof stockCard>[2], "page" | "pageSize">): Promise<Buffer> {
  const { rows, product } = await stockCard(db, actor, { ...q, page: 1, pageSize: ALL });
  const showCost = rows.some((r) => r.unitCostOut !== undefined);
  const columns: XlsxColumn[] = [
    { header: "Ngày giờ", key: "at", width: 18 }, { header: "Chứng từ", key: "docLabel", width: 24 }, { header: "Số chứng từ", key: "docId", width: 12 },
    { header: "Nhập", key: "qtyIn", width: 12, numFmt: QTY }, { header: "Xuất", key: "qtyOut", width: 12, numFmt: QTY }, { header: "Tồn", key: "balance", width: 12, numFmt: QTY },
    ...(showCost ? [{ header: "Giá vốn xuất", key: "unitCostOut", width: 16, numFmt: "#,##0.0000" }] : []),
  ];
  return buildXlsx(`Thẻ kho ${product.code}`, columns, rows);
}
```

Test `tests/inventory-reports/export.test.ts`:

```ts
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { exportStockCardXlsx, exportStockXlsx, exportXntXlsx } from "@/server/inventory-reports/export";
import { STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
import { prisma } from "../helpers/db";
import { useNoopCostOwners } from "../inventory/helpers";
import { stockWorld, type StockWorld } from "./helpers";

useNoopCostOwners();
let w: StockWorld;
beforeEach(async () => { w = await stockWorld(); });
const keeper = { userId: 1, perms: new Set(["stock.view"]) };
const sheet = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  return { headers: (ws.getRow(1).values as unknown[]).slice(1).map(String), rows: ws.rowCount - 1, last: ws.getRow(ws.rowCount) };
};

describe("export báo cáo kho", () => {
  it("[Review Focus 5] tồn kho: có cột 'Giá trị tồn' chỉ khi có cost.view", async () => {
    const p = parseListParams({}, STOCK_FILTER_KEYS);
    expect((await sheet(await exportStockXlsx(prisma, w.actor, p))).headers).toContain("Giá trị tồn");
    expect((await sheet(await exportStockXlsx(prisma, keeper, p))).headers).not.toContain("Giá trị tồn");
  });

  it("tồn kho export tôn trọng bộ lọc trang (dưới định mức) và số dòng = total", async () => {
    await prisma.product.update({ where: { id: w.tonId }, data: { minStock: 50 } });
    const s = await sheet(await exportStockXlsx(prisma, w.actor, parseListParams({ stock: "below" }, STOCK_FILTER_KEYS)));
    expect(s.rows).toBe(1);
  });

  it("XNT: có dòng TỔNG CỘNG cuối; không có cột giá trị khi thiếu cost.view", async () => {
    const full = await sheet(await exportXntXlsx(prisma, w.actor, {}));
    expect(String(full.last.getCell(1).value)).toBe("TỔNG CỘNG");
    expect(full.headers).toContain("Giá trị cuối");
    expect((await sheet(await exportXntXlsx(prisma, keeper, {}))).headers).not.toContain("Giá trị cuối");
  });

  it("thẻ kho: đủ dòng của mã; giá vốn xuất chỉ khi có cost.view", async () => {
    expect((await sheet(await exportStockCardXlsx(prisma, w.actor, { productId: w.tonId }))).headers).toContain("Giá vốn xuất");
    const k = await sheet(await exportStockCardXlsx(prisma, keeper, { productId: w.tonId }));
    expect(k.rows).toBe(3);
    expect(k.headers).not.toContain("Giá vốn xuất");
  });
});
```


- [ ] **Step 12: Chạy tổng + commit**

```bash
rtk proxy npx vitest run tests/inventory-reports
rtk proxy npm run lint && rtk proxy npm run typecheck
git add src/server/inventory-reports tests/inventory-reports
git commit -m "feat(inventory-reports): tồn hiện tại, thẻ kho (số dư tính khi đọc), XNT cân với sổ, tra cứu cuộn, tồn theo SP — lọc giá theo quyền ở server"
```

---

### Task 15: Màn hình kho — giao diện (tồn kho, thẻ kho, XNT, định mức tồn, tra cứu cuộn, tab Tồn kho của sản phẩm) + đóng plan 03b

**Mã:** 22, 23, 24, 25, 30. **Files:**
- Create: `src/app/api/inventory/{stock,min-stock,xnt,rolls,ledger}/export/route.ts`
- Create: `src/components/inventory/{StockTable,StockList,StockCardTable,XntTable,RollTable,ProductStockTab,ProductPicker}.tsx`
- Create: `src/app/(app)/inventory/{stock,min-stock,ledger,xnt,rolls}/page.tsx`
- Modify: `src/components/products/ProductDetail.tsx`, `src/app/(app)/inventory/products/[id]/page.tsx` (tab **Tồn kho**)
- Modify: `src/config/app.config.ts` (bỏ `planned`: `stock-onhand`, `stock-ledger`, `stock-xnt`, `stock-min`, `roll-lookup`), `docs/STATUS.md`, master plan mục 1–2
- Test: `tests/ui/{stock-table,xnt-table,stock-pages,product-stock-tab}.test.tsx`

**Interfaces:**
- Consumes: Task 14 (`onHandList`, `stockCard`, `xntReport`, `rollLookup`, `productStock`, hàm export), `ListPageLayout`, `StatCard`, `SearchBox`, `MultiSelectFilter`, `QuickTimeFilter`, `PaginationFooter`, `ExportButton`, `Combobox`, `Badge`, `DataTable`.
- Produces: 5 trang + tab; API `GET /api/inventory/{stock,min-stock,xnt,rolls,ledger}/export`.

- [ ] **Step 1: Tồn hiện tại + Định mức tồn** — một server component `StockList` và một bảng client dùng cho cả hai trang.

`src/components/inventory/StockTable.tsx`:

```tsx
"use client";

import { Badge, DataTable, type Column } from "@/components/ui";
import { formatCurrency, formatQty } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { StockRowDTO } from "@/server/inventory-reports/on-hand";

export function StockTable({ rows, params, base, mode }: { rows: StockRowDTO[]; params: ListParams; base: string; mode: "stock" | "min" }) {
  // Cột giá trị chỉ có khi DTO mang stockValue (server đã lọc theo cost.view) — không phải ẩn bằng CSS
  const showValue = rows.some((r) => r.stockValue !== undefined);
  const columns: Column<StockRowDTO>[] = [
    { key: "code", label: "Mã", sortable: true, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (r) => r.name },
    { key: "baseUnit", label: "ĐV", render: (r) => r.baseUnit },
    { key: "onHand", label: "Tồn", sortable: true, align: "right", render: (r) => <span className={Number(r.onHand) < 0 ? "font-semibold text-danger" : undefined}>{formatQty(r.onHand)}</span> },
    { key: "pending", label: "Chờ nhập bù", align: "right", render: (r) => (Number(r.pending) > 0 ? <Badge tone="warning">{formatQty(r.pending)}</Badge> : null) },
    { key: "minStock", label: "Định mức", sortable: true, align: "right", render: (r) => (Number(r.minStock) > 0 ? formatQty(r.minStock) : null) },
    ...(mode === "min" ? [{ key: "shortage", label: "Thiếu", align: "right" as const, render: (r: StockRowDTO) => (r.shortage ? <span className="font-semibold text-danger">{formatQty(r.shortage)}</span> : null) }] : []),
    { key: "status", label: "Tình trạng", render: (r) => (Number(r.pending) > 0 ? <Badge tone="warning">Đơn treo</Badge> : r.shortage ? <Badge tone="danger">Dưới định mức</Badge> : Number(r.onHand) > 0 ? <Badge tone="success">Còn hàng</Badge> : <Badge>Hết hàng</Badge>) },
    ...(showValue ? [{ key: "stockValue", label: "Giá trị tồn", align: "right" as const, hiddenByDefault: true, render: (r: StockRowDTO) => formatCurrency(r.stockValue) }] : []),
  ];
  return <DataTable id={`stock-${mode}`} columns={columns} rows={rows} rowKey={(r) => r.productId} rowHref={(r) => `/inventory/products/${r.productId}?tab=stock`}
    sort={params.sort} buildSortHref={(s) => buildListHref(base, params, { sort: s })} />;
}
```

`src/components/inventory/StockList.tsx` (server component):

```tsx
import Link from "next/link";
import { EmptyState, ExportButton, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { onHandList, STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";
import { PRODUCT_KINDS } from "@/server/products/schemas";
import { StockTable } from "./StockTable";

/** `mode="min"` = màn Định mức tồn & cảnh báo (mã 25): chỉ mã dưới định mức, kèm cột Thiếu. */
export async function StockList({ actor, searchParams, mode }: { actor: Actor; searchParams: Record<string, string | string[] | undefined>; mode: "stock" | "min" }) {
  const base = mode === "min" ? "/inventory/min-stock" : "/inventory/stock";
  const params = parseListParams(searchParams, STOCK_FILTER_KEYS);
  const { rows, total, stats } = await onHandList(prisma, actor, params, mode === "min" ? { forceStock: "below" } : {});
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(base, params, patch);
  const stock = params.filters.stock?.[0];
  const filtered = !!(params.q || params.filters.stock || params.filters.kind);

  return (
    <ListPageLayout
      title={mode === "min" ? "Định mức tồn & cảnh báo" : "Tồn kho hiện tại"}
      actions={<ExportButton href={buildExportHref(`/api/inventory/${mode === "min" ? "min-stock" : "stock"}/export`, params)} />}
      stats={mode === "min"
        ? <StatCard label="Mã dưới định mức" value={stats.below} tone="danger" />
        : <>
            <StatCard label="Tổng mã" value={stats.products} href={href({ filters: { stock: [] } })} active={!stock} />
            <StatCard label="Còn hàng" value={stats.inStock} tone="success" href={href({ filters: { stock: ["in"] } })} active={stock === "in"} />
            <StatCard label="Dưới định mức" value={stats.below} tone="danger" href={href({ filters: { stock: ["below"] } })} active={stock === "below"} />
            <StatCard label="Chờ nhập bù" value={stats.pending} tone="warning" href={href({ filters: { stock: ["pending"] } })} active={stock === "pending"} />
          </>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={base} params={params} placeholder="Tìm mã, tên sản phẩm…" />
          <MultiSelectFilter label="Loại" paramKey="kind" basePath={base} params={params} options={PRODUCT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          {mode === "min" && <span className="text-xs text-fg-muted">Đặt định mức ở trang chi tiết sản phẩm → Định mức tồn.</span>}
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0
        ? filtered
          ? <EmptyState kind="no-result" title="Không có mã hàng phù hợp" description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={base} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title={mode === "min" ? "Không có mã nào dưới định mức" : "Chưa có sản phẩm nào"} />
        : <StockTable rows={rows} params={params} base={base} mode={mode} />}
    </ListPageLayout>
  );
}
```

Hai trang mỏng (mỗi trang TỰ gọi `requireActor(`):

```tsx
// src/app/(app)/inventory/stock/page.tsx
import { StockList } from "@/components/inventory/StockList";
import { requireActor } from "@/server/auth/session";

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  return <StockList actor={actor} searchParams={await searchParams} mode="stock" />;
}
```

`src/app/(app)/inventory/min-stock/page.tsx` y hệt, đổi `mode="min"` và tên hàm `MinStockPage`.

- [ ] **Step 2: Thẻ kho (mã 22)**

`src/components/inventory/ProductPicker.tsx` (client):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Combobox, type ComboOption } from "@/components/ui/Combobox";
import { apiFetch } from "@/lib/api-fetch";
import { buildListHref, type ListParams } from "@/lib/query-params";

/** Chọn sản phẩm → đẩy `?product=<id>` vào URL (giữ khoảng thời gian đang chọn; về trang 1 do buildListHref). */
export function ProductPicker({ basePath, params, selected }: { basePath: string; params: ListParams; selected: ComboOption | null }) {
  const router = useRouter();
  return (
    <div className="w-full sm:w-96">
      <Combobox label="Sản phẩm" value={selected} placeholder="Chọn sản phẩm để xem thẻ kho…"
        loadOptions={(q) => apiFetch<ComboOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`)}
        onChange={(o) => router.push(buildListHref(basePath, params, { filters: { product: o ? [String(o.value)] : [] } }))} />
    </div>
  );
}
```

`src/components/inventory/StockCardTable.tsx` (client, bảng riêng vì có dòng "Tồn đầu" và số dư luỹ kế):

```tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatCurrency, formatDateTime, formatQty } from "@/lib/format";
import type { StockCardRowDTO } from "@/server/inventory-reports/stock-card";

export function StockCardTable({ rows, openingQty, baseUnit, showOpening }: { rows: StockCardRowDTO[]; openingQty: string; baseUnit: string; showOpening: boolean }) {
  const showCost = rows.some((r) => r.unitCostOut !== undefined); // server đã loại giá vốn nếu thiếu cost.view
  const th = "px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left">
            <th className={th}>Ngày giờ</th><th className={th}>Chứng từ</th><th className={`${th} text-right`}>Nhập</th><th className={`${th} text-right`}>Xuất</th><th className={`${th} text-right`}>Tồn</th>
            {showCost && <th className={`${th} text-right`}>Giá vốn xuất</th>}<th className={th}>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {showOpening && (
            <tr className="border-b border-border bg-hover/50">
              <td className="px-3 py-2 text-fg-secondary" colSpan={4}>Tồn đầu (trước khoảng thời gian này)</td>
              <td className="tabular px-3 py-2 text-right font-semibold">{formatQty(openingQty)} {baseUnit}</td>
              <td colSpan={showCost ? 2 : 1} />
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-hover">
              <td className="tabular px-3 py-2">{formatDateTime(r.at)}</td>
              <td className="px-3 py-2">{r.href ? <Link href={r.href} className="hover:text-accent">{r.docLabel} #{r.docId}</Link> : <>{r.docLabel} #{r.docId}</>}</td>
              <td className="tabular px-3 py-2 text-right">{Number(r.qtyIn) > 0 ? formatQty(r.qtyIn) : null}</td>
              <td className="tabular px-3 py-2 text-right">{Number(r.qtyOut) > 0 ? formatQty(r.qtyOut) : null}</td>
              <td className={`tabular px-3 py-2 text-right font-semibold ${Number(r.balance) < 0 ? "text-danger" : ""}`}>{formatQty(r.balance)}</td>
              {showCost && <td className="tabular px-3 py-2 text-right">{Number(r.qtyOut) > 0 ? formatCurrency(r.unitCostOut) : null}</td>}
              <td className="px-3 py-2">{Number(r.qtyProvisional) > 0 ? <Badge tone="warning">Treo {formatQty(r.qtyProvisional)}</Badge> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/app/(app)/inventory/ledger/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { StockCardTable } from "@/components/inventory/StockCardTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, QuickTimeFilter } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, listTimeRange, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { stockCard } from "@/server/inventory-reports/stock-card";

const BASE = "/inventory/ledger";
const MAX_INT32 = 2_147_483_647;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const params = parseListParams(await searchParams, ["product"]);
  const raw = params.filters.product?.[0];
  if (raw !== undefined && (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > MAX_INT32)) notFound();
  const range = listTimeRange(params);
  const card = raw === undefined ? null : await stockCard(prisma, actor, {
    productId: Number(raw), ...(range ? { from: range.start, to: range.end } : {}), page: params.page, pageSize: params.pageSize,
  }).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);

  return (
    <ListPageLayout
      title={card ? `Thẻ kho — ${card.product.code}` : "Sổ kho / thẻ kho"}
      actions={card ? <ExportButton href={buildExportHref("/api/inventory/ledger/export", params)} /> : undefined}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <ProductPicker basePath={BASE} params={params} selected={card ? { value: card.product.id, label: `${card.product.code} — ${card.product.name}` } : null} />
          <QuickTimeFilter basePath={BASE} params={params} />
        </div>
      }
      footer={<PaginationFooter total={card?.total ?? 0} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {!card
        ? <EmptyState kind="empty" title="Chọn sản phẩm để xem thẻ kho" description="Thẻ kho ghi từng lần nhập/xuất của một mã hàng kèm số dư sau mỗi dòng." />
        : card.total === 0
          ? <EmptyState kind="no-result" title="Không có phát sinh trong khoảng này" />
          : <StockCardTable rows={card.rows} openingQty={card.opening.qty} baseUnit={card.product.baseUnit} showOpening={!!range} />}
    </ListPageLayout>
  );
}
```

- [ ] **Step 3: XNT (mã 24)** — `src/components/inventory/XntTable.tsx` (bảng riêng có `<tfoot>` Tổng cộng; dưới md tự thành thẻ):

```tsx
"use client";

import { formatCurrency, formatQty } from "@/lib/format";
import type { XntRowDTO, XntTotalsDTO } from "@/server/inventory-reports/xnt";

export function XntTable({ rows, totals }: { rows: XntRowDTO[]; totals: XntTotalsDTO }) {
  const showValue = totals.closingValue !== undefined; // server đã loại cột giá trị nếu thiếu cost.view
  const th = "px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary text-right";
  const td = "tabular px-3 py-2 text-right";
  const cells = (r: XntRowDTO | XntTotalsDTO) => (
    <>
      <td className={td}>{formatQty(r.openingQty)}</td><td className={td}>{formatQty(r.inQty)}</td><td className={td}>{formatQty(r.outQty)}</td>
      <td className={`${td} font-semibold ${Number(r.closingQty) < 0 ? "text-danger" : ""}`}>{formatQty(r.closingQty)}</td>
      {showValue && <><td className={td}>{formatCurrency(r.openingValue)}</td><td className={td}>{formatCurrency(r.inValue)}</td><td className={td}>{formatCurrency(r.outValue)}</td><td className={`${td} font-semibold`}>{formatCurrency(r.closingValue)}</td></>}
    </>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-fg-secondary">Mã</th><th className="px-3 py-2 text-left text-xs font-semibold uppercase text-fg-secondary">Tên</th>
            <th className={th}>Tồn đầu</th><th className={th}>Nhập</th><th className={th}>Xuất</th><th className={th}>Tồn cuối</th>
            {showValue && <><th className={th}>Giá trị đầu</th><th className={th}>Giá trị nhập</th><th className={th}>Giá trị xuất</th><th className={th}>Giá trị cuối</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId} className="border-b border-border hover:bg-hover">
              <td className="px-3 py-2 font-mono text-xs">{r.code}</td><td className="px-3 py-2">{r.name} <span className="text-fg-muted">({r.baseUnit})</span></td>{cells(r)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-hover/50 font-semibold"><td className="px-3 py-2" colSpan={2}>Tổng cộng</td>{cells(totals)}</tr>
        </tfoot>
      </table>
    </div>
  );
}
```

`src/app/(app)/inventory/xnt/page.tsx`:

```tsx
import { XntTable } from "@/components/inventory/XntTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, listTimeRange, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { xntReport } from "@/server/inventory-reports/xnt";

const BASE = "/inventory/xnt";

export default async function XntPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const params = parseListParams(await searchParams, []);
  const range = listTimeRange(params);
  const { rows, total, totals } = await xntReport(prisma, actor, { ...(range ? { from: range.start, to: range.end } : {}), ...(params.q ? { q: params.q } : {}), page: params.page, pageSize: params.pageSize });
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  return (
    <ListPageLayout
      title="Báo cáo xuất nhập tồn"
      actions={<ExportButton href={buildExportHref("/api/inventory/xnt/export", params)} />}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên sản phẩm…" />
          <QuickTimeFilter basePath={BASE} params={params} />
          <span className="text-xs text-fg-muted">{range ? "Theo khoảng đã chọn." : "Mặc định: cả kỳ đang mở."} Giá trị theo sổ (nhập − xuất theo giá đã ghi); mã có đơn treo dùng giá tạm.</span>
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0 ? <EmptyState kind="no-result" title="Không có phát sinh trong khoảng này" /> : <XntTable rows={rows} totals={totals} />}
    </ListPageLayout>
  );
}
```

- [ ] **Step 4: Tra cứu cuộn (mã 30)** — `RollTable.tsx` + trang:

```tsx
// src/components/inventory/RollTable.tsx
"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components/ui";
import { formatDate, formatQty } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { RollRowDTO } from "@/server/inventory-reports/rolls";

export function RollTable({ rows, params }: { rows: RollRowDTO[]; params: ListParams }) {
  const columns: Column<RollRowDTO>[] = [
    { key: "at", label: "Ngày nhập", sortable: true, render: (r) => formatDate(r.at) },
    { key: "purchase", label: "Mã phiếu", primaryOnMobile: true, render: (r) => <Link href={`/purchase/orders/${r.purchaseId}`} className="font-mono text-xs hover:text-accent">{r.purchaseCode}</Link> },
    { key: "partner", label: "Nhà cung cấp", render: (r) => r.partnerName },
    { key: "product", label: "Loại tôn", render: (r) => <><span className="font-mono text-xs">{r.productCode}</span> {r.productName}</> },
    { key: "qty", label: "Khối lượng", align: "right", render: (r) => `${formatQty(r.qtyBase)} ${r.baseUnit}` },
    { key: "roll", label: "Ghi chú cuộn", render: (r) => r.rollInfo },
  ];
  return <DataTable id="rolls" columns={columns} rows={rows} rowKey={(r) => r.lineId} sort={params.sort} buildSortHref={(s) => buildListHref("/inventory/rolls", params, { sort: s })} />;
}
```

```tsx
// src/app/(app)/inventory/rolls/page.tsx
import Link from "next/link";
import { RollTable } from "@/components/inventory/RollTable";
import { EmptyState, ExportButton, ListPageLayout, PaginationFooter, QuickTimeFilter, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { rollLookup, ROLL_FILTER_KEYS } from "@/server/inventory-reports/rolls";

const BASE = "/inventory/rolls";

export default async function RollsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("stock.view");
  const params = parseListParams(await searchParams, ROLL_FILTER_KEYS);
  const { rows, total } = await rollLookup(prisma, actor, params);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const filtered = !!(params.q || params.timePreset);
  return (
    <ListPageLayout
      title="Tra cứu cuộn"
      actions={<ExportButton href={buildExportHref("/api/inventory/rolls/export", params)} />}
      filters={<div className="flex flex-wrap items-center gap-2"><SearchBox basePath={BASE} params={params} placeholder="Tìm ghi chú cuộn, nhà cung cấp, loại tôn…" /><QuickTimeFilter basePath={BASE} params={params} /></div>}
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}>
      {total === 0
        ? filtered
          ? <EmptyState kind="no-result" title="Không tìm thấy dòng nhập tôn cuộn phù hợp" action={<Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title="Chưa có dòng nhập tôn cuộn" description="Đánh dấu “Là tôn cuộn” ở sản phẩm rồi lập phiếu nhập — ghi chú cuộn (số cuộn, quy cách) nhập ở từng dòng phiếu." />
        : <RollTable rows={rows} params={params} />}
    </ListPageLayout>
  );
}
```

- [ ] **Step 5: 5 route export** — mỗi file TỰ gọi `requireActorApi("stock.view")` và bọc `try/catch → toErrorResponse`; cùng `FILTER_KEYS` với trang. `stock/export/route.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportStockXlsx } from "@/server/inventory-reports/export";
import { STOCK_FILTER_KEYS } from "@/server/inventory-reports/on-hand";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await requireActorApi("stock.view");
    const sp: Record<string, string[]> = Object.create(null);
    for (const [k, v] of new URL(req.url).searchParams) (sp[k] ??= []).push(v);
    return xlsxResponse("ton-kho.xlsx", await exportStockXlsx(prisma, actor, parseListParams(sp, STOCK_FILTER_KEYS)));
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

Bốn route còn lại cùng khuôn: `min-stock/export` (`exportStockXlsx(prisma, actor, params, { forceStock: "below" })`, tên file `dinh-muc-ton.xlsx`), `rolls/export` (`ROLL_FILTER_KEYS` + `exportRollsXlsx`, `tra-cuu-cuon.xlsx`), `xnt/export` (`parseListParams(sp, [])`, `listTimeRange(params)` → `exportXntXlsx(prisma, actor, { from, to, q })`, `xuat-nhap-ton.xlsx`), `ledger/export` (`parseListParams(sp, ["product"])`; `product` rác → 400 qua `ValidationError`; `listTimeRange` → `exportStockCardXlsx(prisma, actor, { productId, from, to })`, `the-kho.xlsx`).

- [ ] **Step 6: Tab "Tồn kho" ở chi tiết sản phẩm.**

`src/components/inventory/ProductStockTab.tsx`:

```tsx
"use client";

import Link from "next/link";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import type { ProductStockDTO } from "@/server/inventory-reports/product-stock";

const Stat = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) => (
  <div className="flex-1 rounded-md border border-border p-3"><div className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</div><div className={`tabular mt-1 text-xl font-bold ${tone ?? ""}`}>{value}</div></div>
);

export function ProductStockTab({ stock: s }: { stock: ProductStockDTO }) {
  const showCost = s.layers.some((l) => l.unitCost !== undefined);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Stat label="Tồn hiện tại" value={`${formatQty(s.onHand)} ${s.baseUnit}`} tone={Number(s.onHand) < 0 ? "text-danger" : undefined} />
        <Stat label="Chờ nhập bù" value={Number(s.pending) > 0 ? `${formatQty(s.pending)} ${s.baseUnit}` : "—"} tone={Number(s.pending) > 0 ? "text-warning" : undefined} />
        {s.lastPurchasePrice !== undefined && <Stat label="Giá nhập gần nhất" value={`${formatCurrency(s.lastPurchasePrice)}/${s.baseUnit}`} />}
        {s.stockValue !== undefined && <Stat label="Giá trị tồn" value={formatCurrency(s.stockValue)} />}
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Lô còn lại (theo thứ tự xuất trước — FIFO)</h2>
        <Link href={`/inventory/ledger?product=${s.productId}`} className="text-sm font-medium text-accent">Xem thẻ kho</Link>
      </div>
      {s.layers.length === 0
        ? <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Không còn lô nào.</p>
        : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs font-semibold uppercase text-fg-secondary">
              <th className="py-2">Ngày</th><th className="py-2">Nguồn</th><th className="py-2 text-right">SL nhập</th><th className="py-2 text-right">SL còn</th>{showCost && <th className="py-2 text-right">Giá vốn/{s.baseUnit}</th>}
            </tr></thead>
            <tbody>{s.layers.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="tabular py-2">{formatDate(l.at)}</td>
                <td className="py-2">{l.href ? <Link href={l.href} className="hover:text-accent">{l.docLabel}</Link> : l.docLabel}</td>
                <td className="tabular py-2 text-right">{formatQty(l.qtyIn)}</td><td className="tabular py-2 text-right font-medium">{formatQty(l.qtyRemaining)}</td>
                {showCost && <td className="tabular py-2 text-right">{formatCurrency(l.unitCost)}</td>}
              </tr>
            ))}</tbody>
          </table>
        )}
    </div>
  );
}
```

Trong `src/components/products/ProductDetail.tsx` (plan 03a Task 8): thêm import `ProductStockTab` + `type ProductStockDTO`, prop tuỳ chọn `stock?: ProductStockDTO | null`, đổi `useDetailNav(["info", "units", ...(stock ? ["stock"] : [])], …)` và thêm phần tử vào mảng `tabs`:

```tsx
        ...(stock ? [{ key: "stock", label: "Tồn kho", render: () => <ProductStockTab stock={stock} /> }] : []),
```

Trong `src/app/(app)/inventory/products/[id]/page.tsx`: sau khi có `product`, thêm `const stock = actor.perms.has("stock.view") ? await productStock(prisma, actor, id) : null;` và truyền `stock={stock ? JSON.parse(JSON.stringify(stock)) : null}` (Date → chuỗi). `formatDate` nhận cả chuỗi ISO nên hiển thị đúng.

- [ ] **Step 7: Test UI (đỏ → xanh)**

`tests/ui/stock-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockTable } from "@/components/inventory/StockTable";
import { parseListParams } from "@/lib/query-params";
import type { StockRowDTO } from "@/server/inventory-reports/on-hand";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/inventory/stock" }));
const row = (over: Partial<StockRowDTO> & { productId: number; code: string }): StockRowDTO => ({
  name: `Sản phẩm ${over.code}`, baseUnit: "md", kind: "HANG", minStock: "0", onHand: "30", pending: "0", shortage: null, ...over,
});
const params = parseListParams({}, ["stock", "kind"]);
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("StockTable", () => {
  it("tồn âm hiện màu cảnh báo + 'Chờ nhập bù' + badge 'Đơn treo'", () => {
    render(<StockTable rows={[row({ productId: 1, code: "GB", onHand: "-5", pending: "5" })]} params={params} base="/inventory/stock" mode="stock" />);
    const r = screen.getAllByRole("row").find((x) => within(x).queryByText("GB"))!;
    expect(within(r).getByText("-5")).toHaveClass("text-danger");
    expect(within(r).getByText("Đơn treo")).toBeInTheDocument();
  });

  it("dưới định mức: badge + cột 'Thiếu' chỉ ở mode='min'", () => {
    const rows = [row({ productId: 1, code: "TL", minStock: "50", shortage: "20" })];
    const { unmount } = render(<StockTable rows={rows} params={params} base="/inventory/stock" mode="stock" />);
    expect(screen.getAllByText("Dưới định mức").length).toBeGreaterThan(0);
    expect(screen.queryByText("Thiếu")).toBeNull();
    unmount();
    render(<StockTable rows={rows} params={params} base="/inventory/min-stock" mode="min" />);
    expect(screen.getAllByText("Thiếu").length).toBeGreaterThan(0);
  });

  it("[Review Focus 5] cột 'Giá trị tồn' chỉ có khi DTO mang stockValue (server đã lọc theo cost.view)", async () => {
    const { unmount } = render(<StockTable rows={[row({ productId: 1, code: "A" })]} params={params} base="/inventory/stock" mode="stock" />);
    await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Giá trị tồn" })).toBeNull();
    unmount();
    render(<StockTable rows={[row({ productId: 1, code: "A", stockValue: "660000" })]} params={params} base="/inventory/stock" mode="stock" />);
    await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Giá trị tồn" })).toBeInTheDocument();
  });

  it("click tên mã → trang chi tiết sản phẩm, tab Tồn kho", () => {
    render(<StockTable rows={[row({ productId: 7, code: "TL045" })]} params={params} base="/inventory/stock" mode="stock" />);
    expect(screen.getAllByRole("link", { name: "Sản phẩm TL045" })[0]).toHaveAttribute("href", "/inventory/products/7?tab=stock");
  });
});
```

`tests/ui/xnt-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { XntTable } from "@/components/inventory/XntTable";
import type { XntRowDTO, XntTotalsDTO } from "@/server/inventory-reports/xnt";

afterEach(cleanup);
const base: XntRowDTO = { productId: 1, code: "TL045", name: "Tôn lạnh", baseUnit: "md", openingQty: "0", inQty: "1250.5", outQty: "120", closingQty: "1130.5" };
const totals: XntTotalsDTO = { openingQty: "0", inQty: "1250.5", outQty: "120", closingQty: "1130.5" };

describe("XntTable", () => {
  it("đủ 4 nhóm cột SL, số theo chuẩn Việt Nam (1.250,5); dòng Tổng cộng", () => {
    render(<XntTable rows={[base]} totals={totals} />);
    for (const h of ["Tồn đầu", "Nhập", "Xuất", "Tồn cuối"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    const row = screen.getByText("TL045").closest("tr")!;
    expect(within(row).getByText("1.250,5")).toBeInTheDocument();
    const foot = screen.getByText("Tổng cộng").closest("tr")!;
    expect(within(foot).getByText("1.130,5")).toBeInTheDocument();
  });

  it("[Review Focus 5] không có giá trị (thiếu cost.view): KHÔNG có cột 'Giá trị …'", () => {
    render(<XntTable rows={[base]} totals={totals} />);
    expect(screen.queryByRole("columnheader", { name: /Giá trị/ })).toBeNull();
  });

  it("có giá trị: đủ 4 cột giá trị + tổng", () => {
    const v = { openingValue: "0", inValue: "3100000", outValue: "2440000", closingValue: "660000" };
    render(<XntTable rows={[{ ...base, ...v }]} totals={{ ...totals, ...v }} />);
    for (const h of ["Giá trị đầu", "Giá trị nhập", "Giá trị xuất", "Giá trị cuối"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(screen.getAllByText("660.000 ₫")).toHaveLength(2); // dòng + tổng cộng
  });
});
```

`tests/ui/stock-pages.test.tsx` (mock session + truy vấn; mẫu `product-pages.test.tsx`):

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import LedgerPage from "@/app/(app)/inventory/ledger/page";
import MinStockPage from "@/app/(app)/inventory/min-stock/page";
import RollsPage from "@/app/(app)/inventory/rolls/page";
import StockPage from "@/app/(app)/inventory/stock/page";
import XntPage from "@/app/(app)/inventory/xnt/page";

const requireActor = vi.fn();
const onHandList = vi.fn();
const stockCard = vi.fn();
const xntReport = vi.fn();
const rollLookup = vi.fn();
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOTFOUND"); } }));
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/inventory-reports/on-hand", async (o) => ({ ...(await o<typeof import("@/server/inventory-reports/on-hand")>()), onHandList: (...a: unknown[]) => onHandList(...a) }));
vi.mock("@/server/inventory-reports/stock-card", () => ({ stockCard: (...a: unknown[]) => stockCard(...a) }));
vi.mock("@/server/inventory-reports/xnt", () => ({ xntReport: (...a: unknown[]) => xntReport(...a) }));
vi.mock("@/server/inventory-reports/rolls", async (o) => ({ ...(await o<typeof import("@/server/inventory-reports/rolls")>()), rollLookup: (...a: unknown[]) => rollLookup(...a) }));
vi.mock("@/components/inventory/StockTable", () => ({ StockTable: () => null }));
vi.mock("@/components/inventory/StockCardTable", () => ({ StockCardTable: () => null }));
vi.mock("@/components/inventory/XntTable", () => ({ XntTable: () => null }));
vi.mock("@/components/inventory/RollTable", () => ({ RollTable: () => null }));
vi.mock("@/components/inventory/ProductPicker", () => ({ ProductPicker: () => null }));

const actor = { userId: 7, perms: new Set(["stock.view"]) };
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
beforeEach(() => {
  for (const m of [requireActor, onHandList, stockCard, xntReport, rollLookup]) m.mockReset();
  requireActor.mockResolvedValue(actor);
  onHandList.mockResolvedValue({ rows: [], total: 0, stats: { products: 0, inStock: 0, below: 0, pending: 0 } });
  xntReport.mockResolvedValue({ rows: [], total: 0, totals: {} });
  rollLookup.mockResolvedValue({ rows: [], total: 0 });
});

describe("5 màn kho (server)", () => {
  it.each([["stock", StockPage], ["min-stock", MinStockPage], ["ledger", LedgerPage], ["xnt", XntPage], ["rolls", RollsPage]] as const)(
    "%s cần stock.view; bị từ chối thì KHÔNG đọc dữ liệu", async (_n, Page) => {
      requireActor.mockRejectedValueOnce(new Error("REDIRECT:/403"));
      await expect((Page as (p: unknown) => Promise<unknown>)(sp())).rejects.toThrow("REDIRECT:/403");
      expect(requireActor).toHaveBeenCalledWith("stock.view");
      for (const m of [onHandList, stockCard, xntReport, rollLookup]) expect(m).not.toHaveBeenCalled();
    });

  it("tồn kho: ?stock=below&kind=NVL&q=ton đi vào params; định mức tồn ép forceStock=below", async () => {
    const el = (await StockPage(sp({ stock: "below", kind: "NVL", q: "ton" }))) as { type: (p: unknown) => Promise<unknown>; props: unknown };
    await el.type(el.props);
    expect(onHandList.mock.calls[0]![2]).toMatchObject({ q: "ton", filters: { stock: ["below"], kind: ["NVL"] } });
    const m = (await MinStockPage(sp())) as { type: (p: unknown) => Promise<unknown>; props: unknown };
    await m.type(m.props);
    expect(onHandList.mock.calls[1]![3]).toEqual({ forceStock: "below" });
  });

  it("thẻ kho: chưa chọn SP → không gọi stockCard; product rác → 404; product hợp lệ + khoảng thời gian → from/to là Date", async () => {
    await LedgerPage(sp());
    expect(stockCard).not.toHaveBeenCalled();
    for (const product of ["abc", "0", "1e2", "99999999999"]) await expect(LedgerPage(sp({ product }))).rejects.toThrow("NOTFOUND");
    stockCard.mockResolvedValue({ product: { id: 5, code: "TL045", name: "Tôn", baseUnit: "md" }, opening: { qty: "0" }, rows: [], total: 0 });
    await LedgerPage(sp({ product: "5", timePreset: "thisMonth" }));
    const q = stockCard.mock.calls[0]![2];
    expect(q.productId).toBe(5);
    expect(q.from).toBeInstanceOf(Date);
    expect(q.to).toBeInstanceOf(Date);
  });

  it("XNT: khoảng thời gian → from/to; không chọn → cả kỳ (không có from/to)", async () => {
    await XntPage(sp({ timePreset: "lastMonth", q: "ton" }));
    expect(xntReport.mock.calls[0]![2]).toMatchObject({ q: "ton", from: expect.any(Date), to: expect.any(Date) });
    await XntPage(sp());
    expect(xntReport.mock.calls[1]![2]).not.toHaveProperty("from");
  });
});
```

`tests/ui/product-stock-tab.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductStockTab } from "@/components/inventory/ProductStockTab";
import type { ProductStockDTO } from "@/server/inventory-reports/product-stock";

afterEach(cleanup);
const full: ProductStockDTO = {
  productId: 7, baseUnit: "md", onHand: "30", pending: "0", lastPurchasePrice: "22000", stockValue: "660000",
  layers: [{ id: 1, at: new Date("2026-09-26T03:00:00Z"), docLabel: "Phiếu nhập hàng", href: "/purchase/orders/3", qtyIn: "50", qtyRemaining: "30", unitCost: "22000" }],
};

describe("ProductStockTab", () => {
  it("có quyền giá: hiện giá nhập gần nhất, giá trị tồn, giá vốn từng lô; liên kết chứng từ + thẻ kho", () => {
    render(<ProductStockTab stock={full} />);
    expect(screen.getByText("Giá nhập gần nhất")).toBeInTheDocument();
    expect(screen.getByText("Giá trị tồn")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Phiếu nhập hàng" })).toHaveAttribute("href", "/purchase/orders/3");
    expect(screen.getByRole("link", { name: "Xem thẻ kho" })).toHaveAttribute("href", "/inventory/ledger?product=7");
    expect(screen.getByRole("columnheader", { name: "Giá vốn/md" })).toBeInTheDocument();
  });

  it("[Review Focus 5] thiếu quyền: chỉ số lượng — KHÔNG có giá nhập, giá trị, giá vốn lô", () => {
    const { lastPurchasePrice: _p, stockValue: _v, ...rest } = full;
    render(<ProductStockTab stock={{ ...rest, layers: full.layers.map(({ unitCost: _u, ...l }) => l) }} />);
    expect(screen.queryByText("Giá nhập gần nhất")).toBeNull();
    expect(screen.queryByText("Giá trị tồn")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Giá vốn/ })).toBeNull();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("không còn lô: thông báo rõ; tồn âm/đơn treo hiện cảnh báo", () => {
    render(<ProductStockTab stock={{ productId: 9, baseUnit: "m2", onHand: "-5", pending: "5", layers: [] }} />);
    expect(screen.getByText("Không còn lô nào.")).toBeInTheDocument();
    expect(screen.getByText("-5 m2")).toHaveClass("text-danger");
    expect(screen.getByText("5 m2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Mở menu + kiểm tay + đo.** Bỏ `planned` của `stock-onhand`, `stock-ledger`, `stock-xnt`, `stock-min`, `roll-lookup`. Nạp dữ liệu cỡ lớn (script tạm dùng SQL của `perf.test.ts` trên DB dev) rồi `npm run dev`: mở Tồn kho / XNT / Thẻ kho đo thời gian tải (≤ 3 giây); đăng nhập **Thủ kho** (có `stock.view`, không `cost.view`): xác nhận không thấy giá trị/giá vốn ở 5 màn + tab Tồn kho + file export; kiểm số XNT khớp thẻ kho khớp tồn hiện tại cho 3 mã ngẫu nhiên; dark/light; mobile (card list) không vỡ.

- [ ] **Step 9: Kiểm toàn bộ + tài liệu + commit đóng plan 03b**

```bash
rtk proxy npm run lint && rtk proxy npm run typecheck
rtk proxy npm test
rtk proxy npm run build
```

Cập nhật `docs/STATUS.md` (mục 4: GĐ1b-b xong kèm số file/test; mục 6: 03c là bước kế tiếp; mục 7 thêm các mục "Cần khách xác nhận" của 03b bên dưới), `docs/superpowers/plans/2026-09-24-00-master-plan.md` mục 1 (D-13…D-18), và ghi vào `docs/engine-fifo.md` mục 3 một dòng: "Module phiếu nhập (`src/server/purchase`) là ví dụ tham chiếu của hợp đồng `at`+`seq`: header lưu `at`, dòng lưu `seq`, sửa = `removeDocument` + ghi lại."

```bash
git add -A
git commit -m "feat(inventory): màn Tồn kho, Thẻ kho, XNT, Định mức tồn, Tra cứu cuộn + tab Tồn kho của sản phẩm (đóng plan 03b)"
```

**Kiểm cuối plan 03b (DoD — chép master mục 7):** truy được về mã (19, 20, 21, 22–25, 30) · zod + lỗi tiếng Việt · quyền 3 cấp + route guard · **giá nhập/giá vốn/giá trị tồn ẩn ở server cho người thiếu quyền ở MỌI đường ra (danh sách, chi tiết, export, nhật ký, thẻ kho, XNT, tồn)** · mọi ghi có transaction + audit, đúng kỳ, kỳ đã kết sổ chặn sửa/hủy · idempotent · tải ≤ 3 giây với 1.300 mã (đo) · danh sách có search/filter/export/pagination dính đáy/Stat Card/QuickTimeFilter · chi tiết full page + deep-link · dark/light · lint + typecheck + test xanh.

## Cần khách / người dùng xác nhận (phát sinh từ plan 03b)

| # | Điểm | Mặc định đang dùng | Ảnh hưởng nếu khác |
|---|---|---|---|
| 1 | **Cước vận chuyển có cộng vào công nợ NCC không?** (spec Phần 11 mục 2 chỉ hỏi "vào giá vốn") | Cước vào **giá vốn lô**, KHÔNG vào công nợ NCC (`FREIGHT_IN_COST = true`, `partner_ledger` = tiền hàng) | Đổi 1 hằng + 1 dòng `rewritePartnerLedger`; nếu cước cũng nợ NCC thì `credit = tiền hàng + cước` |
| 2 | **Ai lập phiếu nhập — Kế toán hay Thủ kho?** Spec 6.6: Thủ kho làm "nhập xuất" nhưng **không thấy giá nhập**; lập phiếu cần nhập giá ⇒ Thủ kho không lập được | Lập/sửa phiếu cần `purchase_price.view` ⇒ chỉ Kế toán/Giám đốc; Thủ kho chỉ **nhập không NCC** (không cần giá) và xem sổ kho | Nếu Thủ kho cần lập phiếu (kế toán điền giá sau) ⇒ thiết kế "phiếu nhập chờ giá" (ngoài phạm vi hiện tại) |
| 3 | **Giá mặc định của nhập không NCC** = giá vốn lô của lần nhập MUA gần nhất (gồm cước) | như trên | Spec 6.10: "mặc định giá nhập gần nhất" — nếu khách hiểu là giá mua trần (không cước) thì đổi `lastPurchaseCost` |
| 4 | **Giá trị XNT theo sổ** (nhập − xuất theo giá đã ghi); mã có đơn treo dùng giá tạm nên tồn cuối không bằng đúng "Σ lớp còn lại × giá" | như trên | Màn Tồn kho hiện tại đã có `stockValue` = Σ lớp còn lại × giá để đối chiếu |
| 5 | **"Tôn cuộn" = sản phẩm có cờ `isCoil`** (spec chỉ nói "dòng nhập tôn cuộn") | người dùng tick ở sản phẩm | Nếu khách muốn định nghĩa theo nhóm/loại khác thì đổi điều kiện `rollLookup` |
| 6 | **Đơn vị nhập lớn hơn đơn vị gốc** (1 cây = 6 md) khai hệ số 0,166667 (D-12) | như trên | Nếu khách dùng nhiều đơn vị lớn hơn gốc, cân nhắc thêm cột hướng (nhân/chia) |
