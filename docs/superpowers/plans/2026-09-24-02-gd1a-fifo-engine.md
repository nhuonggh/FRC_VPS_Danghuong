# GĐ1a — Engine kho FIFO (đường găng) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một module `src/server/inventory/` là NƠI DUY NHẤT được nhập/xuất kho và tính giá vốn theo FIFO theo lớp lô — đúng ở mọi tình huống của spec Phần 3 (bán xuyên lớp, bán âm/đơn treo, sửa/hủy/khôi phục giữa chuỗi, trả hàng, thành phẩm, cước nhập sau, ghi đồng thời) — có bộ test tự động chứng minh trước khi bất kỳ màn nhập/bán nào được viết.

**Architecture:** Mọi thay đổi kho là **ghi nguồn** (`stock_ledger` + `cost_layers`) rồi để **một thuật toán duy nhất `replayProduct`** tính lại `cost_consumptions`, `qty_remaining`, `unit_cost_out`, `qty_provisional` cho mã hàng đó từ điểm thay đổi trở đi (mô phỏng theo thời gian: lớp đến → nuốt hàng đợi đơn treo; lệnh xuất → ăn lớp cũ nhất). Bán ở đuôi, sửa giữa chuỗi, hủy, khôi phục, nhập bù đều là CÙNG một đường code → ít nhánh, dễ chứng minh. Giá vốn phụ thuộc chéo (lớp trả hàng = vốn dòng bán gốc; thành phẩm = tổng vốn NVL; dòng bán tôn xốp = tổng vốn NVL) lan truyền bằng vòng lặp hội tụ trong `flush`. Ghi đồng thời bằng `pg_advisory_xact_lock` theo `product_id` tăng dần. Tính lại quá ngưỡng (~2.000 sự kiện) chuyển sang chạy nền.

**Tech Stack:** TypeScript, Prisma 6 (+ raw SQL cho lock/UPDATE hàng loạt), PostgreSQL 15, Vitest (test tích hợp trên Postgres thật).

**Spec:** `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` Phần 1.2, 1.3, 2.4, 3.0–3.7, 4.4. Master plan: D-4, D-7, D-8. Plan 01a (schema `cost_layers/consumptions/stock_ledger`, factories, `resetDb`), plan 01c Task 12 Step 1 (`DomainError` ở `src/server/http/errors.ts` — nếu chạy plan này trước 01c thì làm riêng Step 1 đó trước).

## Global Constraints

Chép từ spec + master plan — áp cho mọi task ở đây:

- **Nguyên tắc 1–4 (spec 1.2):** sổ kho tách khỏi đơn hàng; mọi dòng mang `period_id`; giá vốn = lớp lô FIFO; mọi ghi tiền/kho trong 1 transaction.
- **Quy tắc số dư (spec 1.3):** KHÔNG lưu cột số dư chạy. Tồn = `Σ cost_layers.qty_remaining − Σ stock_ledger.qty_provisional`, tính khi đọc.
- **Khoá đồng thời (spec 3.0):** mọi nhập/xuất một mã hàng lấy `pg_advisory_xact_lock` theo `product_id`, **luôn theo thứ tự tăng dần**.
- **Quy tắc FIFO (spec 3.1–3.2):** nhập trước xuất trước; giá vốn chỉ đổi khi NHẬP, không đổi khi bán; một lần xuất có thể ăn nhiều lớp; `unit_cost_out` = bình quân trọng số. Ví dụ chuẩn của khách: nhập 100@20.000 → bán 30 → nhập 100@22.000 → bán 90 = 70@20.000 + 20@22.000 ⇒ `unit_cost_out` = 20.444,44; còn 80@22.000.
- **Bán âm (spec 3.3):** vẫn cho xuất phần thiếu; giá vốn tạm = giá nhập gần nhất; `qty_provisional` > 0 ⇒ đơn treo; nhập bù khớp theo thứ tự thời gian.
- **Kỳ (spec 4.4):** chứng từ kỳ đã kết sổ KHÔNG sửa/hủy (lỗi tiếng Việt "Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được."); không ghi chứng từ có ngày trước ngày mở kỳ hiện tại.
- **Kiểu số:** số lượng `Decimal(18,3)`, giá vốn đơn vị `Decimal(18,4)` (làm tròn HALF_UP 4 chữ số khi ghi); tổng tiền `Decimal(18,2)`. Dùng `Prisma.Decimal` — KHÔNG dùng `number` để tính.
- **Ngày chứng từ:** thời điểm ghi sổ = `docTimestamp(ngày, bây giờ)` theo giờ ICT; sắp xếp lớp/lệnh theo `(at, id)` (D-7).
- **Không xoá mềm dòng sổ kho (D-8):** hủy/sửa = xoá dòng của chứng từ đó rồi tính lại chuỗi; dấu vết ở `audit_log` do module nghiệp vụ ghi.
- Engine KHÔNG ghi `audit_log`, KHÔNG biết đơn hàng/phiếu nhập là gì — module nghiệp vụ ghi audit và mở transaction.
- Mỗi task kết thúc: `npm run lint && npm run typecheck && npm test` xanh rồi commit.

## Review Focus (phần thuộc plan này)

- Sổ kho luôn cân sau MỌI thao tác kể cả làm tròn lẻ (`Σin − Σout = Σremaining − Σprovisional` và từng lớp/từng dòng xuất khớp consumption) — helper `assertLedgerBalanced` gọi trong mọi test (Task 1, 6).
- Lô 3 md giá 10.000/3 và 333,333 md: tổng giá vốn xuất không lệch quá 1 đồng so với tiền nhập (Task 6).
- Sửa/hủy chứng từ kỳ đã kết sổ, ghi ngày trước ngày mở kỳ → lỗi tiếng Việt, không ghi gì (Task 3).
- 2 người bán cùng mã đồng thời không ăn trùng lớp; 10 giao dịch chen nhau không deadlock treo (Task 5).
- Engine == mô hình tham chiếu (mô phỏng FIFO ngây thơ từ đầu) trên 20 kịch bản ngẫu nhiên gồm chèn lùi thời gian, sửa, hủy, đổi giá lô (Task 6).

---

## File Structure (plan này tạo)

| File | Trách nhiệm |
|---|---|
| `prisma/schema/inventory.prisma` (sửa) + migration `engine_support` | thêm `RecomputeJob`, index `(periodId, productId, qtyProvisional)` |
| `src/server/inventory/types.ts`, `errors.ts` | kiểu dùng chung, lỗi tiếng Việt |
| `src/server/inventory/lock.ts` | advisory lock theo thứ tự |
| `src/server/inventory/time.ts` | `docTimestamp` (ICT) |
| `src/server/inventory/queries.ts` | `getOnHand`, `estimateCost` |
| `src/server/inventory/layers.ts` | `restoreLayerRemaining` — trả lại `qty_remaining` = `qty_in − Σ consumption` |
| `src/server/period/guard.ts` | `getOpenPeriod`, `assertPeriodOpen`, `assertDocDateInPeriod` |
| `src/server/inventory/unit-of-work.ts` | `beginEngine`, `markDirty`, `flush`, `withInventoryTx`, thử lại khi deadlock |
| `src/server/inventory/ports.ts` | `postReceipt`, `postIssue`, `removeDocument`, `updateLayerCost`, `productsOfDocument` |
| `src/server/inventory/replay.ts` | thuật toán tính lại chuỗi (LÕI) |
| `src/server/inventory/owners.ts` | `registerCostOwner`, `lineSnapshot` |
| `src/server/inventory/recompute.ts` | tính lại chạy nền, worker |
| `src/server/inventory/index.ts` | **barrel — API DUY NHẤT các plan sau được import** |
| `src/instrumentation.ts` | khởi động lại worker khi bật app |
| `tests/inventory/{helpers,reference}.ts` | `newWorld`, `assertLedgerBalanced`, mô hình tham chiếu |
| `tests/inventory/*.test.ts` | bộ test spec 3.7 |

**Quy ước gọi engine (mọi plan sau bám theo):**
```ts
await withInventoryTx(prisma, { userId, products: [productIds…] }, async (ctx) => {
  // 1) module nghiệp vụ ghi chứng từ của nó (đơn, dòng…) bằng ctx.tx
  // 2) postReceipt / postIssue / removeDocument / updateLayerCost
  // 3) writeAudit(ctx.tx, …)
});   // flush (tính lại chuỗi + đồng bộ giá vốn về dòng chứng từ) chạy TỰ ĐỘNG trước commit
```
`products` phải liệt kê ĐỦ mọi mã hàng sẽ chạm (dùng `productsOfDocument` cho sửa/hủy). Engine tự khoá theo thứ tự tăng dần.

---

### Task 1: Nền móng — schema bổ sung, kiểu, lỗi, khoá, hạ tầng test

**Files:**
- Modify: `prisma/schema/inventory.prisma`
- Create: `src/server/inventory/{types,errors,lock}.ts`
- Create: `tests/inventory/helpers.ts`
- Test: `tests/inventory/lock.test.ts`, `tests/inventory/helpers.test.ts`

**Interfaces:**
- Produces:
  - `type Tx = Prisma.TransactionClient`, `type Dec = Prisma.Decimal`, `type DecInput = Prisma.Decimal.Value`
  - `interface EngineCtx { tx: Tx; period: { id: number; openedAt: Date }; userId: number; locked: Set<number>; dirty: Map<number, Date>; afterCommit: (() => void)[]; inlineLimit: number; mode: "inline" | "worker" }`
  - `IN_DOC_TYPES`, `OUT_DOC_TYPES`, `type InDocType`, `type OutDocType`
  - Lỗi: `PeriodClosedError`, `DocDateBeforePeriodError`, `InvalidQuantityError`, `InvalidCostError`, `InvalidDocDateError`, `ProductRecomputingError`, `DependentDocumentsError` (extends `DomainError`); `ProductNotLockedError`, `ReplayTooLargeError(productId, eventCount)`, `EngineInvariantError` (extends `Error`)
  - `LOCK_CLASS_PRODUCT = 1001`, `sortedUniqueIds(ids)`, `lockProducts(ctx, ids)`, `assertLocked(ctx, productId)`
  - Test helpers: `T(minutes): Date`, `newWorld(productCount?)`, `assertLedgerBalanced(productId, periodId)`

- [ ] **Step 1: Bổ sung schema — job tính lại nền + index cho truy vấn đơn treo**

Sửa `prisma/schema/inventory.prisma`: trong model `StockLedger` thêm dòng index (đứng cạnh các `@@index` sẵn có):
```prisma
  @@index([periodId, productId, qtyProvisional])
```
Thêm cuối file:
```prisma
enum RecomputeStatus {
  PENDING
  RUNNING
  FAILED

  @@map("recompute_status")
}

// Hàng đợi tính lại giá vốn chạy nền (spec 3.5: chạm quá ~2.000 dòng → chạy nền, chặn xuất mã đó tới khi xong).
// Mỗi mã hàng tối đa 1 job; job xong thì xoá dòng. Không FK để không kéo quan hệ ngược vào Product.
model RecomputeJob {
  id        Int             @id @default(autoincrement())
  periodId  Int
  productId Int             @unique
  fromAt    DateTime
  status    RecomputeStatus @default(PENDING)
  attempts  Int             @default(0)
  error     String?
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  @@index([status, id])
  @@map("recompute_jobs")
}
```
Run: `npx prisma migrate dev --name engine_support`
Expected: sinh migration mới, áp vào DB dev, `Your database is now in sync`.
Run: `npm run db:schema` (cập nhật `db/db_schema.sql`).

- [ ] **Step 2: `types.ts` và `errors.ts`**

`src/server/inventory/types.ts`:
```ts
import type { Prisma, StockDocType } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export type Dec = Prisma.Decimal;
export type DecInput = Prisma.Decimal.Value;

/** Ngữ cảnh của MỘT transaction kho. Tạo bằng beginEngine / withInventoryTx — không tự dựng. */
export interface EngineCtx {
  tx: Tx;
  period: { id: number; openedAt: Date };
  userId: number;
  /** Mã hàng đã giữ advisory lock trong transaction này. */
  locked: Set<number>;
  /** product → thời điểm SỚM NHẤT cần tính lại. */
  dirty: Map<number, Date>;
  /** Chạy SAU khi commit (vd đánh thức worker nền). */
  afterCommit: (() => void)[];
  /** Ngưỡng số sự kiện cho tính lại đồng bộ (spec 3.5: ~2.000). */
  inlineLimit: number;
  /** worker = đang chạy nền: không giới hạn ngưỡng, không bị chặn bởi cờ recomputing. */
  mode: "inline" | "worker";
}

export const IN_DOC_TYPES = ["OPENING", "PURCHASE", "ADJ_IN", "RETURN_IN", "PRODUCTION_OUT", "STOCKTAKE_IN"] as const satisfies readonly StockDocType[];
export const OUT_DOC_TYPES = ["SALE", "ADJ_LOSS", "WRITE_OFF", "RETURN_SUPPLIER", "PRODUCTION_USE", "PROCESSING_USE", "STOCKTAKE_OUT"] as const satisfies readonly StockDocType[];
export type InDocType = (typeof IN_DOC_TYPES)[number];
export type OutDocType = (typeof OUT_DOC_TYPES)[number];

export const DEFAULT_INLINE_LIMIT = 2000;
```
`src/server/inventory/errors.ts`:
```ts
import { DomainError } from "@/server/http/errors";

export class PeriodClosedError extends DomainError {
  constructor() {
    super("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.", 409, "PERIOD_CLOSED");
    this.name = "PeriodClosedError";
  }
}
export class DocDateBeforePeriodError extends DomainError {
  constructor() {
    super("Ngày chứng từ trước ngày mở kỳ hiện tại, không ghi vào kỳ này được.", 409, "DOC_DATE_BEFORE_PERIOD");
    this.name = "DocDateBeforePeriodError";
  }
}
export class InvalidQuantityError extends DomainError {
  constructor() {
    super("Số lượng phải lớn hơn 0.", 400, "INVALID_QTY");
    this.name = "InvalidQuantityError";
  }
}
export class InvalidCostError extends DomainError {
  constructor() {
    super("Giá vốn không được âm.", 400, "INVALID_COST");
    this.name = "InvalidCostError";
  }
}
export class InvalidDocDateError extends DomainError {
  constructor(message: string) {
    super(message, 400, "INVALID_DOC_DATE");
    this.name = "InvalidDocDateError";
  }
}
export class ProductRecomputingError extends DomainError {
  constructor() {
    super("Mã hàng đang được tính lại giá vốn, vui lòng thử lại sau ít phút.", 409, "PRODUCT_RECOMPUTING");
    this.name = "ProductRecomputingError";
  }
}
export class DependentDocumentsError extends DomainError {
  constructor() {
    super("Không hủy/sửa được: đã có chứng từ (trả hàng, thành phẩm sản xuất) dựa trên giá vốn của chứng từ này. Hãy xử lý chứng từ đó trước.", 409, "DEPENDENT_DOCUMENTS");
    this.name = "DependentDocumentsError";
  }
}

// Lỗi lập trình / dữ liệu hỏng: KHÔNG phải DomainError → route trả 500 chung, log đầy đủ.
export class ProductNotLockedError extends Error {
  constructor(public readonly productId: number) {
    super(`Mã hàng ${productId} chưa được khoá — phải liệt kê trong 'products' của withInventoryTx.`);
    this.name = "ProductNotLockedError";
  }
}
export class ReplayTooLargeError extends Error {
  constructor(public readonly productId: number, public readonly eventCount: number) {
    super(`Tính lại mã hàng ${productId} chạm ${eventCount} sự kiện — vượt ngưỡng đồng bộ.`);
    this.name = "ReplayTooLargeError";
  }
}
export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineInvariantError";
  }
}
```

- [ ] **Step 3: Test khoá (đỏ)**

`tests/inventory/lock.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertLocked, lockProducts, sortedUniqueIds } from "@/server/inventory/lock";
import { ProductNotLockedError } from "@/server/inventory/errors";
import type { EngineCtx } from "@/server/inventory/types";
import { prisma } from "../helpers/db";

const stub = (tx: EngineCtx["tx"]) => ({ tx, locked: new Set<number>() }) as Pick<EngineCtx, "tx" | "locked">;

describe("sortedUniqueIds", () => {
  it("loại trùng và sắp tăng dần", () => {
    expect(sortedUniqueIds([5, 3, 5, 1, 3])).toEqual([1, 3, 5]);
    expect(sortedUniqueIds([])).toEqual([]);
  });
});

describe("lockProducts", () => {
  it("ghi nhận mã đã khoá, khoá lại mã đã có thì bỏ qua", async () => {
    await prisma.$transaction(async (tx) => {
      const ctx = stub(tx);
      await lockProducts(ctx, [3, 1, 3]);
      expect([...ctx.locked].sort()).toEqual([1, 3]);
      await lockProducts(ctx, [1]);
      expect(ctx.locked.size).toBe(2);
    });
  });

  it("assertLocked ném lỗi lập trình khi chưa khoá", async () => {
    await prisma.$transaction(async (tx) => {
      const ctx = stub(tx);
      expect(() => assertLocked(ctx, 7)).toThrow(ProductNotLockedError);
      await lockProducts(ctx, [7]);
      expect(() => assertLocked(ctx, 7)).not.toThrow();
    });
  });

  it("2 transaction khoá CÙNG mã: bên sau phải CHỜ bên trước commit", async () => {
    const log: string[] = [];
    const a = prisma.$transaction(async (tx) => {
      await lockProducts(stub(tx), [42]);
      log.push("A giữ khoá");
      await new Promise((r) => setTimeout(r, 300));
      log.push("A xong");
    });
    await new Promise((r) => setTimeout(r, 80)); // đảm bảo A giữ khoá trước
    const b = prisma.$transaction(async (tx) => {
      await lockProducts(stub(tx), [42]);
      log.push("B giữ khoá");
    });
    await Promise.all([a, b]);
    expect(log).toEqual(["A giữ khoá", "A xong", "B giữ khoá"]);
  });

  it("khoá theo thứ tự tăng dần → nhiều giao dịch chéo [1,2] / [2,1] KHÔNG deadlock", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      prisma.$transaction(async (tx) => {
        await lockProducts(stub(tx), i % 2 === 0 ? [1, 2, 3] : [3, 2, 1]);
        await new Promise((r) => setTimeout(r, 20));
      }, { maxWait: 15_000, timeout: 30_000 }),
    );
    await expect(Promise.all(jobs)).resolves.toHaveLength(12);
  });
});
```
- [ ] **Step 4: Chạy → đỏ; cài `lock.ts`**

`src/server/inventory/lock.ts`:
```ts
import { ProductNotLockedError } from "./errors";
import type { EngineCtx } from "./types";

/** Không gian khoá advisory: (LOCK_CLASS_PRODUCT, productId). */
export const LOCK_CLASS_PRODUCT = 1001;

export const sortedUniqueIds = (ids: readonly number[]): number[] =>
  [...new Set(ids)].sort((a, b) => a - b);

/** Khoá theo thứ tự product_id TĂNG DẦN (spec 3.0). Khoá tự nhả khi transaction kết thúc. */
export async function lockProducts(ctx: Pick<EngineCtx, "tx" | "locked">, ids: readonly number[]): Promise<void> {
  for (const id of sortedUniqueIds(ids)) {
    if (ctx.locked.has(id)) continue;
    await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CLASS_PRODUCT}::int, ${id}::int)`;
    ctx.locked.add(id);
  }
}

export function assertLocked(ctx: Pick<EngineCtx, "locked">, productId: number): void {
  if (!ctx.locked.has(productId)) throw new ProductNotLockedError(productId);
}
```
Run: `npm test -- tests/inventory/lock.test.ts`
Expected: PASS. Nếu Prisma báo `Failed to deserialize column of type 'void'` ở `$executeRaw` với `SELECT pg_advisory_xact_lock`: đổi dòng khoá thành `await ctx.tx.$queryRaw\`SELECT 1 FROM (SELECT pg_advisory_xact_lock(${LOCK_CLASS_PRODUCT}::int, ${id}::int)) AS t\`;`.

- [ ] **Step 5: Hạ tầng test engine — `assertLedgerBalanced` (Review Focus #3) và `newWorld`**

`tests/inventory/helpers.ts`:
```ts
import { Prisma } from "@prisma/client";
import { expect } from "vitest";
import { prisma } from "../helpers/db";
import { makePeriod, makeProduct, makeUser } from "../helpers/factories";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Mốc thời gian dễ đọc: T(n) = n phút sau 01/09/2026 00:00Z. */
export const T = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 0, 0) + minutes * 60_000);

export async function newWorld(productCount = 1) {
  const user = await makeUser();
  // Kỳ mở từ 01/08/2026 để các mốc T(n) (tháng 9) đều nằm trong kỳ
  const period = await makePeriod({ openedAt: new Date("2026-08-01T00:00:00Z") });
  const products = [];
  for (let i = 0; i < productCount; i++) products.push(await makeProduct());
  return { userId: user.id, periodId: period.id, period, products, p: products[0]! };
}
export type World = Awaited<ReturnType<typeof newWorld>>;

/**
 * Bất biến sổ kho — gọi sau MỌI thao tác trong test engine:
 *  (1) Σ qtyIn − Σ qtyOut = Σ layer.qtyRemaining − Σ qtyProvisional   (tồn tính từ sổ = tồn tính từ lớp)
 *  (2) mỗi lớp: qtyRemaining = qtyIn − Σ consumption của lớp đó
 *  (3) mỗi dòng xuất: Σ consumption + qtyProvisional = qtyOut
 */
export async function assertLedgerBalanced(productId: number, periodId: number): Promise<void> {
  const led = await prisma.stockLedger.aggregate({
    where: { productId, periodId },
    _sum: { qtyIn: true, qtyOut: true, qtyProvisional: true },
  });
  const lay = await prisma.costLayer.aggregate({ where: { productId, periodId }, _sum: { qtyRemaining: true } });
  const inn = D(led._sum.qtyIn ?? 0);
  const out = D(led._sum.qtyOut ?? 0);
  const prov = D(led._sum.qtyProvisional ?? 0);
  const rem = D(lay._sum.qtyRemaining ?? 0);
  expect(inn.minus(out).toString(), "Σin − Σout = Σremaining − Σprovisional").toBe(rem.minus(prov).toString());

  const layers = await prisma.$queryRaw<{ id: number; expected: Prisma.Decimal; actual: Prisma.Decimal }[]>`
    SELECT cl.id, cl."qtyIn" - COALESCE(SUM(cc.qty), 0) AS expected, cl."qtyRemaining" AS actual
      FROM cost_layers cl LEFT JOIN cost_consumptions cc ON cc."layerId" = cl.id
     WHERE cl."productId" = ${productId} AND cl."periodId" = ${periodId}
     GROUP BY cl.id`;
  for (const l of layers) expect(D(l.actual).toString(), `lớp ${l.id}: remaining = in − Σconsumption`).toBe(D(l.expected).toString());

  const outs = await prisma.$queryRaw<{ id: number; qty_out: Prisma.Decimal; prov: Prisma.Decimal; consumed: Prisma.Decimal }[]>`
    SELECT sl.id, sl."qtyOut" AS qty_out, sl."qtyProvisional" AS prov, COALESCE(SUM(cc.qty), 0) AS consumed
      FROM stock_ledger sl LEFT JOIN cost_consumptions cc ON cc."ledgerId" = sl.id
     WHERE sl."productId" = ${productId} AND sl."periodId" = ${periodId} AND sl."qtyOut" > 0
     GROUP BY sl.id`;
  for (const o of outs) expect(D(o.consumed).plus(o.prov).toString(), `dòng xuất ${o.id}: Σconsumption + provisional = qtyOut`).toBe(D(o.qty_out).toString());
}
```
`tests/inventory/helpers.test.ts` — kiểm chính helper có "răng" (phát hiện sổ lệch):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, newWorld, T } from "./helpers";

beforeEach(resetDb);

describe("assertLedgerBalanced", () => {
  it("sổ rỗng và sổ nhập đơn giản thì cân", async () => {
    const w = await newWorld();
    await assertLedgerBalanced(w.p.id, w.periodId);
    const l = await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 10, at: T(0), createdBy: w.userId } });
    await prisma.costLayer.create({ data: { periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: l.id, qtyIn: 10, qtyRemaining: 10, unitCost: 5, at: T(0) } });
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("PHÁT HIỆN lớp bị trừ mà không có consumption (sổ lệch)", async () => {
    const w = await newWorld();
    const l = await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 10, at: T(0), createdBy: w.userId } });
    await prisma.costLayer.create({ data: { periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: l.id, qtyIn: 10, qtyRemaining: 7, unitCost: 5, at: T(0) } });
    await expect(assertLedgerBalanced(w.p.id, w.periodId)).rejects.toThrow();
  });
});
```
Run: `npm test -- tests/inventory` → PASS.

- [ ] **Step 6: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(inventory): nền móng engine — schema job nền, kiểu, lỗi, advisory lock, helper cân sổ"
```

---

### Task 2: Thời điểm chứng từ (ICT) và truy vấn tồn/giá

**Files:**
- Create: `src/server/inventory/time.ts`, `src/server/inventory/queries.ts`
- Test: `tests/inventory/time.test.ts`, `tests/inventory/queries.test.ts`

**Interfaces:**
- Consumes: `toIct`, `ictStartOfDay` (`@/lib/time`), `parseYmd` (`@/lib/time-presets`), `InvalidDocDateError`.
- Produces:
  - `docTimestamp(date: string | Date, now: Date): Date` — ngày hôm nay (ICT) → `now`; ngày quá khứ → 23:59:59.999 ICT của ngày đó; tương lai/không hợp lệ → `InvalidDocDateError`
  - `getOnHand(db: Tx | PrismaClient, periodId: number, productId: number): Promise<Dec>` = `Σ qty_remaining − Σ qty_provisional`
  - `estimateCost(tx: Tx, periodId: number, productId: number, at: Date): Promise<Dec>` — giá lớp NHẬP (không phải lớp phụ thuộc) gần nhất có `at ≤ thời điểm xuất`; không có thì lớp nhập đầu tiên; không có lớp nào thì 0

- [ ] **Step 1: Test `docTimestamp` (Review Focus #2) — đỏ**

`tests/inventory/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { InvalidDocDateError } from "@/server/inventory/errors";
import { docTimestamp } from "@/server/inventory/time";

describe("docTimestamp — thời điểm ghi sổ theo giờ ICT", () => {
  it("chứng từ ngày HÔM NAY (ICT) → đúng thời điểm hiện tại", () => {
    const now = new Date("2026-09-30T16:50:00Z"); // 23:50 ICT 30/09
    expect(docTimestamp("2026-09-30", now)).toEqual(now);
  });

  it("23:50 ICT 30/09: chứng từ ngày 01/10 là NGÀY MAI theo ICT → bị từ chối (không nhảy ngày theo UTC)", () => {
    const now = new Date("2026-09-30T16:50:00Z");
    expect(() => docTimestamp("2026-10-01", now)).toThrow("Ngày chứng từ không được ở tương lai.");
  });

  it("chứng từ ngày QUÁ KHỨ → 23:59:59.999 ICT của ngày đó", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    expect(docTimestamp("2026-09-15", now).toISOString()).toBe("2026-09-15T16:59:59.999Z");
  });

  it("00:05 ICT ngày 01/10: chứng từ ngày 30/09 là quá khứ → cuối ngày 30/09 ICT", () => {
    const now = new Date("2026-09-30T17:05:00Z"); // 00:05 ICT 01/10
    expect(docTimestamp("2026-09-30", now).toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(docTimestamp("2026-10-01", now)).toEqual(now);
  });

  it("nhận Date: lấy phần NGÀY theo ICT", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    expect(docTimestamp(new Date("2026-09-14T20:00:00Z"), now).toISOString()).toBe("2026-09-15T16:59:59.999Z"); // 03:00 ICT 15/09
  });

  it("ngày tương lai hoặc không hợp lệ → InvalidDocDateError tiếng Việt", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    expect(() => docTimestamp("2026-10-02", now)).toThrow(InvalidDocDateError);
    expect(() => docTimestamp("2026-10-02", now)).toThrow("Ngày chứng từ không được ở tương lai.");
    expect(() => docTimestamp("2026-02-30", now)).toThrow("Ngày chứng từ không hợp lệ.");
    expect(() => docTimestamp("abc", now)).toThrow("Ngày chứng từ không hợp lệ.");
    expect(() => docTimestamp(new Date("invalid"), now)).toThrow("Ngày chứng từ không hợp lệ.");
  });
});
```
- [ ] **Step 2: Cài `time.ts`**

`src/server/inventory/time.ts`:
```ts
import { ictStartOfDay, toIct } from "@/lib/time";
import { parseYmd } from "@/lib/time-presets";
import { InvalidDocDateError } from "./errors";

/**
 * Thời điểm ghi sổ của chứng từ (D-7: sắp lớp/lệnh theo (at, id)).
 *  - ngày hôm nay (ICT)  → `now` (giữ đúng thứ tự thao tác trong ngày)
 *  - ngày quá khứ        → 23:59:59.999 ICT của ngày đó (sau mọi thao tác thật của ngày, tie-break bằng id)
 *  - ngày tương lai      → lỗi
 */
export function docTimestamp(date: string | Date, now: Date): Date {
  let day: { y: number; m: number; d: number } | null;
  if (typeof date === "string") {
    day = parseYmd(date);
  } else if (Number.isNaN(date.getTime())) {
    day = null;
  } else {
    const p = toIct(date);
    day = { y: p.y, m: p.m, d: p.d };
  }
  if (!day) throw new InvalidDocDateError("Ngày chứng từ không hợp lệ.");

  const t = toIct(now);
  const cmp = day.y - t.y || day.m - t.m || day.d - t.d;
  if (cmp > 0) throw new InvalidDocDateError("Ngày chứng từ không được ở tương lai.");
  if (cmp === 0) return now;
  return new Date(ictStartOfDay(day.y, day.m, day.d + 1).getTime() - 1);
}
```
Run: `npm test -- tests/inventory/time.test.ts` → PASS.

- [ ] **Step 3: Test truy vấn (đỏ) rồi cài**

`tests/inventory/queries.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { estimateCost, getOnHand } from "@/server/inventory/queries";
import { prisma, resetDb } from "../helpers/db";
import { newWorld, T, type World } from "./helpers";

beforeEach(resetDb);

// Dựng lớp/dòng xuất THÔ (chưa qua engine) để kiểm truy vấn độc lập
async function rawLayer(w: World, at: number, qty: number, unitCost: number, opts: { ref?: boolean } = {}) {
  const n = (await prisma.stockLedger.count()) + 1;
  const l = await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE", docId: n, docLineId: n, qtyIn: qty, at: T(at), createdBy: w.userId } });
  return prisma.costLayer.create({
    data: {
      periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: n, sourceLineId: n, ledgerId: l.id,
      qtyIn: qty, qtyRemaining: qty, unitCost, at: T(at),
      ...(opts.ref ? { costRefType: "SALE" as const, costRefId: 1, costRefQty: qty } : {}),
    },
  });
}

describe("getOnHand", () => {
  it("= Σ qty_remaining − Σ qty_provisional (có thể ÂM khi bán âm kho)", async () => {
    const w = await newWorld();
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("0");
    await rawLayer(w, 0, 100, 10);
    await prisma.costLayer.updateMany({ data: { qtyRemaining: 60 } });
    await prisma.stockLedger.create({ data: { periodId: w.periodId, productId: w.p.id, docType: "SALE", docId: 9, docLineId: 9, qtyOut: 25, qtyProvisional: 25, at: T(5), createdBy: w.userId } });
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("35");
  });

  it("chỉ tính đúng kỳ và đúng mã hàng", async () => {
    const w = await newWorld(2);
    await rawLayer(w, 0, 100, 10);
    expect((await getOnHand(prisma, w.periodId, w.products[1]!.id)).toString()).toBe("0");
    expect((await getOnHand(prisma, w.periodId + 99, w.p.id)).toString()).toBe("0");
  });
});

describe("estimateCost — giá vốn tạm cho phần xuất thiếu hàng (spec 3.3)", () => {
  it("lấy giá lớp nhập GẦN NHẤT có at ≤ thời điểm xuất", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 10, 100);
    await rawLayer(w, 10, 10, 120);
    await rawLayer(w, 20, 10, 150);
    const price = (at: number) => prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(at)));
    expect((await price(5)).toString()).toBe("100");
    expect((await price(10)).toString()).toBe("120"); // lớp cùng thời điểm tính là "đã có"
    expect((await price(15)).toString()).toBe("120");
    expect((await price(99)).toString()).toBe("150");
  });

  it("chưa có lớp nào trước thời điểm xuất → lấy lớp nhập ĐẦU TIÊN; không có lớp nào → 0", async () => {
    const w = await newWorld();
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(0)))).toString()).toBe("0");
    await rawLayer(w, 50, 10, 200);
    await rawLayer(w, 60, 10, 300);
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(0)))).toString()).toBe("200");
  });

  it("bỏ qua lớp PHỤ THUỘC (trả hàng/thành phẩm) — không phải 'giá nhập'", async () => {
    const w = await newWorld();
    await rawLayer(w, 0, 10, 100);
    await rawLayer(w, 10, 5, 999, { ref: true });
    expect((await prisma.$transaction((tx) => estimateCost(tx, w.periodId, w.p.id, T(20)))).toString()).toBe("100");
  });
});
```
`src/server/inventory/queries.ts`:
```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Dec, Tx } from "./types";

/** Tồn = Σ qty_remaining − Σ qty_provisional (tính khi đọc — spec 1.3). Âm khi đang bán âm kho. */
export async function getOnHand(db: Tx | PrismaClient, periodId: number, productId: number): Promise<Dec> {
  const rows = await db.$queryRaw<{ on_hand: Prisma.Decimal }[]>`
    SELECT COALESCE((SELECT SUM("qtyRemaining") FROM cost_layers WHERE "periodId" = ${periodId} AND "productId" = ${productId}), 0)
         - COALESCE((SELECT SUM("qtyProvisional") FROM stock_ledger WHERE "periodId" = ${periodId} AND "productId" = ${productId}), 0) AS on_hand`;
  return new Prisma.Decimal(rows[0]!.on_hand);
}

/** Giá vốn tạm cho phần xuất chưa có lớp: giá nhập gần nhất tại thời điểm xuất → lớp đầu tiên → 0. */
export async function estimateCost(tx: Tx, periodId: number, productId: number, at: Date): Promise<Dec> {
  const before = await tx.costLayer.findFirst({
    where: { periodId, productId, costRefType: null, at: { lte: at } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { unitCost: true },
  });
  if (before) return before.unitCost;
  const first = await tx.costLayer.findFirst({
    where: { periodId, productId, costRefType: null },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { unitCost: true },
  });
  return first?.unitCost ?? new Prisma.Decimal(0);
}
```
Run: `npm test -- tests/inventory` → PASS.

- [ ] **Step 4: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(inventory): docTimestamp theo ICT, getOnHand, estimateCost"
```

---

### Task 3: Đơn vị công việc, kiểm kỳ, cổng ghi nguồn (post/remove/updateLayerCost)

**Files:**
- Create: `src/server/period/guard.ts`, `src/server/inventory/layers.ts`, `src/server/inventory/unit-of-work.ts` (phần `beginEngine`, `markDirty`, `retryOnDeadlock`), `src/server/inventory/ports.ts`
- Test: `tests/period/guard.test.ts`, `tests/inventory/ports.test.ts`, `tests/inventory/retry.test.ts`

**Interfaces:**
- Consumes: `lockProducts`, `assertLocked`, `docTimestamp` (Task 1–2), lỗi (Task 1).
- Produces:
  - `getOpenPeriod(db): Promise<{id; openedAt}>`, `assertPeriodOpen(db, periodId): Promise<{id; openedAt}>` (ném `PeriodClosedError`), `assertDocDateInPeriod(period, at)` (ném `DocDateBeforePeriodError`) — `@/server/period/guard`
  - `beginEngine(tx, opts: { periodId?: number; userId: number; products: number[]; inlineLimit?: number; mode?: "inline"|"worker" }): Promise<EngineCtx>`
  - `markDirty(ctx, productId, at): void`
  - `retryOnDeadlock<T>(fn: () => Promise<T>, attempts?: number): Promise<T>`
  - `postReceipt(ctx, i: ReceiptInput): Promise<{ledgerId; layerId}>`; `interface ReceiptInput { productId; qty: DecInput; unitCost: DecInput; docType: InDocType; docId: number; docLineId: number; at: Date; costRef?: { docType: StockDocType; docLineId: number; qty: DecInput } }`
  - `postIssue(ctx, i: IssueInput): Promise<{ledgerId}>`; `interface IssueInput { productId; qty: DecInput; docType: OutDocType; docId: number; docLineId: number; at: Date }`
  - `removeDocument(ctx, docType: StockDocType, docId: number): Promise<{removed: number}>`
  - `updateLayerCost(ctx, i: { docType: StockDocType; docId: number; docLineId?: number; unitCost: DecInput }): Promise<{updated: number}>`
  - `productsOfDocument(db, docType, docId): Promise<number[]>`

> Task này CHƯA có tính lại chuỗi (Task 4). Các test ở đây chỉ kiểm ghi nguồn, kiểm kỳ, khoá và đánh dấu dirty — nên tự dựng `beginEngine` trong `prisma.$transaction` và KHÔNG gọi `flush`.

- [ ] **Step 1: Test kiểm kỳ (Review Focus #5) — đỏ**

`tests/period/guard.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { DocDateBeforePeriodError, PeriodClosedError } from "@/server/inventory/errors";
import { assertDocDateInPeriod, assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod } from "../helpers/factories";

beforeEach(resetDb);

describe("getOpenPeriod / assertPeriodOpen", () => {
  it("trả kỳ đang mở; kỳ đã đóng → PeriodClosedError tiếng Việt", async () => {
    const closed = await makePeriod({ status: "CLOSED", isOpen: null, closedAt: new Date() });
    const open = await makePeriod();
    expect((await getOpenPeriod(prisma)).id).toBe(open.id);
    await expect(assertPeriodOpen(prisma, closed.id)).rejects.toThrow(PeriodClosedError);
    await expect(assertPeriodOpen(prisma, closed.id)).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    expect((await assertPeriodOpen(prisma, open.id)).id).toBe(open.id);
  });

  it("không có kỳ nào mở → lỗi rõ ràng", async () => {
    await expect(getOpenPeriod(prisma)).rejects.toThrow("Hệ thống chưa có kỳ đang mở.");
  });

  it("kỳ không tồn tại → PeriodClosedError (coi như không ghi được)", async () => {
    await expect(assertPeriodOpen(prisma, 99999)).rejects.toThrow(PeriodClosedError);
  });
});

describe("assertDocDateInPeriod — không ghi ngày trước ngày mở kỳ", () => {
  const period = { id: 1, openedAt: new Date("2026-09-24T03:00:00Z") }; // 10:00 ICT 24/09

  it("cho phép chứng từ từ đầu ngày mở kỳ (ICT) trở đi", () => {
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-23T17:00:00Z"))).not.toThrow(); // 00:00 ICT 24/09
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-24T05:00:00Z"))).not.toThrow();
  });

  it("chặn chứng từ thuộc ngày trước ngày mở kỳ", () => {
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-23T16:59:59.999Z"))).toThrow(DocDateBeforePeriodError);
    expect(() => assertDocDateInPeriod(period, new Date("2026-09-23T16:59:59.999Z"))).toThrow("Ngày chứng từ trước ngày mở kỳ hiện tại");
  });
});
```
- [ ] **Step 2: Cài `src/server/period/guard.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { ictStartOfDay, toIct } from "@/lib/time";
import { DomainError } from "@/server/http/errors";
import { DocDateBeforePeriodError, PeriodClosedError } from "@/server/inventory/errors";
import type { Tx } from "@/server/inventory/types";

export interface PeriodRef {
  id: number;
  openedAt: Date;
}

/** Kỳ đang mở duy nhất (luôn có đúng 1 — ràng buộc DB). */
export async function getOpenPeriod(db: Tx | PrismaClient): Promise<PeriodRef> {
  const p = await db.period.findFirst({ where: { isOpen: true }, select: { id: true, openedAt: true } });
  if (!p) throw new DomainError("Hệ thống chưa có kỳ đang mở.", 500, "NO_OPEN_PERIOD");
  return p;
}

/** Chứng từ chỉ sửa/hủy được khi kỳ của nó còn MỞ. */
export async function assertPeriodOpen(db: Tx | PrismaClient, periodId: number): Promise<PeriodRef> {
  const p = await db.period.findFirst({ where: { id: periodId, isOpen: true }, select: { id: true, openedAt: true } });
  if (!p) throw new PeriodClosedError();
  return p;
}

/** Không ghi chứng từ có ngày (theo ICT) trước ngày mở kỳ hiện tại. */
export function assertDocDateInPeriod(period: PeriodRef, at: Date): void {
  const o = toIct(period.openedAt);
  if (at < ictStartOfDay(o.y, o.m, o.d)) throw new DocDateBeforePeriodError();
}
```
Run: `npm test -- tests/period` → PASS.

- [ ] **Step 3: Test thử lại khi deadlock (đỏ) rồi cài `retryOnDeadlock`**

`tests/inventory/retry.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { retryOnDeadlock } from "@/server/inventory/unit-of-work";

describe("retryOnDeadlock", () => {
  it("thử lại khi PostgreSQL báo deadlock, thành công ở lần thứ 3", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n < 3) throw new Error("Transaction failed due to a write conflict or a deadlock detected");
      return "ok";
    });
    await expect(retryOnDeadlock(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("nhận diện mã P2034 và 40P01", async () => {
    let a = 0;
    await expect(retryOnDeadlock(async () => { if (++a < 2) throw Object.assign(new Error("x"), { code: "P2034" }); return 1; })).resolves.toBe(1);
    let b = 0;
    await expect(retryOnDeadlock(async () => { if (++b < 2) throw Object.assign(new Error("x"), { code: "40P01" }); return 2; })).resolves.toBe(2);
  });

  it("lỗi khác KHÔNG được thử lại", async () => {
    const fn = vi.fn(async () => { throw new Error("Số lượng phải lớn hơn 0."); });
    await expect(retryOnDeadlock(fn)).rejects.toThrow("Số lượng");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("hết số lần thử thì ném lỗi cuối", async () => {
    const fn = vi.fn(async () => { throw new Error("deadlock detected"); });
    await expect(retryOnDeadlock(fn, 3)).rejects.toThrow("deadlock detected");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```
`src/server/inventory/unit-of-work.ts` (phần đầu; Task 4 bổ sung `flush`, `withInventoryTx`):
```ts
import { assertPeriodOpen, getOpenPeriod } from "@/server/period/guard";
import { lockProducts } from "./lock";
import { DEFAULT_INLINE_LIMIT, type EngineCtx, type Tx } from "./types";

export interface EngineOptions {
  /** Bỏ trống = kỳ đang mở. */
  periodId?: number;
  userId: number;
  /** ĐỦ mọi mã hàng sẽ chạm. Engine khoá theo thứ tự tăng dần. */
  products: number[];
  inlineLimit?: number;
  mode?: "inline" | "worker";
}

/** Mở ngữ cảnh kho trong 1 transaction: kiểm kỳ còn mở → khoá mã hàng (tăng dần). */
export async function beginEngine(tx: Tx, opts: EngineOptions): Promise<EngineCtx> {
  const period = opts.periodId ? await assertPeriodOpen(tx, opts.periodId) : await getOpenPeriod(tx);
  const ctx: EngineCtx = {
    tx, period, userId: opts.userId,
    locked: new Set(), dirty: new Map(), afterCommit: [],
    inlineLimit: opts.inlineLimit ?? DEFAULT_INLINE_LIMIT,
    mode: opts.mode ?? "inline",
  };
  await lockProducts(ctx, opts.products);
  return ctx;
}

/** Ghi nhận mã hàng cần tính lại từ thời điểm `at` (giữ mốc SỚM NHẤT). */
export function markDirty(ctx: Pick<EngineCtx, "dirty">, productId: number, at: Date): void {
  const cur = ctx.dirty.get(productId);
  if (!cur || at < cur) ctx.dirty.set(productId, at);
}

const isDeadlock = (e: unknown): boolean => {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === "P2034" || x?.code === "40P01" || /deadlock detected/i.test(x?.message ?? "");
};

/**
 * Chạy lại cả transaction khi PostgreSQL chọn nó làm nạn nhân deadlock (hiếm: chỉ khi lan truyền giá vốn
 * phải khoá THÊM mã hàng ngoài danh sách khai báo). Lỗi nghiệp vụ không bao giờ được thử lại.
 */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isDeadlock(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
    }
  }
}
```
Run: `npm test -- tests/inventory/retry.test.ts` → PASS.

- [ ] **Step 4: Test cổng ghi nguồn (đỏ)**

`tests/inventory/ports.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { DependentDocumentsError, DocDateBeforePeriodError, InvalidCostError, InvalidQuantityError, PeriodClosedError, ProductNotLockedError, ProductRecomputingError } from "@/server/inventory/errors";
import { postIssue, postReceipt, productsOfDocument, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { beginEngine } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod } from "../helpers/factories";
import { newWorld, T, type World } from "./helpers";

beforeEach(resetDb);

const begin = (w: World, products: number[], over = {}) =>
  prisma.$transaction((tx) => beginEngine(tx, { periodId: w.periodId, userId: w.userId, products, ...over }));
const inTx = <R,>(w: World, products: number[], fn: (ctx: Awaited<ReturnType<typeof beginEngine>>) => Promise<R>) =>
  prisma.$transaction(async (tx) => fn(await beginEngine(tx, { periodId: w.periodId, userId: w.userId, products })));

describe("beginEngine", () => {
  it("kỳ đã kết sổ → PeriodClosedError và không tạo gì", async () => {
    const w = await newWorld();
    const closed = await makePeriod({ status: "CLOSED", isOpen: null });
    await expect(prisma.$transaction((tx) => beginEngine(tx, { periodId: closed.id, userId: 1, products: [w.p.id] }))).rejects.toThrow(PeriodClosedError);
  });

  it("bỏ periodId → dùng kỳ đang mở", async () => {
    const w = await newWorld();
    await prisma.$transaction(async (tx) => {
      const ctx = await beginEngine(tx, { userId: w.userId, products: [w.p.id] });
      expect(ctx.period.id).toBe(w.periodId);
      expect(ctx.locked.has(w.p.id)).toBe(true);
    });
  });
});

describe("postReceipt", () => {
  it("ghi 1 dòng sổ + 1 lớp cùng thời điểm; unitCost làm tròn 4 chữ số; đánh dấu dirty", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await postReceipt(ctx, { productId: w.p.id, qty: "3", unitCost: new Prisma.Decimal(10000).div(3), docType: "PURCHASE", docId: 1, docLineId: 1, at: T(5) });
      expect(ctx.dirty.get(w.p.id)).toEqual(T(5));
      const layer = await ctx.tx.costLayer.findUniqueOrThrow({ where: { id: r.layerId } });
      expect(layer.unitCost.toString()).toBe("3333.3333");
      expect(layer.qtyRemaining.toString()).toBe("3");
      expect(layer.ledgerId).toBe(r.ledgerId);
      expect(layer.at).toEqual(T(5));
      const led = await ctx.tx.stockLedger.findUniqueOrThrow({ where: { id: r.ledgerId } });
      expect(led.qtyIn.toString()).toBe("3");
      expect(led.periodId).toBe(w.periodId);
      expect(led.createdBy).toBe(w.userId);
    });
  });

  it("dirty giữ mốc SỚM NHẤT khi ghi nhiều lần", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(20) });
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 2, docLineId: 2, at: T(5) });
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 3, docLineId: 3, at: T(30) });
      expect(ctx.dirty.get(w.p.id)).toEqual(T(5));
    });
  });

  it("từ chối số lượng ≤ 0, giá âm, mã hàng chưa khoá, ngày trước kỳ — không ghi gì", async () => {
    const w = await newWorld(2);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 0, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(InvalidQuantityError);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: -5, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow("Số lượng phải lớn hơn 0.");
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: -1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(InvalidCostError);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.products[1]!.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) }))).rejects.toThrow(ProductNotLockedError);
    await expect(inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: new Date("2026-07-31T00:00:00Z") }))).rejects.toThrow(DocDateBeforePeriodError);
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
  });

  it("ghi lớp phụ thuộc (costRef) cho trả hàng / thành phẩm", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await postReceipt(ctx, { productId: w.p.id, qty: 10, unitCost: 20444.4444, docType: "RETURN_IN", docId: 5, docLineId: 5, at: T(40), costRef: { docType: "SALE", docLineId: 2, qty: 90 } });
      const layer = await ctx.tx.costLayer.findUniqueOrThrow({ where: { id: r.layerId } });
      expect([layer.costRefType, layer.costRefId, layer.costRefQty?.toString()]).toEqual(["SALE", 2, "90"]);
    });
  });
});

describe("postIssue", () => {
  it("ghi 1 dòng xuất (chưa có consumption — Task 4 tính); từ chối ≤ 0 và mã đang tính lại", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await postIssue(ctx, { productId: w.p.id, qty: 30, docType: "SALE", docId: 1, docLineId: 1, at: T(10) });
      const led = await ctx.tx.stockLedger.findUniqueOrThrow({ where: { id: r.ledgerId } });
      expect([led.qtyOut.toString(), led.qtyIn.toString(), led.qtyProvisional.toString()]).toEqual(["30", "0", "0"]);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(10));
    });
    await expect(inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 0, docType: "SALE", docId: 2, docLineId: 2, at: T(11) }))).rejects.toThrow(InvalidQuantityError);
    await prisma.product.update({ where: { id: w.p.id }, data: { recomputing: true } });
    await expect(inTx(w, [w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 1, docType: "SALE", docId: 3, docLineId: 3, at: T(12) }))).rejects.toThrow(ProductRecomputingError);
  });
});

describe("removeDocument", () => {
  async function seedDocs(w: World) {
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 10, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postIssue(ctx, { productId: w.p.id, qty: 30, docType: "SALE", docId: 7, docLineId: 71, at: T(10) });
      await postIssue(ctx, { productId: w.p.id, qty: 5, docType: "SALE", docId: 7, docLineId: 72, at: T(10) });
    });
  }

  it("xoá mọi dòng sổ + lớp của chứng từ, đánh dấu dirty từ thời điểm sớm nhất bị ảnh hưởng", async () => {
    const w = await newWorld();
    await seedDocs(w);
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await removeDocument(ctx, "SALE", 7);
      expect(r.removed).toBe(2);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(10));
    });
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: 7 } })).toBe(0);
    expect(await prisma.stockLedger.count({ where: { docType: "PURCHASE" } })).toBe(1);
  });

  it("xoá phiếu NHẬP: xoá lớp + dòng sổ và kéo mốc dirty về sớm nhất giữa lớp và các dòng xuất đã ăn lớp đó", async () => {
    const w = await newWorld();
    await seedDocs(w);
    // giả lập 1 consumption của SALE#7 lên lớp phiếu nhập (Task 4 sẽ tự sinh)
    const layer = await prisma.costLayer.findFirstOrThrow();
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docLineId: 71 } });
    await prisma.costConsumption.create({ data: { layerId: layer.id, ledgerId: out.id, docType: "SALE", docLineId: 71, qty: 30, unitCost: 10 } });
    await prisma.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: 70 } });
    await inTx(w, [w.p.id], async (ctx) => {
      await removeDocument(ctx, "PURCHASE", 1);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(0));
    });
    expect(await prisma.costLayer.count()).toBe(0);
    expect(await prisma.costConsumption.count()).toBe(0);
  });

  it("xoá dòng xuất đã ăn lớp → TRẢ LẠI qty_remaining của lớp (kể cả lớp nằm trước mốc tính lại)", async () => {
    const w = await newWorld();
    await seedDocs(w);
    const layer = await prisma.costLayer.findFirstOrThrow();
    const out = await prisma.stockLedger.findFirstOrThrow({ where: { docLineId: 71 } });
    await prisma.costConsumption.create({ data: { layerId: layer.id, ledgerId: out.id, docType: "SALE", docLineId: 71, qty: 30, unitCost: 10 } });
    await prisma.costLayer.update({ where: { id: layer.id }, data: { qtyRemaining: 70 } });
    await inTx(w, [w.p.id], (ctx) => removeDocument(ctx, "SALE", 7));
    expect((await prisma.costLayer.findFirstOrThrow()).qtyRemaining.toString()).toBe("100");
  });

  it("chứng từ không tồn tại → removed = 0, không lỗi", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => expect((await removeDocument(ctx, "SALE", 999)).removed).toBe(0));
  });

  it("chứng từ thuộc KỲ ĐÃ KẾT SỔ → PeriodClosedError, không xoá gì (Review Focus #5)", async () => {
    const w = await newWorld();
    await seedDocs(w);
    await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null } });
    const next = await makePeriod();
    await expect(
      prisma.$transaction(async (tx) => {
        const ctx = await beginEngine(tx, { periodId: next.id, userId: w.userId, products: [w.p.id] });
        await removeDocument(ctx, "SALE", 7);
      }),
    ).rejects.toThrow("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.");
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: 7 } })).toBe(2);
  });

  it("mã hàng của chứng từ chưa khoá → ProductNotLockedError", async () => {
    const w = await newWorld(2);
    await seedDocs(w);
    await expect(inTx(w, [w.products[1]!.id], (ctx) => removeDocument(ctx, "SALE", 7))).rejects.toThrow(ProductNotLockedError);
  });

  it("chặn xoá khi còn lớp PHỤ THUỘC vào dòng của chứng từ (trả hàng/thành phẩm)", async () => {
    const w = await newWorld();
    await seedDocs(w);
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 5, unitCost: 10, docType: "RETURN_IN", docId: 9, docLineId: 9, at: T(50), costRef: { docType: "SALE", docLineId: 71, qty: 30 } });
    });
    await expect(inTx(w, [w.p.id], (ctx) => removeDocument(ctx, "SALE", 7))).rejects.toThrow(DependentDocumentsError);
  });
});

describe("productsOfDocument", () => {
  it("trả các mã hàng khác nhau, tăng dần", async () => {
    const w = await newWorld(3);
    const [a, b, c] = w.products;
    await inTx(w, [a!.id, b!.id, c!.id], async (ctx) => {
      await postIssue(ctx, { productId: c!.id, qty: 1, docType: "SALE", docId: 3, docLineId: 31, at: T(1) });
      await postIssue(ctx, { productId: a!.id, qty: 1, docType: "SALE", docId: 3, docLineId: 32, at: T(1) });
      await postIssue(ctx, { productId: a!.id, qty: 1, docType: "SALE", docId: 3, docLineId: 33, at: T(1) });
    });
    expect(await productsOfDocument(prisma, "SALE", 3)).toEqual([a!.id, c!.id].sort((x, y) => x - y));
  });
});

describe("updateLayerCost — cước nhập sau phiếu hàng (spec 3.1)", () => {
  it("đổi giá vốn lớp của chứng từ nguồn và đánh dấu dirty từ thời điểm lớp", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], (ctx) => postReceipt(ctx, { productId: w.p.id, qty: 100, unitCost: 20000, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(3) }));
    await inTx(w, [w.p.id], async (ctx) => {
      const r = await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: "20500.12345" });
      expect(r.updated).toBe(1);
      expect(ctx.dirty.get(w.p.id)).toEqual(T(3));
    });
    expect((await prisma.costLayer.findFirstOrThrow()).unitCost.toString()).toBe("20500.1235");
  });

  it("lọc theo docLineId khi chỉ định; chứng từ không có lớp → updated = 0; giá âm bị từ chối", async () => {
    const w = await newWorld();
    await inTx(w, [w.p.id], async (ctx) => {
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 1, at: T(0) });
      await postReceipt(ctx, { productId: w.p.id, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 1, docLineId: 2, at: T(0) });
    });
    await inTx(w, [w.p.id], async (ctx) => {
      expect((await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, docLineId: 2, unitCost: 5 })).updated).toBe(1);
      expect((await updateLayerCost(ctx, { docType: "PURCHASE", docId: 99, unitCost: 5 })).updated).toBe(0);
    });
    await expect(inTx(w, [w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: -1 }))).rejects.toThrow(InvalidCostError);
  });
});
```
- [ ] **Step 5: Cài `layers.ts` và `ports.ts`**

`src/server/inventory/layers.ts`:
```ts
import type { Tx } from "./types";

/** qty_remaining = qty_in − Σ consumption còn lại, cho đúng các lớp chỉ định. */
export async function restoreLayerRemaining(tx: Tx, layerIds: readonly number[]): Promise<void> {
  const ids = [...new Set(layerIds)];
  if (ids.length === 0) return;
  await tx.$executeRaw`
    UPDATE cost_layers cl
       SET "qtyRemaining" = cl."qtyIn" - COALESCE((SELECT SUM(cc.qty) FROM cost_consumptions cc WHERE cc."layerId" = cl.id), 0)
     WHERE cl.id = ANY(${ids}::int[])`;
}
```

`src/server/inventory/ports.ts`:
```ts
import { Prisma, type PrismaClient, type StockDocType } from "@prisma/client";
import { DependentDocumentsError, InvalidCostError, InvalidQuantityError, PeriodClosedError, ProductRecomputingError } from "./errors";
import { assertDocDateInPeriod } from "@/server/period/guard";
import { restoreLayerRemaining } from "./layers";
import { assertLocked } from "./lock";
import { markDirty } from "./unit-of-work";
import type { DecInput, EngineCtx, InDocType, OutDocType, Tx } from "./types";

const D = (v: DecInput) => new Prisma.Decimal(v);

function requirePositive(qty: DecInput): Prisma.Decimal {
  const q = D(qty);
  if (!q.gt(0)) throw new InvalidQuantityError();
  return q;
}
function requireNonNegativeCost(cost: DecInput): Prisma.Decimal {
  const c = D(cost).toDecimalPlaces(4); // giá vốn đơn vị luôn (18,4)
  if (c.lt(0)) throw new InvalidCostError();
  return c;
}

export interface ReceiptInput {
  productId: number;
  qty: DecInput;
  unitCost: DecInput;
  docType: InDocType;
  docId: number;
  docLineId: number;
  at: Date;
  /** Lớp có giá vốn PHỤ THUỘC dòng khác: trả hàng (dòng bán gốc), thành phẩm SX (lệnh SX). */
  costRef?: { docType: StockDocType; docLineId: number; qty: DecInput };
}

/** Nhập kho: tạo 1 dòng sổ + 1 lớp lô. Chưa tính lại chuỗi — việc đó do flush() làm trước khi commit. */
export async function postReceipt(ctx: EngineCtx, i: ReceiptInput): Promise<{ ledgerId: number; layerId: number }> {
  assertLocked(ctx, i.productId);
  const qty = requirePositive(i.qty);
  const unitCost = requireNonNegativeCost(i.unitCost);
  assertDocDateInPeriod(ctx.period, i.at);

  const ledger = await ctx.tx.stockLedger.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, docType: i.docType, docId: i.docId, docLineId: i.docLineId,
      qtyIn: qty, qtyOut: 0, unitCostOut: 0, qtyProvisional: 0, at: i.at, createdBy: ctx.userId,
    },
  });
  const layer = await ctx.tx.costLayer.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, sourceDocType: i.docType, sourceDocId: i.docId, sourceLineId: i.docLineId,
      ledgerId: ledger.id, qtyIn: qty, qtyRemaining: qty, unitCost, at: i.at,
      costRefType: i.costRef?.docType ?? null, costRefId: i.costRef?.docLineId ?? null, costRefQty: i.costRef ? D(i.costRef.qty) : null,
    },
  });
  markDirty(ctx, i.productId, i.at);
  return { ledgerId: ledger.id, layerId: layer.id };
}

export interface IssueInput {
  productId: number;
  qty: DecInput;
  docType: OutDocType;
  docId: number;
  docLineId: number;
  at: Date;
}

/** Xuất kho: ghi 1 dòng xuất. Giá vốn (FIFO) và phần thiếu hàng do flush() tính. */
export async function postIssue(ctx: EngineCtx, i: IssueInput): Promise<{ ledgerId: number }> {
  assertLocked(ctx, i.productId);
  const qty = requirePositive(i.qty);
  assertDocDateInPeriod(ctx.period, i.at);
  if (ctx.mode === "inline") {
    const p = await ctx.tx.product.findUniqueOrThrow({ where: { id: i.productId }, select: { recomputing: true } });
    if (p.recomputing) throw new ProductRecomputingError();
  }
  const ledger = await ctx.tx.stockLedger.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, docType: i.docType, docId: i.docId, docLineId: i.docLineId,
      qtyIn: 0, qtyOut: qty, unitCostOut: 0, qtyProvisional: 0, at: i.at, createdBy: ctx.userId,
    },
  });
  markDirty(ctx, i.productId, i.at);
  return { ledgerId: ledger.id };
}

/** Các mã hàng của 1 chứng từ (dùng để khai báo `products` trước khi sửa/hủy). */
export async function productsOfDocument(db: Tx | PrismaClient, docType: StockDocType, docId: number): Promise<number[]> {
  const rows = await db.stockLedger.findMany({ where: { docType, docId }, distinct: ["productId"], select: { productId: true } });
  return rows.map((r) => r.productId).sort((a, b) => a - b);
}

/**
 * Hủy/sửa chứng từ: xoá dòng sổ, lớp và consumption của nó rồi đánh dấu tính lại từ điểm sớm nhất bị ảnh hưởng.
 * Sửa = removeDocument + đăng lại (cùng `at`). Khôi phục đơn đã hủy = đăng lại tại `at` gốc.
 */
export async function removeDocument(ctx: EngineCtx, docType: StockDocType, docId: number): Promise<{ removed: number }> {
  const rows = await ctx.tx.stockLedger.findMany({ where: { docType, docId } });
  if (rows.length === 0) return { removed: 0 };

  if (rows.some((r) => r.periodId !== ctx.period.id)) throw new PeriodClosedError();
  for (const r of rows) assertLocked(ctx, r.productId);

  const inRows = rows.filter((r) => r.qtyIn.gt(0));
  const outRows = rows.filter((r) => r.qtyOut.gt(0));
  const lineIds = outRows.map((r) => r.docLineId);

  // Không cho xoá khi còn lớp (trả hàng / thành phẩm) đang dựa vào giá vốn của các dòng này
  if (lineIds.length && (await ctx.tx.costLayer.count({ where: { costRefType: docType, costRefId: { in: lineIds }, periodId: ctx.period.id } })) > 0) {
    throw new DependentDocumentsError();
  }

  const layers = inRows.length ? await ctx.tx.costLayer.findMany({ where: { ledgerId: { in: inRows.map((r) => r.id) } } }) : [];
  const layerIds = layers.map((l) => l.id);
  const outIds = outRows.map((r) => r.id);
  // Lớp mà các dòng xuất bị xoá đã ăn: phải TRẢ LẠI số lượng (trừ khi chính lớp đó cũng bị xoá)
  const freed = outIds.length
    ? await ctx.tx.costConsumption.findMany({ where: { ledgerId: { in: outIds } }, select: { layerId: true } })
    : [];

  // Mốc tính lại theo từng mã: sớm nhất giữa dòng bị xoá và các dòng xuất KHÁC đã ăn lớp bị xoá
  const from = new Map<number, Date>();
  const touch = (productId: number, at: Date) => { const c = from.get(productId); if (!c || at < c) from.set(productId, at); };
  for (const r of rows) touch(r.productId, r.at);
  if (layerIds.length) {
    const eaters = await ctx.tx.costConsumption.findMany({ where: { layerId: { in: layerIds } }, select: { ledger: { select: { productId: true, at: true } } } });
    for (const e of eaters) touch(e.ledger.productId, e.ledger.at);
  }

  await ctx.tx.costConsumption.deleteMany({ where: { OR: [{ ledgerId: { in: outIds } }, { layerId: { in: layerIds } }] } });
  await restoreLayerRemaining(ctx.tx, freed.map((f) => f.layerId).filter((id) => !layerIds.includes(id)));
  if (layerIds.length) await ctx.tx.costLayer.deleteMany({ where: { id: { in: layerIds } } });
  await ctx.tx.stockLedger.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });

  for (const [productId, at] of from) markDirty(ctx, productId, at);
  return { removed: rows.length };
}

/** Đổi giá vốn lớp của chứng từ nguồn (vd cước vận chuyển nhập SAU phiếu hàng) → tính lại chuỗi từ lớp đó. */
export async function updateLayerCost(
  ctx: EngineCtx,
  i: { docType: StockDocType; docId: number; docLineId?: number; unitCost: DecInput },
): Promise<{ updated: number }> {
  const unitCost = requireNonNegativeCost(i.unitCost);
  const layers = await ctx.tx.costLayer.findMany({
    where: { periodId: ctx.period.id, sourceDocType: i.docType, sourceDocId: i.docId, ...(i.docLineId === undefined ? {} : { sourceLineId: i.docLineId }) },
  });
  for (const l of layers) {
    assertLocked(ctx, l.productId);
    await ctx.tx.costLayer.update({ where: { id: l.id }, data: { unitCost } });
    markDirty(ctx, l.productId, l.at);
  }
  return { updated: layers.length };
}
```
Run: `npm test -- tests/inventory/ports.test.ts tests/period tests/inventory/retry.test.ts`
Expected: PASS.
Ghi chú Task 3 test "xoá phiếu nhập …": `removeDocument` xoá consumption trước rồi layer rồi ledger — thứ tự bắt buộc do FK `RESTRICT`.

- [ ] **Step 6: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(inventory): kiểm kỳ, beginEngine, postReceipt/postIssue/removeDocument/updateLayerCost"
```

---

### Task 4: Thuật toán tính lại chuỗi `replayProduct` + `flush` + `withInventoryTx` (LÕI)

**Files:**
- Create: `src/server/inventory/owners.ts`, `src/server/inventory/replay.ts`
- Modify: `src/server/inventory/unit-of-work.ts` (thêm `flush`, `withInventoryTx`)
- Test: `tests/inventory/basic.test.ts`

**Interfaces:**
- Consumes: mọi thứ Task 1–3.
- Produces:
  - `replayProduct(ctx, productId, fromAt): Promise<{ touched: {docType; docLineId}[]; eventCount: number }>`
  - `interface LineCostSnapshot { docType: StockDocType; docLineId: number; totalCost: Dec; qtyProvisional: Dec }`, `type CostOwner = (tx: Tx, snap: LineCostSnapshot) => Promise<void>`, `registerCostOwner(docType, fn)`, `clearCostOwners()`, `lineSnapshot(tx, docType, docLineId)`
  - `flush(ctx): Promise<void>` — vòng lặp: lấy mã dirty nhỏ nhất → khoá → replay → đồng bộ về chủ sở hữu dòng + cập nhật lớp phụ thuộc (đánh dấu dirty tiếp) → lặp tới khi hết
  - `withInventoryTx(prisma, opts: EngineOptions & { finalize?: (ctx) => Promise<void> }, work: (ctx) => Promise<R>): Promise<R>` — mở transaction (timeout 30s), `beginEngine`, chạy `work`, `flush`, `finalize`, commit, chạy `afterCommit`; thử lại khi deadlock

**Thuật toán (đọc kỹ trước khi cài):**
1. **Phạm vi** = mọi lớp có `at ≥ fromAt` và mọi lệnh xuất có `at ≥ fromAt` (của mã hàng, kỳ hiện tại).
2. **Gỡ**: xoá consumption của lệnh xuất trong phạm vi HOẶC lớp trong phạm vi; khôi phục `qty_remaining` của các lớp bị đụng (`qty_in − Σ consumption còn lại`).
3. **Trạng thái đầu**: các lớp `at < fromAt` còn hàng (FIFO theo `(at,id)`) + hàng đợi **đơn treo cũ** (lệnh xuất `at < fromAt` còn thiếu hàng: `qty_out − Σ consumption > 0`, gồm cả những lệnh vừa mất consumption ở bước 2).
4. **Mô phỏng theo thời gian** (sắp `(at, nhập trước xuất, id)`): *lớp đến* → thêm vào hàng FIFO rồi **nuốt hàng đợi đơn treo theo thứ tự cũ→mới**; *lệnh xuất* → ăn lớp cũ nhất, phần thiếu vào hàng đợi.
5. **Ghi**: consumption mới, `qty_remaining` đổi, và với mọi lệnh xuất bị chạm: `unit_cost_out = (Σ qty×giá lớp + phần thiếu × giá tạm)/qty_out`, `qty_provisional = phần thiếu`.

- [ ] **Step 1: Bổ sung helper gọi engine vào `tests/inventory/helpers.ts` (dùng ở mọi test sau)**

Thêm import ở đầu file và các hàm ở cuối `tests/inventory/helpers.ts`:
```ts
import { postIssue, postReceipt } from "@/server/inventory/ports";
import type { EngineCtx } from "@/server/inventory/types";
import { withInventoryTx, type WithInventoryOptions } from "@/server/inventory/unit-of-work";

type EngineExtra = Partial<Pick<WithInventoryOptions, "inlineLimit" | "mode" | "finalize">>;

/** engine(w)(products, ctx => …, extra?) — chạy 1 công việc trong withInventoryTx của thế giới test. */
export const engine = (w: World) =>
  <R,>(products: number[], work: (ctx: EngineCtx) => Promise<R>, extra: EngineExtra = {}) =>
    withInventoryTx(prisma, { periodId: w.periodId, userId: w.userId, products, ...extra }, work);

/** Nhập: chứng từ PURCHASE số n (docId = docLineId = n). */
export const buy = (ctx: EngineCtx, productId: number, qty: number | string | Prisma.Decimal, unitCost: number | string | Prisma.Decimal, at: Date, n: number) =>
  postReceipt(ctx, { productId, qty, unitCost, docType: "PURCHASE", docId: n, docLineId: n, at });

/** Bán: chứng từ SALE số n (docId = docLineId = n). */
export const sell = (ctx: EngineCtx, productId: number, qty: number | string, at: Date, n: number) =>
  postIssue(ctx, { productId, qty, docType: "SALE", docId: n, docLineId: n, at });

export const saleRow = (docId: number) => prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId } });
export const layersOf = (productId: number) => prisma.costLayer.findMany({ where: { productId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
export const consOf = (ledgerId: number) => prisma.costConsumption.findMany({ where: { ledgerId }, orderBy: { id: "asc" } });
```

- [ ] **Step 2: Test lõi (đỏ) — ví dụ chuẩn của khách + biến thể**

`tests/inventory/basic.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { postIssue } from "@/server/inventory/ports";
import { getOnHand } from "@/server/inventory/queries";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, consOf, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";

beforeEach(resetDb);

describe("engine FIFO — nhập/bán cơ bản (spec 3.7)", () => {
  it("nhập 100@20.000 rồi bán 30 → vốn 20.000, còn 70@20.000", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    const s = await saleRow(1);
    expect(s.unitCostOut.toString()).toBe("20000");
    expect(s.qtyProvisional.toString()).toBe("0");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("70");
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("70");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("TEST CHUẨN CỦA KHÁCH: 100@20.000 → bán 30 → 100@22.000 → bán 90 = 70@20.000 + 20@22.000 ⇒ 20.444,44; còn 80@22.000", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));

    const [l1, l2] = await layersOf(w.p.id);
    expect(l1!.qtyRemaining.toString()).toBe("0");
    expect(l2!.qtyRemaining.toString()).toBe("80");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("20000");
    const s2 = await saleRow(2);
    expect(s2.unitCostOut.toFixed(2)).toBe("20444.44");
    const cons = await consOf(s2.id);
    expect(cons.map((c) => [c.layerId, c.qty.toString(), c.unitCost.toString()])).toEqual([
      [l1!.id, "70", "20000"],
      [l2!.id, "20", "22000"],
    ]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("thứ tự lớp theo THỜI GIAN chứ không theo thứ tự ghi: lớp nhập lùi ngày được ăn trước", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 200, T(20), 2)); // ghi trước nhưng ngày muộn
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1)); // ghi sau nhưng ngày sớm
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 15, T(30), 1));
    // 10@100 (lớp ngày sớm) + 5@200
    expect((await saleRow(1)).unitCostOut.toString()).toBe("133.3333");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("2 dòng cùng mã trong MỘT đơn (cùng thời điểm) được ăn lớp tuần tự theo thứ tự ghi", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 100, 10, T(0), 1);
      await buy(ctx, w.p.id, 100, 12, T(1), 2);
    });
    await run([w.p.id], async (ctx) => {
      await postIssue(ctx, { productId: w.p.id, qty: 60, docType: "SALE", docId: 5, docLineId: 51, at: T(5) });
      await postIssue(ctx, { productId: w.p.id, qty: 70, docType: "SALE", docId: 5, docLineId: 52, at: T(5) });
    });
    const rows = await prisma.stockLedger.findMany({ where: { docId: 5 }, orderBy: { docLineId: "asc" } });
    expect(rows[0]!.unitCostOut.toString()).toBe("10"); // 60@10
    expect(rows[1]!.unitCostOut.toString()).toBe("10.8571"); // (40@10 + 30@12)/70
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("bán hết đúng bằng tồn → lớp về 0, không đơn treo", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 7, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(1), 1));
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("0");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("tính lại là IDEMPOTENT: replay lại từ đầu cho đúng cùng kết quả", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
    const snap = async () => JSON.stringify({
      cons: await prisma.costConsumption.findMany({ orderBy: [{ ledgerId: "asc" }, { layerId: "asc" }], select: { layerId: true, ledgerId: true, qty: true, unitCost: true } }),
      layers: await layersOf(w.p.id),
      outs: (await prisma.stockLedger.findMany({ where: { qtyOut: { gt: 0 } }, orderBy: { id: "asc" } })).map((r) => [r.id, r.unitCostOut, r.qtyProvisional]),
    });
    const before = await snap();
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)));
    expect(await snap()).toBe(before);
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(25)));
    expect(await snap()).toBe(before);
  });

  it("lỗi giữa chừng → rollback toàn bộ (không dòng sổ/lớp mồ côi)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await expect(run([w.p.id], async (ctx) => {
      await buy(ctx, w.p.id, 10, 5, T(0), 1);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.costLayer.count()).toBe(0);
  });

  it("nhiều mã hàng trong 1 giao dịch: mỗi mã tính riêng", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => {
      await buy(ctx, a!.id, 10, 100, T(0), 1);
      await buy(ctx, b!.id, 10, 500, T(0), 2);
    });
    await run([a!.id, b!.id], async (ctx) => {
      await sell(ctx, a!.id, 4, T(5), 10);
      await sell(ctx, b!.id, 5, T(5), 11);
    });
    expect((await saleRow(10)).unitCostOut.toString()).toBe("100");
    expect((await saleRow(11)).unitCostOut.toString()).toBe("500");
    await assertLedgerBalanced(a!.id, w.periodId);
    await assertLedgerBalanced(b!.id, w.periodId);
  });
});
```
Run: `npm test -- tests/inventory/basic.test.ts`
Expected: FAIL — `withInventoryTx` chưa có.

- [ ] **Step 3: `owners.ts` — đồng bộ giá vốn về chủ sở hữu dòng chứng từ**

`src/server/inventory/owners.ts`:
```ts
import { Prisma, type StockDocType } from "@prisma/client";
import type { Dec, Tx } from "./types";

/** Giá vốn TỔNG của 1 dòng chứng từ (cộng mọi dòng sổ kho của nó — gồm cả NVL khi bán tôn xốp). */
export interface LineCostSnapshot {
  docType: StockDocType;
  docLineId: number;
  totalCost: Dec;
  /** > 0 ⇔ dòng đang "đơn treo" (chưa đủ tồn). */
  qtyProvisional: Dec;
}

/**
 * Chủ sở hữu dòng chứng từ (vd dòng đơn bán) đăng ký hàm ghi ngược `unit_cost_fifo` / `is_provisional`
 * vào bảng của nó. Engine gọi sau mỗi lần tính lại có dòng bị đổi.
 */
export type CostOwner = (tx: Tx, snap: LineCostSnapshot) => Promise<void>;

const owners = new Map<StockDocType, CostOwner>();

export function registerCostOwner(docType: StockDocType, owner: CostOwner): void {
  owners.set(docType, owner);
}
export function getCostOwner(docType: StockDocType): CostOwner | undefined {
  return owners.get(docType);
}
/** Chỉ dùng trong test. */
export function clearCostOwners(): void {
  owners.clear();
}

export async function lineSnapshot(tx: Tx, docType: StockDocType, docLineId: number): Promise<LineCostSnapshot> {
  const rows = await tx.$queryRaw<{ total: Prisma.Decimal; prov: Prisma.Decimal }[]>`
    SELECT COALESCE(SUM("qtyOut" * "unitCostOut"), 0) AS total, COALESCE(SUM("qtyProvisional"), 0) AS prov
      FROM stock_ledger
     WHERE "docType"::text = ${docType} AND "docLineId" = ${docLineId} AND "qtyOut" > 0`;
  return { docType, docLineId, totalCost: new Prisma.Decimal(rows[0]!.total), qtyProvisional: new Prisma.Decimal(rows[0]!.prov) };
}
```

- [ ] **Step 4: `replay.ts` — LÕI**

`src/server/inventory/replay.ts`:
```ts
import { Prisma, type StockDocType } from "@prisma/client";
import { ReplayTooLargeError } from "./errors";
import { restoreLayerRemaining } from "./layers";
import { assertLocked } from "./lock";
import { estimateCost } from "./queries";
import type { EngineCtx } from "./types";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

interface InEvent { kind: "in"; at: Date; id: number; layerId: number; qty: Prisma.Decimal; unitCost: Prisma.Decimal }
interface OutEvent { kind: "out"; at: Date; id: number; qty: Prisma.Decimal }
type Ev = InEvent | OutEvent;

// Cùng thời điểm: nhập TRƯỚC xuất; cùng loại: theo id
const order = (a: Ev, b: Ev) =>
  a.at.getTime() - b.at.getTime() || (a.kind === "in" ? 0 : 1) - (b.kind === "in" ? 0 : 1) || a.id - b.id;

interface Avail { layerId: number; remaining: Prisma.Decimal; orig: Prisma.Decimal; unitCost: Prisma.Decimal }
interface OutRef { id: number; at: Date; docType: StockDocType; docLineId: number; qtyOut: Prisma.Decimal; unitCostOut: Prisma.Decimal; qtyProvisional: Prisma.Decimal }
interface Acc { qty: Prisma.Decimal; cost: Prisma.Decimal }

export interface TouchedLine { docType: StockDocType; docLineId: number }
export interface ReplayResult { touched: TouchedLine[]; eventCount: number }

/**
 * Tính lại chuỗi FIFO của 1 mã hàng từ `fromAt` trở đi. LÀ THUẬT TOÁN DUY NHẤT tính consumption/giá vốn:
 * bán ở đuôi, sửa/hủy giữa chuỗi, khôi phục, nhập bù đơn treo, đổi giá lô đều đi qua đây.
 * Yêu cầu: đã khoá advisory lock mã hàng trong transaction.
 */
export async function replayProduct(ctx: EngineCtx, productId: number, fromAt: Date): Promise<ReplayResult> {
  assertLocked(ctx, productId);
  const { tx } = ctx;
  const periodId = ctx.period.id;

  // 1) Phạm vi
  const scopeLayers = await tx.costLayer.findMany({
    where: { periodId, productId, at: { gte: fromAt } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const scopeOuts = await tx.stockLedger.findMany({
    where: { periodId, productId, qtyOut: { gt: 0 }, at: { gte: fromAt } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const eventCount = scopeLayers.length + scopeOuts.length;
  if (ctx.mode === "inline" && eventCount > ctx.inlineLimit) throw new ReplayTooLargeError(productId, eventCount);

  const layerIds = scopeLayers.map((l) => l.id);
  const outIds = scopeOuts.map((o) => o.id);
  const scopeOutSet = new Set(outIds);

  // 2) Gỡ consumption bị ảnh hưởng (lệnh xuất trong phạm vi HOẶC lớp trong phạm vi)
  const hit = layerIds.length || outIds.length
    ? await tx.costConsumption.findMany({
        where: { OR: [{ ledgerId: { in: outIds } }, { layerId: { in: layerIds } }] },
        select: { id: true, ledgerId: true, layerId: true },
      })
    : [];
  // Lệnh xuất CŨ (trước fromAt) vừa mất consumption vì lớp của nó nằm trong phạm vi → sẽ thành đơn treo chờ
  const earlierIds = [...new Set(hit.map((h) => h.ledgerId).filter((id) => !scopeOutSet.has(id)))];
  if (hit.length) await tx.costConsumption.deleteMany({ where: { id: { in: hit.map((h) => h.id) } } });

  // 3) Khôi phục qty_remaining của các lớp bị đụng
  await restoreLayerRemaining(tx, [...layerIds, ...hit.map((h) => h.layerId)]);

  // 4) Trạng thái đầu: lớp còn hàng trước fromAt (FIFO theo (at, id))
  const open = await tx.costLayer.findMany({
    where: { periodId, productId, at: { lt: fromAt }, qtyRemaining: { gt: 0 } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const avail: Avail[] = open.map((l) => ({ layerId: l.id, remaining: l.qtyRemaining, orig: l.qtyRemaining, unitCost: l.unitCost }));

  // 5) Hàng đợi đơn treo CŨ (lệnh xuất trước fromAt còn thiếu hàng)
  const pending = await tx.$queryRaw<{
    id: number; at: Date; docType: StockDocType; docLineId: number;
    qtyOut: Prisma.Decimal; unitCostOut: Prisma.Decimal; qtyProvisional: Prisma.Decimal; consumed: Prisma.Decimal; cost: Prisma.Decimal;
  }[]>`
    SELECT sl.id, sl."at", sl."docType"::text AS "docType", sl."docLineId", sl."qtyOut", sl."unitCostOut", sl."qtyProvisional",
           COALESCE(SUM(cc.qty), 0) AS consumed, COALESCE(SUM(cc.qty * cc."unitCost"), 0) AS cost
      FROM stock_ledger sl
      LEFT JOIN cost_consumptions cc ON cc."ledgerId" = sl.id
     WHERE sl."periodId" = ${periodId} AND sl."productId" = ${productId} AND sl."qtyOut" > 0
       AND sl."at" < ${fromAt}
       AND (sl."qtyProvisional" > 0 OR sl.id = ANY(${earlierIds}::int[]))
     GROUP BY sl.id
    HAVING sl."qtyOut" - COALESCE(SUM(cc.qty), 0) > 0
     ORDER BY sl."at", sl.id`;

  const refs = new Map<number, OutRef>();
  const acc = new Map<number, Acc>();
  const shortfalls: { id: number; missing: Prisma.Decimal }[] = [];
  for (const p of pending) {
    refs.set(p.id, { id: p.id, at: p.at, docType: p.docType, docLineId: p.docLineId, qtyOut: D(p.qtyOut), unitCostOut: D(p.unitCostOut), qtyProvisional: D(p.qtyProvisional) });
    acc.set(p.id, { qty: D(p.consumed), cost: D(p.cost) });
    shortfalls.push({ id: p.id, missing: D(p.qtyOut).minus(p.consumed) });
  }

  // 6) Mô phỏng theo thời gian
  const events: Ev[] = [
    ...scopeLayers.map((l): Ev => ({ kind: "in", at: l.at, id: l.id, layerId: l.id, qty: l.qtyIn, unitCost: l.unitCost })),
    ...scopeOuts.map((o): Ev => {
      refs.set(o.id, { id: o.id, at: o.at, docType: o.docType, docLineId: o.docLineId, qtyOut: o.qtyOut, unitCostOut: o.unitCostOut, qtyProvisional: o.qtyProvisional });
      return { kind: "out", at: o.at, id: o.id, qty: o.qtyOut };
    }),
  ].sort(order);

  const newCons: Prisma.CostConsumptionCreateManyInput[] = [];
  let head = 0;

  /** Lệnh `outId` ăn lớp cũ nhất còn hàng; trả phần CÒN THIẾU. */
  const take = (outId: number, need: Prisma.Decimal): Prisma.Decimal => {
    const ref = refs.get(outId)!;
    while (need.gt(0) && head < avail.length) {
      const l = avail[head]!;
      if (l.remaining.lte(0)) { head++; continue; }
      const q = Prisma.Decimal.min(need, l.remaining);
      l.remaining = l.remaining.minus(q);
      need = need.minus(q);
      newCons.push({ layerId: l.layerId, ledgerId: outId, docType: ref.docType, docLineId: ref.docLineId, qty: q, unitCost: l.unitCost });
      const a = acc.get(outId) ?? { qty: ZERO, cost: ZERO };
      acc.set(outId, { qty: a.qty.plus(q), cost: a.cost.plus(q.times(l.unitCost)) });
      if (l.remaining.lte(0)) head++;
    }
    return need;
  };
  /** Đơn treo được nuốt theo thứ tự CŨ → MỚI mỗi khi có hàng (spec 3.3). */
  const drain = () => {
    while (shortfalls.length && head < avail.length) {
      const s = shortfalls[0]!;
      const left = take(s.id, s.missing);
      if (left.lte(0)) shortfalls.shift();
      else { s.missing = left; break; }
    }
  };

  drain(); // phòng thủ: đơn treo cũ + lớp còn hàng cũ không được cùng tồn tại
  for (const ev of events) {
    if (ev.kind === "in") {
      avail.push({ layerId: ev.layerId, remaining: ev.qty, orig: ev.qty, unitCost: ev.unitCost });
      drain();
    } else {
      const left = take(ev.id, ev.qty);
      if (left.gt(0)) shortfalls.push({ id: ev.id, missing: left });
    }
  }

  // 7) Ghi kết quả
  if (newCons.length) await tx.costConsumption.createMany({ data: newCons });
  for (const l of avail) {
    if (!l.remaining.equals(l.orig)) await tx.costLayer.update({ where: { id: l.layerId }, data: { qtyRemaining: l.remaining } });
  }
  const touched: TouchedLine[] = [];
  for (const ref of refs.values()) {
    const a = acc.get(ref.id) ?? { qty: ZERO, cost: ZERO };
    const missing = ref.qtyOut.minus(a.qty);
    let total = a.cost;
    if (missing.gt(0)) total = total.plus(missing.times(await estimateCost(tx, periodId, productId, ref.at)));
    const unitCostOut = total.div(ref.qtyOut).toDecimalPlaces(4);
    if (!unitCostOut.equals(ref.unitCostOut) || !missing.equals(ref.qtyProvisional)) {
      await tx.stockLedger.update({ where: { id: ref.id }, data: { unitCostOut, qtyProvisional: missing } });
    }
    touched.push({ docType: ref.docType, docLineId: ref.docLineId });
  }
  return { touched, eventCount };
}
```

- [ ] **Step 5: `flush` + `withInventoryTx` trong `unit-of-work.ts`**

Thêm vào cuối `src/server/inventory/unit-of-work.ts` (giữ nguyên phần Task 3; bổ sung các import ở đầu file):
```ts
import type { PrismaClient } from "@prisma/client";
import { EngineInvariantError, ReplayTooLargeError } from "./errors";
import { getCostOwner, lineSnapshot } from "./owners";
import { replayProduct, type TouchedLine } from "./replay";
```
```ts
const MAX_FLUSH_ITERATIONS = 10_000; // đồ thị phụ thuộc là DAG → luôn hội tụ; chặn phòng vòng lặp do dữ liệu hỏng

/** Đồng bộ giá vốn dòng về chủ sở hữu + cập nhật lớp PHỤ THUỘC; lớp đổi giá thì đánh dấu tính lại tiếp. */
async function propagate(ctx: EngineCtx, touched: TouchedLine[]): Promise<void> {
  const seen = new Set<string>();
  for (const t of touched) {
    const key = `${t.docType}:${t.docLineId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = await lineSnapshot(ctx.tx, t.docType, t.docLineId);
    const owner = getCostOwner(t.docType);
    if (owner) await owner(ctx.tx, snap);
    const derived = await ctx.tx.costLayer.findMany({
      where: { costRefType: t.docType, costRefId: t.docLineId, periodId: ctx.period.id },
    });
    for (const layer of derived) {
      if (!layer.costRefQty || layer.costRefQty.lte(0)) continue;
      const next = snap.totalCost.div(layer.costRefQty).toDecimalPlaces(4);
      if (!next.equals(layer.unitCost)) {
        await ctx.tx.costLayer.update({ where: { id: layer.id }, data: { unitCost: next } });
        markDirty(ctx, layer.productId, layer.at);
      }
    }
  }
}

/**
 * Tính lại mọi mã hàng dirty (mã nhỏ nhất trước) cho tới khi hội tụ. Mã phát sinh thêm do lan truyền
 * (NVL → thành phẩm → dòng bán) được khoá bổ sung tại đây.
 */
export async function flush(ctx: EngineCtx): Promise<void> {
  for (let i = 0; ctx.dirty.size > 0; i++) {
    if (i > MAX_FLUSH_ITERATIONS) throw new EngineInvariantError("Tính lại giá vốn không hội tụ (nghi ngờ dữ liệu phụ thuộc vòng).");
    const productId = Math.min(...ctx.dirty.keys());
    const fromAt = ctx.dirty.get(productId)!;
    ctx.dirty.delete(productId);
    await lockProducts(ctx, [productId]);

    if (ctx.mode === "inline") {
      const p = await ctx.tx.product.findUniqueOrThrow({ where: { id: productId }, select: { recomputing: true } });
      if (p.recomputing) { await mergeRecomputeJob(ctx, productId, fromAt); continue; }
    }
    let result;
    try {
      result = await replayProduct(ctx, productId, fromAt);
    } catch (e) {
      if (e instanceof ReplayTooLargeError && ctx.mode === "inline") { await deferRecompute(ctx, productId, fromAt); continue; }
      throw e;
    }
    await propagate(ctx, result.touched);
  }
}

export interface WithInventoryOptions extends EngineOptions {
  /** Chạy SAU flush, TRONG cùng transaction (vd worker nền dọn cờ `recomputing`). */
  finalize?: (ctx: EngineCtx) => Promise<void>;
}

/**
 * Cách DUY NHẤT module nghiệp vụ được đụng vào kho: mở transaction → khoá mã hàng → `work` (ghi chứng từ + post/remove)
 * → flush (tính lại chuỗi, đồng bộ giá vốn về dòng chứng từ) → commit. Deadlock được tự thử lại tối đa 3 lần.
 */
export async function withInventoryTx<R>(
  prisma: PrismaClient,
  opts: WithInventoryOptions,
  work: (ctx: EngineCtx) => Promise<R>,
): Promise<R> {
  let hooks: (() => void)[] = [];
  const result = await retryOnDeadlock(() =>
    prisma.$transaction(
      async (tx) => {
        const ctx = await beginEngine(tx, opts);
        const r = await work(ctx);
        await flush(ctx);
        if (opts.finalize) await opts.finalize(ctx);
        hooks = ctx.afterCommit;
        return r;
      },
      { maxWait: 10_000, timeout: 30_000 },
    ),
  );
  for (const h of hooks) h();
  return result;
}
```
`deferRecompute` / `mergeRecomputeJob` sẽ được cài ở Task 8; để `unit-of-work.ts` biên dịch được ngay, thêm tạm phía trên `flush` **hai hàm giữ chỗ có hành vi rõ ràng** rồi Task 8 thay bằng bản thật:
```ts
// Thay ở Task 8 bằng import từ ./recompute
async function deferRecompute(_ctx: EngineCtx, productId: number, _fromAt: Date): Promise<never> {
  throw new EngineInvariantError(`Mã hàng ${productId}: tính lại nền chưa được bật (Task 8).`);
}
async function mergeRecomputeJob(_ctx: EngineCtx, productId: number, _fromAt: Date): Promise<never> {
  throw new EngineInvariantError(`Mã hàng ${productId} đang tính lại nền (Task 8).`);
}
```
Run: `npm test -- tests/inventory/basic.test.ts`
Expected: PASS toàn bộ (8 test). Nếu lệch số ở "TEST CHUẨN CỦA KHÁCH": in ra `cons` để so với 70@20.000 + 20@22.000 và soát lại `take`/thứ tự sự kiện — KHÔNG sửa số kỳ vọng.

- [ ] **Step 6: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(inventory): replayProduct + flush + withInventoryTx — FIFO nhiều lớp, thứ tự theo thời gian, idempotent"
```

---

### Task 5: Bán âm kho / đơn treo, nhập bù, ghi đồng thời

**Files:**
- Test: `tests/inventory/provisional.test.ts`, `tests/inventory/concurrency.test.ts`

**Interfaces:** dùng lại `engine/buy/sell/saleRow/layersOf/consOf` từ `tests/inventory/helpers.ts` (Task 4 Step 1).

- [ ] **Step 1: Test đơn treo và ghi đồng thời (engine đã có từ Task 4 → các test này xanh; nếu đỏ thì sửa engine)**

`tests/inventory/provisional.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getOnHand } from "@/server/inventory/queries";
import { clearCostOwners, registerCostOwner, type LineCostSnapshot } from "@/server/inventory/owners";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, consOf, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";

beforeEach(async () => {
  await resetDb();
  clearCostOwners();
});

describe("bán âm kho → đơn treo → nhập bù (spec 3.3)", () => {
  it("không có tồn: vẫn xuất; provisional = toàn bộ; giá tạm 0; tồn ÂM; báo cho chủ dòng là 'đơn treo'", async () => {
    const w = await newWorld();
    const snaps: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, s) => { snaps.push(s); });
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    const s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("50");
    expect(s.unitCostOut.toString()).toBe("0");
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-50");
    expect(snaps.at(-1)!.qtyProvisional.toString()).toBe("50");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("NHẬP BÙ: tạo lớp → khớp đơn treo, tính lại giá vốn, gỡ cờ, báo chủ dòng", async () => {
    const w = await newWorld();
    const snaps: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, s) => { snaps.push(s); });
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10000, T(20), 1));
    const s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("0");
    expect(s.unitCostOut.toString()).toBe("10000");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("50");
    expect(snaps.at(-1)).toMatchObject({ docLineId: 1 });
    expect(snaps.at(-1)!.qtyProvisional.toString()).toBe("0");
    expect(snaps.at(-1)!.totalCost.toString()).toBe("500000");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("giá tạm = giá nhập GẦN NHẤT; sau nhập bù giá vốn thật là bình quân lớp cũ + lớp bù", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 8000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 150, T(10), 1)); // thiếu 50
    let s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("50");
    expect(s.unitCostOut.toString()).toBe("8000"); // 100@8000 + 50 tạm@8000
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 9000, T(20), 2));
    s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("0");
    expect(s.unitCostOut.toString()).toBe("8333.3333"); // (100×8000 + 50×9000)/150
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhập bù TỪNG PHẦN: đơn treo giảm dần theo từng lần nhập", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 100, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 100, T(20), 1));
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("70");
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 200, T(21), 2));
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("40");
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 300, T(22), 3));
    const s = await saleRow(1);
    expect(s.qtyProvisional.toString()).toBe("0");
    expect(s.unitCostOut.toString()).toBe("210"); // (30×100 + 30×200 + 40×300)/100
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhiều đơn treo được khớp theo thứ tự THỜI GIAN (cũ trước)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(10), 1)); // treo cũ
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(11), 2)); // treo mới
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 60, 100, T(20), 1));
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("0"); // đơn cũ đủ
    expect((await saleRow(2)).qtyProvisional.toString()).toBe("20"); // đơn mới còn thiếu 20
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("bán sau khi đã nhập bù dùng phần lớp còn lại", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10000, T(20), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(30), 2));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("10000");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("10");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("đơn treo lập TRƯỚC ngày nhập nhưng nhập bù ghi SAU vẫn được khớp (lớp ở tương lai của đơn)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(5), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 50, T(50), 1)); // lớp dated sau đơn
    expect((await consOf((await saleRow(1)).id)).length).toBe(1);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});
```
`tests/inventory/concurrency.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, sell, T } from "./helpers";

beforeEach(resetDb);

describe("ghi đồng thời cùng mã hàng (spec 3.0)", () => {
  it("2 người bán cùng lúc 60 + 60 trên tồn 100 → không ăn trùng lớp; đúng 20 treo; người bán trước theo thời gian được đủ", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10, T(0), 1));
    await Promise.all([
      run([w.p.id], (ctx) => sell(ctx, w.p.id, 60, T(10), 1)),
      run([w.p.id], (ctx) => sell(ctx, w.p.id, 60, T(11), 2)),
    ]);
    const rows = await prisma.stockLedger.findMany({ where: { docType: "SALE" }, orderBy: { docId: "asc" } });
    expect(rows.map((r) => r.qtyProvisional.toString())).toEqual(["0", "20"]);
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    const consumed = await prisma.costConsumption.aggregate({ _sum: { qty: true } });
    expect(consumed._sum.qty!.toString()).toBe("100"); // KHÔNG phải 120
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("10 giao dịch chen nhau (mỗi giao dịch 15) trên tồn 100 → tổng tiêu thụ 100, treo 50, không deadlock", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10, T(0), 1));
    await Promise.all(Array.from({ length: 10 }, (_, i) => run([w.p.id], (ctx) => sell(ctx, w.p.id, 15, T(10 + i), i + 1))));
    const agg = await prisma.stockLedger.aggregate({ where: { docType: "SALE" }, _sum: { qtyProvisional: true } });
    expect(agg._sum.qtyProvisional!.toString()).toBe("50");
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("giao dịch nhiều mã hàng khai báo thứ tự đảo nhau [a,b] / [b,a] chạy đồng thời không deadlock", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => { await buy(ctx, a!.id, 1000, 10, T(0), 1); await buy(ctx, b!.id, 1000, 20, T(0), 2); });
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      run(i % 2 ? [a!.id, b!.id] : [b!.id, a!.id], async (ctx) => {
        await sell(ctx, a!.id, 5, T(10 + i), 100 + i);
        await sell(ctx, b!.id, 5, T(10 + i), 200 + i);
      }),
    ));
    await assertLedgerBalanced(a!.id, w.periodId);
    await assertLedgerBalanced(b!.id, w.periodId);
    expect((await layersOf(a!.id))[0]!.qtyRemaining.toString()).toBe("960");
    expect((await layersOf(b!.id))[0]!.qtyRemaining.toString()).toBe("960");
  });

  it("2 giao dịch NHẬP và BÁN chen nhau: kết quả vẫn cân sổ", async () => {
    const w = await newWorld();
    const run = engine(w);
    await Promise.all([
      run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1)),
      run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10, T(5), 1)),
    ]);
    await assertLedgerBalanced(w.p.id, w.periodId);
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE" } });
    expect(row.qtyProvisional.toString()).toBe("0"); // lớp nhập có at sớm hơn dòng bán
  });
});
```
Run: `npm test -- tests/inventory`
Expected: PASS. Nếu test đồng thời treo (timeout) do cạn pool kết nối Prisma: thêm `?connection_limit=20` vào `DATABASE_URL` của `.env.test` (KHÔNG giảm số giao dịch đồng thời trong test).

- [ ] **Step 2: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "test(inventory): đơn treo, nhập bù từng phần, ghi đồng thời không ăn trùng lớp"
```

---

### Task 6: Sửa / hủy / khôi phục giữa chuỗi, làm tròn, và kiểm chứng bằng mô hình tham chiếu

**Files:**
- Create: `tests/inventory/reference.ts`
- Test: `tests/inventory/edit.test.ts`, `tests/inventory/rounding.test.ts`, `tests/inventory/property.test.ts`

- [ ] **Step 1: Test sửa/hủy/khôi phục (spec 3.5, 3.7)**

`tests/inventory/edit.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getOnHand } from "@/server/inventory/queries";
import { productsOfDocument, removeDocument } from "@/server/inventory/ports";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, saleRow, sell, T, type World } from "./helpers";

beforeEach(resetDb);

// Chuỗi chuẩn: L1 100@20.000 (T0) → S1 30 (T10) → L2 100@22.000 (T20) → S2 90 (T30)
async function chain(w: World) {
  const run = engine(w);
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
  await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
  await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2));
  return run;
}

describe("sửa đơn GIỮA chuỗi (kỳ mở) — hoàn lớp rồi tính lại chuỗi từ điểm sửa", () => {
  it("sửa S1 từ 30 lên 50 → giá vốn S2 tính lại: 50@20.000 + 40@22.000 = 20.888,89", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run(await productsOfDocument(prisma, "SALE", 1), async (ctx) => {
      await removeDocument(ctx, "SALE", 1);
      await sell(ctx, w.p.id, 50, T(10), 1); // đăng lại cùng thời điểm, số lượng mới
    });
    expect((await saleRow(1)).unitCostOut.toString()).toBe("20000");
    expect((await saleRow(2)).unitCostOut.toFixed(4)).toBe("20888.8889");
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["0", "60"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("sửa S1 GIẢM từ 30 xuống 10 → S2 ăn nhiều lớp cũ hơn", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], async (ctx) => { await removeDocument(ctx, "SALE", 1); await sell(ctx, w.p.id, 10, T(10), 1); });
    // S2: L1 còn 90 → 90@20.000 → 20.000
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20000");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});

describe("hủy đơn giữa chuỗi → hoàn kho đúng lớp", () => {
  it("hủy S1 → S2 ăn hết từ L1: giá vốn 20.000; tồn tăng lại", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20000");
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["10", "100"]);
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("110");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("hủy S2 (đơn cuối) → lớp trả lại đúng số đã ăn", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 2));
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["70", "100"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});

describe("khôi phục đơn đã hủy — xuất lại tại VỊ TRÍ THỜI GIAN GỐC (spec 34)", () => {
  it("hủy S1 rồi khôi phục (đăng lại tại T10) → mọi con số trở về y như trước khi hủy", async () => {
    const w = await newWorld();
    const run = await chain(w);
    const before = [(await saleRow(1)).unitCostOut.toString(), (await saleRow(2)).unitCostOut.toString()];
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    expect([(await saleRow(1)).unitCostOut.toString(), (await saleRow(2)).unitCostOut.toString()]).toEqual(before);
    expect((await saleRow(2)).unitCostOut.toFixed(2)).toBe("20444.44");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("khôi phục khi TỒN KHÔNG ĐỦ → thành đơn treo (spec 3.3), không lỗi", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1));
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 40, T(20), 2)); // hàng đã được bán tiếp
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 50, T(10), 1)); // khôi phục đơn 1 tại T10 (trước đơn 2)
    expect((await saleRow(1)).qtyProvisional.toString()).toBe("0"); // đơn 1 (T10) nay đứng trước → đủ hàng
    expect((await saleRow(2)).qtyProvisional.toString()).toBe("40"); // đơn 2 (T20) thành đơn treo
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});

describe("hủy PHIẾU NHẬP giữa chuỗi", () => {
  it("hủy L1 khi S1, S2 đã ăn nó → các đơn thành treo rồi được lớp L2 nuốt theo thứ tự thời gian", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => removeDocument(ctx, "PURCHASE", 1));
    const s1 = await saleRow(1);
    const s2 = await saleRow(2);
    expect(s1.qtyProvisional.toString()).toBe("0"); // L2 (T20) nuốt 30 của S1 (T10)
    expect(s2.qtyProvisional.toString()).toBe("20"); // còn 70 → S2 thiếu 20
    expect(s1.unitCostOut.toString()).toBe("22000");
    expect(s2.unitCostOut.toString()).toBe("22000"); // 70@22.000 + 20 tạm@22.000
    expect((await getOnHand(prisma, w.periodId, w.p.id)).toString()).toBe("-20");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhập lùi ngày (chèn L0 trước mọi đơn) → mọi giá vốn phía sau tính lại theo lớp mới", async () => {
    const w = await newWorld();
    const run = await chain(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 50, 10000, T(-5), 3));
    // Thứ tự lớp: L0 50@10.000, L1 100@20.000, L2 100@22.000 → S1(30) = 30@10.000
    expect((await saleRow(1)).unitCostOut.toString()).toBe("10000");
    // S2(90): 20@10.000 + 70@20.000 = 1.600.000/90
    expect((await saleRow(2)).unitCostOut.toFixed(4)).toBe("17777.7778");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});
```
Run: `npm test -- tests/inventory/edit.test.ts`
Expected: PASS. Đối chiếu tay các số: hủy S1 → S2 = 90@20.000 (L1 còn 100) ✓; hủy L1 → S1 nhận L2 30, S2 nhận 70 + 20 treo ✓; chèn L0 → S1=30@10.000; S2=20@10.000+70@20.000 ✓.

- [ ] **Step 2: Test làm tròn (Review Focus #3)**

`tests/inventory/rounding.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";

beforeEach(resetDb);

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Tổng giá vốn thực tế đã xuất (Σ qty × giá lớp) — không được lệch quá 1 đồng so với tiền nhập. */
async function consumedCost(productId: number) {
  const rows = await prisma.costConsumption.findMany({ where: { layer: { productId } } });
  return rows.reduce((s, r) => s.plus(r.qty.times(r.unitCost)), D(0));
}

describe("làm tròn: sổ luôn cân, tổng vốn không lệch quá 1 đồng", () => {
  it("lô 3 md giá 10.000/3: bán 1 rồi bán 2 → tổng vốn ≈ 10.000 (lệch ≤ 1đ)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 3, D(10000).div(3), T(0), 1));
    expect((await layersOf(w.p.id))[0]!.unitCost.toString()).toBe("3333.3333");
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, T(10), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 2, T(11), 2));
    expect((await saleRow(1)).unitCostOut.toString()).toBe("3333.3333");
    expect(D(10000).minus(await consumedCost(w.p.id)).abs().lte(1)).toBe(true);
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("0");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("1.000 kg ÷ 3 = 333,333 md (3 chữ số lẻ): bán hết → tổng vốn ≈ tiền nhập", async () => {
    const w = await newWorld();
    const run = engine(w);
    const total = D(1_000_000);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, "333.333", total.div("333.333"), T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, "333.333", T(5), 1));
    expect(total.minus(await consumedCost(w.p.id)).abs().lte(1)).toBe(true);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("3.000 kg ÷ 2,4 = 1.250 md đúng; bán 1 md giữ 3 chữ số lẻ (0,001 md)", async () => {
    const w = await newWorld();
    const run = engine(w);
    const qty = D(3000).div("2.4");
    expect(qty.toString()).toBe("1250");
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, qty, D(50_000_000).div(qty), T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, "0.001", T(5), 1));
    expect((await layersOf(w.p.id))[0]!.qtyRemaining.toString()).toBe("1249.999");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("nhiều lần bán lẻ trên lô lẻ (7 lô lẻ, 41 lần bán) không tích luỹ lệch sổ", async () => {
    const w = await newWorld();
    const run = engine(w);
    const costs = ["3333.3333", "1234.5678", "999.9999", "1500.5", "20444.4444", "7", "0.3333"];
    for (let i = 0; i < 7; i++) await run([w.p.id], (ctx) => buy(ctx, w.p.id, "13.333", costs[i]!, T(i), i + 1));
    for (let i = 0; i < 41; i++) await run([w.p.id], (ctx) => sell(ctx, w.p.id, "2.2", T(20 + i), i + 1));
    await assertLedgerBalanced(w.p.id, w.periodId);
    const left = (await layersOf(w.p.id)).reduce((s, l) => s.plus(l.qtyRemaining), D(0));
    const prov = (await prisma.stockLedger.aggregate({ _sum: { qtyProvisional: true } }))._sum.qtyProvisional ?? D(0);
    // 7×13,333 = 93,331 nhập; 41×2,2 = 90,2 xuất
    expect(left.minus(prov).toString()).toBe("3.131");
  });
});
```
Run: `npm test -- tests/inventory/rounding.test.ts` → PASS.

- [ ] **Step 3: Mô hình tham chiếu ngây thơ + property test (20 kịch bản ngẫu nhiên)**

`tests/inventory/reference.ts` — mô phỏng FIFO từ ĐẦU, cố ý viết thật đơn giản (không tối ưu) để làm chuẩn:
```ts
import { Prisma } from "@prisma/client";
import { expect } from "vitest";
import { prisma } from "../helpers/db";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface RefLayer { layerId: number; ledgerId: number; at: number; unitCost: Prisma.Decimal; qtyIn: Prisma.Decimal; remaining: Prisma.Decimal }
interface RefOut { ledgerId: number; at: number; qty: Prisma.Decimal }

/** FIFO ngây thơ: duyệt mọi sự kiện theo (thời gian, nhập trước xuất, id); lớp đến nuốt đơn treo cũ nhất trước. */
export function referenceFifo(layers: Omit<RefLayer, "remaining">[], outs: RefOut[]) {
  type Ev = { kind: "in"; at: number; id: number; layer: RefLayer } | { kind: "out"; at: number; id: number; out: RefOut };
  const L = layers.map((l) => ({ ...l, remaining: l.qtyIn })).sort((a, b) => a.at - b.at || a.layerId - b.layerId);
  const events: Ev[] = [
    ...L.map((l): Ev => ({ kind: "in", at: l.at, id: l.ledgerId, layer: l })),
    ...outs.map((o): Ev => ({ kind: "out", at: o.at, id: o.ledgerId, out: o })),
  ].sort((a, b) => a.at - b.at || (a.kind === "in" ? 0 : 1) - (b.kind === "in" ? 0 : 1) || a.id - b.id);

  const queue: RefLayer[] = [];
  const waiting: { out: RefOut; missing: Prisma.Decimal }[] = [];
  const got = new Map<number, { qty: Prisma.Decimal; cost: Prisma.Decimal }>();

  const eat = (out: RefOut, need: Prisma.Decimal) => {
    for (const l of queue) {
      if (need.lte(0)) break;
      if (l.remaining.lte(0)) continue;
      const q = Prisma.Decimal.min(need, l.remaining);
      l.remaining = l.remaining.minus(q);
      need = need.minus(q);
      const g = got.get(out.ledgerId) ?? { qty: D(0), cost: D(0) };
      got.set(out.ledgerId, { qty: g.qty.plus(q), cost: g.cost.plus(q.times(l.unitCost)) });
    }
    return need;
  };
  const drain = () => {
    while (waiting.length && queue.some((l) => l.remaining.gt(0))) {
      const w = waiting[0]!;
      const left = eat(w.out, w.missing);
      if (left.lte(0)) waiting.shift(); else { w.missing = left; break; }
    }
  };

  for (const ev of events) {
    if (ev.kind === "in") { queue.push(ev.layer); drain(); }
    else { const left = eat(ev.out, ev.out.qty); if (left.gt(0)) waiting.push({ out: ev.out, missing: left }); }
  }

  const estimate = (at: number) => {
    const pool = L.filter((l) => l.at <= at);
    const pick = pool.length ? pool.reduce((a, b) => (b.at > a.at || (b.at === a.at && b.layerId > a.layerId) ? b : a)) : L[0];
    return pick ? pick.unitCost : D(0);
  };
  const result = new Map<number, { unitCostOut: Prisma.Decimal; provisional: Prisma.Decimal }>();
  for (const o of outs) {
    const g = got.get(o.ledgerId) ?? { qty: D(0), cost: D(0) };
    const missing = o.qty.minus(g.qty);
    const total = g.cost.plus(missing.gt(0) ? missing.times(estimate(o.at)) : D(0));
    result.set(o.ledgerId, { unitCostOut: total.div(o.qty).toDecimalPlaces(4), provisional: missing });
  }
  return { outs: result, remaining: new Map(L.map((l) => [l.layerId, l.remaining])) };
}

/** So DB (kết quả engine) với mô hình tham chiếu tính từ CÙNG dữ liệu nguồn. */
export async function assertMatchesReference(productId: number, periodId: number): Promise<void> {
  const layers = await prisma.costLayer.findMany({ where: { productId, periodId, costRefType: null } });
  const outRows = await prisma.stockLedger.findMany({ where: { productId, periodId, qtyOut: { gt: 0 } } });
  const ref = referenceFifo(
    layers.map((l) => ({ layerId: l.id, ledgerId: l.ledgerId, at: l.at.getTime(), unitCost: l.unitCost, qtyIn: l.qtyIn })),
    outRows.map((o) => ({ ledgerId: o.id, at: o.at.getTime(), qty: o.qtyOut })),
  );
  for (const o of outRows) {
    const exp = ref.outs.get(o.id)!;
    expect(o.unitCostOut.toString(), `dòng xuất ${o.id} unitCostOut`).toBe(exp.unitCostOut.toString());
    expect(o.qtyProvisional.toString(), `dòng xuất ${o.id} qtyProvisional`).toBe(exp.provisional.toString());
  }
  for (const l of layers) expect(l.qtyRemaining.toString(), `lớp ${l.id} qtyRemaining`).toBe(ref.remaining.get(l.id)!.toString());
}
```
`tests/inventory/property.test.ts`:
```ts
import { beforeEach, describe, it } from "vitest";
import { removeDocument, updateLayerCost } from "@/server/inventory/ports";
import type { EngineCtx } from "@/server/inventory/types";
import { resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, newWorld, sell, T } from "./helpers";
import { assertMatchesReference } from "./reference";

beforeEach(resetDb);

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Doc { kind: "in" | "out"; n: number; qty: number; at: number; cost?: number }

describe("engine == mô hình tham chiếu (property test): chèn lùi thời gian, sửa, hủy, đổi giá lô", () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))("kịch bản ngẫu nhiên #%i", async (seed) => {
    const rnd = mulberry32(seed);
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const w = await newWorld();
    const run = engine(w);
    const pid = w.p.id;
    const docs: Doc[] = [];
    let n = 0;
    const type = (d: Doc) => (d.kind === "in" ? "PURCHASE" : "SALE") as "PURCHASE" | "SALE";
    const post = (ctx: EngineCtx, d: Doc) =>
      d.kind === "in" ? buy(ctx, pid, d.qty, d.cost!, T(d.at), d.n) : sell(ctx, pid, d.qty, T(d.at), d.n);

    for (let step = 0; step < 14; step++) {
      const r = rnd();
      if (docs.length === 0 || r < 0.3) {
        const d: Doc = { kind: "in", n: ++n, qty: int(10, 200), at: int(0, 120), cost: int(1000, 5000) };
        docs.push(d);
        await run([pid], (ctx) => post(ctx, d));
      } else if (r < 0.65) {
        const d: Doc = { kind: "out", n: ++n, qty: int(5, 120), at: int(0, 120) };
        docs.push(d);
        await run([pid], (ctx) => post(ctx, d));
      } else if (r < 0.8) {
        const d = docs[int(0, docs.length - 1)]!;
        await run([pid], async (ctx) => {
          await removeDocument(ctx, type(d), d.n);
          d.qty = int(5, 150);
          await post(ctx, d);
        });
      } else if (r < 0.92) {
        const [d] = docs.splice(int(0, docs.length - 1), 1);
        await run([pid], (ctx) => removeDocument(ctx, type(d!), d!.n));
      } else {
        const ins = docs.filter((x) => x.kind === "in");
        if (ins.length === 0) continue;
        const d = ins[int(0, ins.length - 1)]!;
        d.cost! += 150;
        await run([pid], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: d.n, unitCost: d.cost! }));
      }
      await assertLedgerBalanced(pid, w.periodId);
      await assertMatchesReference(pid, w.periodId);
    }
  }, 120_000);
});
```
Run: `npm test -- tests/inventory/property.test.ts`
Expected: PASS cả 20 kịch bản. **Nếu đỏ: sửa `replay.ts`/`ports.ts` (engine), KHÔNG sửa `reference.ts`** — mô hình tham chiếu cố ý ngây thơ; in ra `seed` và chuỗi thao tác để tái hiện.

- [ ] **Step 4: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "test(inventory): sửa/hủy/khôi phục giữa chuỗi, làm tròn, property test đối chiếu mô hình tham chiếu"
```

---

### Task 7: Giá vốn phụ thuộc chéo — trả hàng, tôn xốp cộng vốn NVL, thành phẩm sản xuất, cước nhập sau

**Files:**
- Test: `tests/inventory/derived.test.ts`

**Interfaces:** dùng `registerCostOwner`, `postReceipt` với `costRef`, `updateLayerCost`. Quy ước cho các plan sau:
- **Trả hàng theo đơn / hàng không giao được** (spec 3.4): `postReceipt({ docType: "RETURN_IN", …, unitCost: <vốn dòng bán gốc>, costRef: { docType: "SALE", docLineId: <dòng bán gốc>, qty: <SL dòng bán gốc> } })`.
- **Bán hàng gia công có BOM** (spec 3.6): mỗi NVL 1 `postIssue({ docType: "SALE", docId: <đơn>, docLineId: <dòng bán>, productId: <NVL>, qty: <định mức × SL> })` — nhiều dòng sổ cùng `docLineId`; chủ dòng nhận `snap.totalCost / SL thành phẩm`.
- **Lệnh SX phụ kiện** (spec 3.6): NVL `postIssue({ docType: "PRODUCTION_USE", docId: <lệnh>, docLineId: <lệnh> })`, thành phẩm `postReceipt({ docType: "PRODUCTION_OUT", docId: <lệnh>, docLineId: <lệnh>, costRef: { docType: "PRODUCTION_USE", docLineId: <lệnh>, qty: <SL thành phẩm> } })`.

- [ ] **Step 1: Test (đỏ → xanh; engine đã có sẵn cơ chế)**

`tests/inventory/derived.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearCostOwners, registerCostOwner, type LineCostSnapshot } from "@/server/inventory/owners";
import { postIssue, postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import { DependentDocumentsError } from "@/server/inventory/errors";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, saleRow, sell, T } from "./helpers";

beforeEach(async () => {
  await resetDb();
  clearCostOwners();
});

describe("trả hàng theo đơn: nhập lại kho đúng giá vốn dòng bán gốc (spec 3.4)", () => {
  async function chainWithSale(w: Awaited<ReturnType<typeof newWorld>>) {
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20000, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 30, T(10), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 22000, T(20), 2));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 90, T(30), 2)); // vốn 20.444,4444
    return run;
  }

  it("trả 10 của dòng bán #2 → lớp mới 10@20.444,4444 (giá vốn CŨ, không phải giá vốn hiện tại)", async () => {
    const w = await newWorld();
    const run = await chainWithSale(w);
    const s2 = await saleRow(2);
    await run([w.p.id], (ctx) => postReceipt(ctx, {
      productId: w.p.id, qty: 10, unitCost: s2.unitCostOut, docType: "RETURN_IN", docId: 1, docLineId: 1, at: T(40),
      costRef: { docType: "SALE", docLineId: 2, qty: 90 },
    }));
    const layers = await layersOf(w.p.id);
    const ret = layers.find((l) => l.sourceDocType === "RETURN_IN")!;
    expect(ret.unitCost.toString()).toBe("20444.4444");
    expect(ret.qtyRemaining.toString()).toBe("10");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("giá vốn dòng bán ĐỔI (do cước nhập thêm vào lô cũ) → lớp trả hàng TỰ cập nhật theo, và đơn bán sau nó tính lại", async () => {
    const w = await newWorld();
    const run = await chainWithSale(w);
    const s2 = await saleRow(2);
    await run([w.p.id], (ctx) => postReceipt(ctx, {
      productId: w.p.id, qty: 10, unitCost: s2.unitCostOut, docType: "RETURN_IN", docId: 1, docLineId: 1, at: T(40),
      costRef: { docType: "SALE", docLineId: 2, qty: 90 },
    }));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(50), 3)); // ăn lớp trả hàng? không: L2 còn 80 → ăn L2

    // Cước 500/md phát sinh thêm cho lô L2 (22.000 → 22.500)
    await run([w.p.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 22500 }));
    // S2 = (70×20.000 + 20×22.500)/90 = 20.555,5556
    expect((await saleRow(2)).unitCostOut.toString()).toBe("20555.5556");
    // lớp trả hàng phụ thuộc S2 → cập nhật theo
    const ret = (await layersOf(w.p.id)).find((l) => l.sourceDocType === "RETURN_IN")!;
    expect(ret.unitCost.toString()).toBe("20555.5556");
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("KHÔNG cho hủy/sửa dòng bán còn có chứng từ trả hàng dựa vào nó", async () => {
    const w = await newWorld();
    const run = await chainWithSale(w);
    await run([w.p.id], (ctx) => postReceipt(ctx, {
      productId: w.p.id, qty: 10, unitCost: 20444.4444, docType: "RETURN_IN", docId: 1, docLineId: 1, at: T(40),
      costRef: { docType: "SALE", docLineId: 2, qty: 90 },
    }));
    await expect(run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 2))).rejects.toThrow(DependentDocumentsError);
    expect((await saleRow(2)).unitCostOut.toFixed(2)).toBe("20444.44"); // không đổi gì
  });
});

describe("tôn xốp: giá vốn dòng bán = TỔNG vốn NVL theo định mức (spec 3.6)", () => {
  it("bán 100 md tôn xốp = xuất tôn cuộn + giấy bạc + POLY (FIFO từng NVL) → chủ dòng nhận tổng vốn; 45.500/md", async () => {
    const w = await newWorld(3);
    const [cuon, giay, poly] = w.products;
    const snaps = new Map<number, LineCostSnapshot>();
    registerCostOwner("SALE", async (_tx, s) => { snaps.set(s.docLineId, s); });
    const run = engine(w);
    await run([cuon!.id, giay!.id, poly!.id], async (ctx) => {
      await buy(ctx, cuon!.id, 200, 30000, T(0), 1);
      await buy(ctx, giay!.id, 500, 2000, T(0), 2);
      await buy(ctx, poly!.id, 300, 25000, T(0), 3);
    });
    // Đơn #9, dòng bán #91: 100 md tôn xốp ⇒ NVL: 120 (tôn cuộn) + 100 (giấy bạc) + 30 (POLY)
    await run([cuon!.id, giay!.id, poly!.id], async (ctx) => {
      for (const [p, q] of [[cuon!, 120], [giay!, 100], [poly!, 30]] as const) {
        await postIssue(ctx, { productId: p.id, qty: q, docType: "SALE", docId: 9, docLineId: 91, at: T(10) });
      }
    });
    const snap = snaps.get(91)!;
    // 120×30.000 + 100×2.000 + 30×25.000 = 3.600.000 + 200.000 + 750.000
    expect(snap.totalCost.toString()).toBe("4550000");
    expect(snap.totalCost.div(100).toString()).toBe("45500");
    expect(snap.qtyProvisional.toString()).toBe("0");
    for (const p of w.products) await assertLedgerBalanced(p.id, w.periodId);
  });

  it("thiếu NVL → dòng bán thành đơn treo (qtyProvisional > 0) và chủ dòng biết", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const snaps = new Map<number, LineCostSnapshot>();
    registerCostOwner("SALE", async (_tx, s) => { snaps.set(s.docLineId, s); });
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => { await buy(ctx, a!.id, 10, 100, T(0), 1); await buy(ctx, b!.id, 2, 50, T(0), 2); });
    await run([a!.id, b!.id], async (ctx) => {
      await postIssue(ctx, { productId: a!.id, qty: 5, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
      await postIssue(ctx, { productId: b!.id, qty: 5, docType: "SALE", docId: 9, docLineId: 91, at: T(5) }); // thiếu 3
    });
    expect(snaps.get(91)!.qtyProvisional.toString()).toBe("3");
  });

  it("giá lô NVL đổi → tổng vốn dòng bán tôn xốp cập nhật (chủ dòng được gọi lại)", async () => {
    const w = await newWorld(2);
    const [a, b] = w.products;
    const snaps = new Map<number, LineCostSnapshot>();
    registerCostOwner("SALE", async (_tx, s) => { snaps.set(s.docLineId, s); });
    const run = engine(w);
    await run([a!.id, b!.id], async (ctx) => { await buy(ctx, a!.id, 100, 100, T(0), 1); await buy(ctx, b!.id, 100, 10, T(0), 2); });
    await run([a!.id, b!.id], async (ctx) => {
      await postIssue(ctx, { productId: a!.id, qty: 10, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
      await postIssue(ctx, { productId: b!.id, qty: 10, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
    });
    expect(snaps.get(91)!.totalCost.toString()).toBe("1100");
    await run([a!.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 120 }));
    expect(snaps.get(91)!.totalCost.toString()).toBe("1300"); // 10×120 + 10×10
  });
});

describe("lệnh sản xuất phụ kiện: giá vốn thành phẩm = tổng vốn NVL / SL (spec 3.6)", () => {
  async function produce(w: Awaited<ReturnType<typeof newWorld>>) {
    const [tonCuon, giay, phuKien] = w.products;
    const run = engine(w);
    await run([tonCuon!.id, giay!.id], async (ctx) => {
      await buy(ctx, tonCuon!.id, 100, 30000, T(0), 1);
      await buy(ctx, giay!.id, 100, 2000, T(0), 2);
    });
    // Lệnh SX #7: dùng 10 tôn cuộn + 20 giấy bạc → 5 phụ kiện
    await run([tonCuon!.id, giay!.id, phuKien!.id], async (ctx) => {
      await postIssue(ctx, { productId: tonCuon!.id, qty: 10, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postIssue(ctx, { productId: giay!.id, qty: 20, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
      await postReceipt(ctx, {
        productId: phuKien!.id, qty: 5, unitCost: 68000, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(10),
        costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 5 },
      });
    });
    return { run, tonCuon: tonCuon!, giay: giay!, phuKien: phuKien! };
  }

  it("lớp thành phẩm có giá vốn = (10×30.000 + 20×2.000)/5 = 68.000; bán 2 phụ kiện → vốn 68.000", async () => {
    const w = await newWorld(3);
    const { run, phuKien } = await produce(w);
    expect((await layersOf(phuKien.id))[0]!.unitCost.toString()).toBe("68000");
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(20), 1));
    expect((await saleRow(1)).unitCostOut.toString()).toBe("68000");
    for (const p of w.products) await assertLedgerBalanced(p.id, w.periodId);
  });

  it("GIÁ NVL ĐỔI (cước nhập thêm) → giá vốn thành phẩm cập nhật → giá vốn đơn bán phụ kiện tính lại (lan truyền chéo 2 mã)", async () => {
    const w = await newWorld(3);
    const { run, tonCuon, phuKien } = await produce(w);
    await run([phuKien.id], (ctx) => sell(ctx, phuKien.id, 2, T(20), 1));
    await run([tonCuon.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 31000 }));
    // thành phẩm: (10×31.000 + 20×2.000)/5 = 70.000
    expect((await layersOf(phuKien.id))[0]!.unitCost.toString()).toBe("70000");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("70000");
    for (const p of w.products) await assertLedgerBalanced(p.id, w.periodId);
  });

  it("hủy lệnh SX: phải hủy THÀNH PHẨM trước rồi mới hủy dòng dùng NVL; hủy sai thứ tự bị chặn", async () => {
    const w = await newWorld(3);
    const { run, tonCuon, giay, phuKien } = await produce(w);
    const all = [tonCuon.id, giay.id, phuKien.id];
    await expect(run(all, (ctx) => removeDocument(ctx, "PRODUCTION_USE", 7))).rejects.toThrow(DependentDocumentsError);
    await run(all, async (ctx) => {
      await removeDocument(ctx, "PRODUCTION_OUT", 7);
      await removeDocument(ctx, "PRODUCTION_USE", 7);
    });
    expect(await prisma.costLayer.count({ where: { productId: phuKien.id } })).toBe(0);
    expect((await layersOf(tonCuon.id))[0]!.qtyRemaining.toString()).toBe("100");
    expect((await layersOf(giay.id))[0]!.qtyRemaining.toString()).toBe("100");
    for (const p of w.products) await assertLedgerBalanced(p.id, w.periodId);
  });
});

- [ ] **Step 2: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "test(inventory): giá vốn phụ thuộc chéo — trả hàng, tôn xốp NVL, thành phẩm SX, lan truyền khi đổi giá lô"
```

---

### Task 8: Trả NCC, tính lại chạy nền (chặn xuất mã đang tính lại)

**Files:**
- Create: `src/server/inventory/recompute.ts`, `src/instrumentation.ts`
- Modify: `src/server/inventory/unit-of-work.ts` (thay 2 hàm giữ chỗ bằng import từ `./recompute`)
- Test: `tests/inventory/supplier-return.test.ts`, `tests/inventory/recompute.test.ts`

**Interfaces:**
- Produces: `deferRecompute(ctx, productId, fromAt)`, `mergeRecomputeJob(ctx, productId, fromAt)`, `runRecomputeJobs(prisma): Promise<number>`, `resetStuckJobs(prisma)`, `kickRecomputeWorker(prisma?)`, `SYSTEM_USER_ID = 0`.

- [ ] **Step 1: Test trả NCC (spec 3.4) — xanh ngay vì là 1 lệnh xuất bình thường**

`tests/inventory/supplier-return.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { postIssue } from "@/server/inventory/ports";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, layersOf, newWorld, T } from "./helpers";

beforeEach(resetDb);

describe("trả NCC: xuất kho theo FIFO như bán (spec 3.4)", () => {
  it("trả 40 cho NCC: ăn lớp cũ nhất; giá vốn xuất là FIFO (công nợ phải trả giảm theo giá thoả thuận do module trả hàng quyết định)", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 100, T(0), 1));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 30, 130, T(1), 2));
    await run([w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 40, docType: "RETURN_SUPPLIER", docId: 1, docLineId: 1, at: T(5) }));
    const row = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "RETURN_SUPPLIER" } });
    expect(row.unitCostOut.toString()).toBe("107.5"); // (30×100 + 10×130)/40
    const [l1, l2] = await layersOf(w.p.id);
    expect([l1!.qtyRemaining.toString(), l2!.qtyRemaining.toString()]).toEqual(["0", "20"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});
```
Run: `npm test -- tests/inventory/supplier-return.test.ts` → PASS.

- [ ] **Step 2: Test tính lại chạy nền (đỏ)**

`tests/inventory/recompute.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { ProductRecomputingError } from "@/server/inventory/errors";
import { removeDocument } from "@/server/inventory/ports";
import { resetStuckJobs, runRecomputeJobs } from "@/server/inventory/recompute";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced } from "./helpers";
import { assertMatchesReference } from "./reference";
import { buy, engine, newWorld, saleRow, sell, T } from "./helpers";

beforeEach(resetDb);

/** 6 đơn bán liên tiếp trên tồn lớn. Với inlineLimit = 3, sửa đơn ĐẦU sẽ chạm > 3 sự kiện. */
async function bigChain() {
  const w = await newWorld();
  const run = engine(w);
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 100, T(0), 1));
  for (let i = 1; i <= 6; i++) await run([w.p.id], (ctx) => sell(ctx, w.p.id, 10, T(i * 10), i), { inlineLimit: 100 });
  await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1000, 200, T(80), 2));
  return { w, run };
}

describe("tính lại quá ngưỡng → chạy nền (spec 3.5)", () => {
  it("vượt ngưỡng: mã hàng bị đánh dấu 'đang tính lại', có job; chặn XUẤT mã đó; worker tính xong thì mở lại", async () => {
    const { w, run } = await bigChain();
    // Hủy đơn #1 (đầu chuỗi) → chạm 6 sự kiện > ngưỡng 3
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });

    const p = await prisma.product.findUniqueOrThrow({ where: { id: w.p.id } });
    expect(p.recomputing).toBe(true);
    const job = await prisma.recomputeJob.findUniqueOrThrow({ where: { productId: w.p.id } });
    expect(job.status).toBe("PENDING");
    expect(job.fromAt).toEqual(T(10));

    await expect(run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, T(100), 99))).rejects.toThrow(ProductRecomputingError);

    expect(await runRecomputeJobs(prisma)).toBe(1);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: w.p.id } });
    expect(after.recomputing).toBe(false);
    expect(await prisma.recomputeJob.count()).toBe(0);
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertMatchesReference(w.p.id, w.periodId);
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 1, T(100), 99)); // mở lại được
  });

  it("thay đổi thứ hai trong lúc chờ → GỘP job (mốc sớm nhất), không tạo job thứ 2", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 3), { inlineLimit: 3 }); // T30
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 2), { inlineLimit: 3 }); // T20 sớm hơn
    expect(await prisma.recomputeJob.count()).toBe(1);
    expect((await prisma.recomputeJob.findUniqueOrThrow({ where: { productId: w.p.id } })).fromAt).toEqual(T(20));
    await runRecomputeJobs(prisma);
    await assertMatchesReference(w.p.id, w.periodId);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("dưới ngưỡng → tính đồng bộ, KHÔNG tạo job", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 6), { inlineLimit: 100 });
    expect(await prisma.recomputeJob.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: w.p.id } })).recomputing).toBe(false);
  });

  it("kết quả tính nền GIỐNG HỆT tính đồng bộ", async () => {
    const a = await bigChain();
    await a.run([a.w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });
    await runRecomputeJobs(prisma);
    const bg = (await prisma.stockLedger.findMany({ where: { docType: "SALE" }, orderBy: { docId: "asc" } })).map((r) => [r.docId, r.unitCostOut.toString(), r.qtyProvisional.toString()]);

    await resetDb();
    const b = await bigChain();
    await b.run([b.w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 100 });
    const sync = (await prisma.stockLedger.findMany({ where: { docType: "SALE" }, orderBy: { docId: "asc" } })).map((r) => [r.docId, r.unitCostOut.toString(), r.qtyProvisional.toString()]);
    expect(bg).toEqual(sync);
  });

  it("resetStuckJobs: job RUNNING bị kẹt (app sập giữa chừng) quay về PENDING", async () => {
    const { w } = await bigChain();
    await prisma.recomputeJob.create({ data: { periodId: w.periodId, productId: w.p.id, fromAt: T(10), status: "RUNNING" } });
    await resetStuckJobs(prisma);
    expect((await prisma.recomputeJob.findUniqueOrThrow({ where: { productId: w.p.id } })).status).toBe("PENDING");
  });

  it("đơn bán đang treo kết quả vẫn đọc được (giá cũ) trong lúc chờ worker, và saleRow không vỡ", async () => {
    const { w, run } = await bigChain();
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 3 });
    expect((await saleRow(2)).unitCostOut.toString()).toBe("100");
  });
});
```
- [ ] **Step 3: Cài `recompute.ts` và nối vào `unit-of-work.ts`**

`src/server/inventory/recompute.ts`:
```ts
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { markDirty, withInventoryTx } from "./unit-of-work";
import type { EngineCtx } from "./types";

/** Người dùng "hệ thống" khi worker nền chạy (createdBy không FK). */
export const SYSTEM_USER_ID = 0;

/** Đánh dấu mã hàng 'đang tính lại' + tạo/gộp job; đánh thức worker sau commit. Cờ này CHẶN xuất mã hàng đó. */
export async function deferRecompute(ctx: EngineCtx, productId: number, fromAt: Date): Promise<void> {
  await ctx.tx.product.update({ where: { id: productId }, data: { recomputing: true } });
  await mergeRecomputeJob(ctx, productId, fromAt);
  ctx.afterCommit.push(() => kickRecomputeWorker());
}

export async function mergeRecomputeJob(ctx: EngineCtx, productId: number, fromAt: Date): Promise<void> {
  const existing = await ctx.tx.recomputeJob.findUnique({ where: { productId } });
  if (!existing) {
    await ctx.tx.recomputeJob.create({ data: { periodId: ctx.period.id, productId, fromAt } });
    return;
  }
  await ctx.tx.recomputeJob.update({
    where: { productId },
    data: { fromAt: fromAt < existing.fromAt ? fromAt : existing.fromAt, status: existing.status === "FAILED" ? "FAILED" : "PENDING" },
  });
}

/** Sau khi app khởi động lại: job đang RUNNING mà không còn tiến trình nào chạy → quay về PENDING. */
export async function resetStuckJobs(db: PrismaClient): Promise<void> {
  await db.recomputeJob.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING" } });
}

/**
 * Xử lý hết job PENDING (mỗi job = 1 transaction giữ khoá mã hàng, không giới hạn ngưỡng).
 * Job lỗi → FAILED + giữ cờ recomputing (chặn xuất) để người vận hành xử lý, không nuốt lỗi.
 */
export async function runRecomputeJobs(db: PrismaClient): Promise<number> {
  let done = 0;
  for (;;) {
    const claimed = await db.$queryRaw<{ id: number; periodId: number; productId: number; fromAt: Date }[]>`
      UPDATE recompute_jobs
         SET status = 'RUNNING', attempts = attempts + 1, "updatedAt" = now()
       WHERE id = (SELECT id FROM recompute_jobs WHERE status = 'PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, "periodId", "productId", "fromAt"`;
    const job = claimed[0];
    if (!job) return done;
    try {
      await withInventoryTx(
        db,
        {
          periodId: job.periodId, userId: SYSTEM_USER_ID, products: [job.productId], mode: "worker",
          finalize: async (ctx) => {
            await ctx.tx.product.update({ where: { id: job.productId }, data: { recomputing: false } });
            await ctx.tx.recomputeJob.delete({ where: { id: job.id } });
          },
        },
        async (ctx) => markDirty(ctx, job.productId, job.fromAt),
      );
      done++;
    } catch (e) {
      console.error("[recompute] job lỗi", job, e);
      await db.recomputeJob.update({ where: { id: job.id }, data: { status: "FAILED", error: String(e instanceof Error ? e.message : e).slice(0, 500) } });
    }
  }
}

let running = false;
/** Đánh thức worker (không chạy chồng). Gọi sau commit và khi app khởi động. */
export function kickRecomputeWorker(db: PrismaClient = defaultPrisma): void {
  if (process.env.RECOMPUTE_WORKER === "off") return; // test: tự gọi runRecomputeJobs để kiểm soát thời điểm
  if (running) return;
  running = true;
  setImmediate(() => {
    runRecomputeJobs(db)
      .catch((e) => console.error("[recompute]", e))
      .finally(() => { running = false; });
  });
}
```
Trong `unit-of-work.ts`: XOÁ 2 hàm giữ chỗ `deferRecompute` / `mergeRecomputeJob` (Task 4) và thêm `import { deferRecompute, mergeRecomputeJob } from "./recompute";`. `recompute.ts` cũng import `withInventoryTx` từ `unit-of-work` → vòng import; xử lý bằng import động: trong `unit-of-work.ts` đổi thành
```ts
async function deferRecompute(ctx: EngineCtx, productId: number, fromAt: Date) {
  return (await import("./recompute")).deferRecompute(ctx, productId, fromAt);
}
async function mergeRecomputeJob(ctx: EngineCtx, productId: number, fromAt: Date) {
  return (await import("./recompute")).mergeRecomputeJob(ctx, productId, fromAt);
}
```
`src/instrumentation.ts` (Next 15 tự gọi 1 lần khi server khởi động):
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { prisma } = await import("@/lib/prisma");
  const { resetStuckJobs, kickRecomputeWorker } = await import("@/server/inventory");
  await resetStuckJobs(prisma);
  kickRecomputeWorker(prisma);
}
```
Thêm vào `.env.test` một dòng để worker nền KHÔNG tự chạy trong test (test chủ động gọi `runRecomputeJobs`, tránh race):
```bash
RECOMPUTE_WORKER=off
```
Run: `npm test -- tests/inventory/recompute.test.ts tests/inventory/supplier-return.test.ts`
Expected: PASS. Nếu test "chặn XUẤT" đỏ vì `postIssue` không kiểm cờ trong `mode: "inline"` → xem `ports.ts` (đã kiểm `recomputing` khi `ctx.mode === "inline"`).

- [ ] **Step 4: Commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(inventory): tính lại chạy nền khi quá ngưỡng, chặn xuất mã đang tính lại, worker + khởi động lại an toàn"
```

---

### Task 9: Barrel API, hiệu năng, tài liệu đối chiếu spec 3.7

**Files:**
- Create: `src/server/inventory/index.ts`, `docs/engine-fifo.md`
- Test: `tests/inventory/performance.test.ts`, `tests/inventory/barrel.test.ts`

- [ ] **Step 1: Barrel — API duy nhất các plan sau được import**

`src/server/inventory/index.ts`:
```ts
export { docTimestamp } from "./time";
export { getOnHand, estimateCost } from "./queries";
export { postReceipt, postIssue, removeDocument, updateLayerCost, productsOfDocument } from "./ports";
export type { ReceiptInput, IssueInput } from "./ports";
export { withInventoryTx, beginEngine, flush, markDirty } from "./unit-of-work";
export type { EngineOptions, WithInventoryOptions } from "./unit-of-work";
export { registerCostOwner } from "./owners";
export type { CostOwner, LineCostSnapshot } from "./owners";
export { runRecomputeJobs, resetStuckJobs, kickRecomputeWorker } from "./recompute";
export {
  PeriodClosedError, DocDateBeforePeriodError, InvalidQuantityError, InvalidCostError, InvalidDocDateError,
  ProductRecomputingError, DependentDocumentsError,
} from "./errors";
export type { EngineCtx, InDocType, OutDocType } from "./types";
```
`tests/inventory/barrel.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import * as inventory from "@/server/inventory";

describe("API công khai của engine (các plan sau CHỈ import từ đây)", () => {
  it("xuất đúng bộ hàm đã cam kết", () => {
    for (const name of [
      "docTimestamp", "getOnHand", "estimateCost", "postReceipt", "postIssue", "removeDocument", "updateLayerCost",
      "productsOfDocument", "withInventoryTx", "beginEngine", "flush", "markDirty", "registerCostOwner",
      "runRecomputeJobs", "resetStuckJobs", "kickRecomputeWorker",
      "PeriodClosedError", "DocDateBeforePeriodError", "InvalidQuantityError", "ProductRecomputingError", "DependentDocumentsError",
    ]) {
      expect(inventory, name).toHaveProperty(name);
    }
  });
});
```
- [ ] **Step 2: Test hiệu năng (spec: hiệu năng là hợp đồng; ngưỡng chạy nền ~2.000 dòng)**

`tests/inventory/performance.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { assertLedgerBalanced, buy, engine, newWorld, sell, T } from "./helpers";
import { assertMatchesReference } from "./reference";

beforeEach(resetDb);

describe("hiệu năng engine", () => {
  it("bán ở ĐUÔI trên mã hàng đã có 2.000 dòng bán: ≤ 500 ms", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1_000_000, 100, T(0), 1));
    // nạp nhanh 2.000 dòng xuất THÔ rồi để engine tính 1 lần (giới hạn 5.000 để không rơi vào chạy nền)
    await prisma.$executeRawUnsafe(`
      INSERT INTO stock_ledger ("periodId","productId","docType","docId","docLineId","qtyIn","qtyOut","unitCostOut","qtyProvisional","at","createdBy")
      SELECT ${w.periodId}, ${w.p.id}, 'SALE'::stock_doc_type, g + 1000, g + 1000, 0, 5, 0, 0, TIMESTAMPTZ '2026-09-01 00:00:00+00' + (g || ' minutes')::interval, ${w.userId}
      FROM generate_series(1, 2000) g`);
    const t0 = performance.now();
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)), { inlineLimit: 5000 });
    const full = performance.now() - t0;
    expect(full, `replay đầy đủ 2.000 dòng: ${Math.round(full)}ms`).toBeLessThan(3000); // hợp đồng ≤ 3 giây
    await assertLedgerBalanced(w.p.id, w.periodId);
    await assertMatchesReference(w.p.id, w.periodId);

    const t1 = performance.now();
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(5000), 1));
    const tail = performance.now() - t1;
    expect(tail, `bán ở đuôi: ${Math.round(tail)}ms`).toBeLessThan(500);
  }, 60_000);

  it("sửa đơn ở ĐẦU chuỗi 500 dòng: ≤ 3 giây", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 1_000_000, 100, T(0), 1));
    await prisma.$executeRawUnsafe(`
      INSERT INTO stock_ledger ("periodId","productId","docType","docId","docLineId","qtyIn","qtyOut","unitCostOut","qtyProvisional","at","createdBy")
      SELECT ${w.periodId}, ${w.p.id}, 'SALE'::stock_doc_type, g + 1000, g + 1000, 0, 5, 0, 0, TIMESTAMPTZ '2026-09-01 00:00:00+00' + (g || ' minutes')::interval, ${w.userId}
      FROM generate_series(1, 500) g`);
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(0)));
    const t = performance.now();
    await run([w.p.id], async (ctx) => markDirty(ctx, w.p.id, T(1)));
    expect(performance.now() - t).toBeLessThan(3000);
  }, 60_000);
});
```
Run: `npm test -- tests/inventory/performance.test.ts tests/inventory/barrel.test.ts`
Expected: PASS. Nếu replay 2.000 dòng > 3 giây: profile `replayProduct` (thường do `tx.costLayer.update` từng dòng hoặc `estimateCost` gọi lặp) và tối ưu (gom `UPDATE … FROM (VALUES …)`); KHÔNG nới ngưỡng và KHÔNG hạ `DEFAULT_INLINE_LIMIT` để né.

- [ ] **Step 3: Tài liệu đối chiếu spec 3.7 — `docs/engine-fifo.md`**

```markdown
# Engine kho FIFO — đối chiếu spec 3.7

Nguồn: `src/server/inventory/`. API công khai: `src/server/inventory/index.ts` (các module khác CHỈ import từ đây).

| # | Case bắt buộc (spec 3.7) | Test | Trạng thái |
|---|---|---|---|
| 1 | Nhập–bán 1 lớp | `basic.test.ts` › "nhập 100@20.000 rồi bán 30" | ✔ |
| 2 | Bán xuyên nhiều lớp (case 3.2, 20.444,44) | `basic.test.ts` › "TEST CHUẨN CỦA KHÁCH" | ✔ |
| 3 | Bán âm rồi nhập bù | `provisional.test.ts` | ✔ |
| 4 | 2 người bán cùng mã đồng thời | `concurrency.test.ts` | ✔ |
| 5 | Trả theo đơn đúng giá vốn cũ | `derived.test.ts` › "trả hàng theo đơn" | ✔ (engine) — module trả hàng: plan 04-C6 |
| 6 | Trả theo SP không có đơn | — | ⏳ plan 04-C6 (`resolveReturnCostByProduct` cần bảng đơn bán) |
| 7 | Trả NCC | `supplier-return.test.ts` | ✔ (engine) — công nợ: plan 04-C6 |
| 8 | Sửa đơn giữa chuỗi | `edit.test.ts` | ✔ |
| 9 | Hủy đơn giữa chuỗi | `edit.test.ts` | ✔ |
| 10 | Khôi phục đơn đã hủy | `edit.test.ts` | ✔ |
| 11 | Cước nhập sau phiếu hàng | `derived.test.ts` (cước 22.000→22.500) + `property.test.ts` | ✔ |
| 12 | Tôn xốp cộng vốn NVL | `derived.test.ts` › "tôn xốp" | ✔ (engine) — BOM: plan 03-B6 |
| 13 | Gia công thuê tôn xốp không trừ tôn cuộn | — | ⏳ plan 06-E3 (quyết định nghiệp vụ, engine chỉ nhận đúng dòng được yêu cầu xuất) |
| 14 | Lệnh SX phụ kiện | `derived.test.ts` › "lệnh sản xuất phụ kiện" | ✔ (engine) |
| 15 | Hủy đơn có chiết khấu tích lũy | — | ⏳ plan 05-D3 |
| 16 | Kết sổ mang lô sang kỳ mới | — | ⏳ plan 07-F1 (engine cung cấp `postReceipt({docType:"OPENING"})`) |
| + | Engine == mô hình tham chiếu (20 kịch bản ngẫu nhiên) | `property.test.ts` | ✔ |
| + | Tính lại chạy nền, chặn xuất mã đang tính lại | `recompute.test.ts` | ✔ |

## Cách dùng (tóm tắt)
Xem "Quy ước gọi engine" ở đầu plan `2026-09-24-02-gd1a-fifo-engine.md`. Điều bắt buộc với module nghiệp vụ:
1. Luôn gọi qua `withInventoryTx` (transaction + khoá + tính lại chuỗi + audit cùng transaction).
2. Sửa chứng từ = `removeDocument` rồi đăng lại **cùng `at`**; khôi phục = đăng lại tại `at` gốc.
3. `products` phải liệt kê đủ mã hàng (dùng `productsOfDocument` cho sửa/hủy).
4. Đăng ký `registerCostOwner("SALE", …)` để ghi `unit_cost_fifo`/`is_provisional` ngược vào dòng đơn.
5. Bắt `ProductRecomputingError` → báo người dùng "mã hàng đang tính lại giá vốn".
```

- [ ] **Step 4: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: xanh toàn bộ (kể cả plan 01a–01c).
```bash
git add -A
git commit -m "feat(inventory): barrel API, test hiệu năng, tài liệu đối chiếu spec 3.7"
git tag gd1a
```

---

## Self-Review (GĐ1a — Engine FIFO)

**Spec coverage (Phần 3):** 3.0 khoá đồng thời (Task 1, 5) ✔ · 3.1 nhập tạo lớp + cước phân bổ (`updateLayerCost` Task 3/7; **phân bổ cước theo giá trị là việc của module nhập hàng plan 03-B4**, engine nhận đơn giá đã phân bổ) ✔ · 3.2 xuất FIFO nhiều lớp + ví dụ chuẩn (Task 4) ✔ · 3.3 bán âm/đơn treo/nhập bù (Task 5) ✔ · 3.4 trả hàng (Task 7 phần engine; giá trả theo SP/NCC là plan 04) ✔ · 3.5 sửa/hủy/khôi phục, chạm >2.000 → nền, kỳ khoá cứng (Task 3, 6, 8) ✔ · 3.6 tôn xốp/SX (Task 7) ✔ · 3.7 bộ test (Task 4–9, bảng đối chiếu) ✔ · 4.4 quy tắc xuyên kỳ (engine chỉ làm việc trong kỳ mở; lớp mang sang kỳ mới là plan 07) ✔.
**Placeholder scan:** hai hàm giữ chỗ ở Task 4 Step 5 là code THẬT ném lỗi rõ ràng cho tới khi Task 8 thay bằng bản đầy đủ (ghi rõ trong bước) — không phải "TBD". Không còn "TODO/implement later".
**Type consistency:** `EngineCtx.period {id, openedAt}` dùng nhất quán ở `beginEngine`, `postReceipt/Issue`, `replay` (`ctx.period.id`); `TouchedLine` xuất từ `replay.ts` và dùng ở `unit-of-work.ts`; `LineCostSnapshot.totalCost/qtyProvisional: Dec`; `WithInventoryOptions extends EngineOptions`; `engine(w)` trong `helpers.ts` nhận `(products, work, extra)` — `extra` (vd `{ inlineLimit }`) trải vào `withInventoryTx` options.
**Review Focus:** cân sổ mọi test (Task 1 helper + gọi ở mọi test) ✔; lô 3 md/333,333 md ≤1đ (Task 6 rounding) ✔; kỳ đã kết sổ/ngày trước kỳ (Task 3) ✔; đồng thời không ăn trùng/không deadlock (Task 5) ✔; engine == mô hình tham chiếu ngẫu nhiên gồm chèn lùi/sửa/hủy/đổi giá (Task 6) ✔.
**Điểm cần người duyệt (không phải placeholder):** (1) D-4 xuất kho lúc xác nhận đơn; (2) giá tạm của đơn treo = giá nhập gần nhất tại thời điểm xuất (spec 3.3) — khi chưa có lớp nào thì 0 và đơn bị cờ "treo, chưa tính lãi"; (3) hủy phiếu nhập đã bị bán → các đơn thành đơn treo (không chặn) — nếu khách muốn chặn thì thêm kiểm ở module nhập hàng, không đổi engine.
