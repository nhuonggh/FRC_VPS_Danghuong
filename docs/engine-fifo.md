# Engine kho FIFO — API, thứ tự sự kiện, giả định, đối chiếu spec 3.7

Nguồn: `src/server/inventory/`. **API công khai duy nhất: `src/server/inventory/index.ts`** (`import … from
"@/server/inventory"`) — module nghiệp vụ (plan 03+) KHÔNG import file con. Danh sách xuất được ghim bởi
`tests/inventory/barrel.test.ts`.

> Ghi chú cho người đọc plan `docs/superpowers/plans/2026-09-24-02-gd1a-fifo-engine.md`: các dòng ~1250 / ~1482 / ~2162
> của plan viết "cùng thời điểm: nhập trước xuất" và "(at, id)". Thứ tự **thực tế** của engine khác — xem mục 1 (quyết
> định ở các vòng review Task 4). Mã nguồn: `src/server/inventory/replay.ts` (`order`, `eventClass`, `cmpSeq`). Barrel ở
> Task 9 của plan cũng đã đổi so với bản trong plan — xem mục 0.

## 0. API công khai (`@/server/inventory`)

| Nhóm | Xuất | Ghi chú |
|---|---|---|
| Thời điểm | `docTimestamp` | Chỉ cho chứng từ MỚI hoặc khi ĐỔI NGÀY (mục 8, giả định 4) |
| Đọc | `getOnHand`, `estimateCost` | `estimateCost` chỉ xét lớp của **một kỳ** (giả định 5) |
| Giao dịch | `withInventoryTx` (+ kiểu `EngineOptions`, `WithInventoryOptions`, `EngineCtx`) | Cách DUY NHẤT đụng vào kho |
| Cổng ghi | `postReceipt`, `postIssue` (nhận `seq?`, TRẢ `seq`), `removeDocument` (trả `seqs`), `updateLayerCost`, `productsOfDocument` (+ `ReceiptInput`, `IssueInput`) | |
| Chủ dòng | `registerCostOwner`, `unitCostOf` (+ `CostOwner`, `LineCostSnapshot`) | |
| Tính lại nền | `bootRecomputeWorker` (instrumentation), `stopRecomputeTimers` + `recomputeWorkerIdle` (tắt êm), `retryFailedJob` (người vận hành), `kickRecomputeWorker`, `runRecomputeJobs` | |
| Lỗi nghiệp vụ (`DomainError`, 4xx) | `PeriodClosedError`, `DocDateBeforePeriodError`, `InvalidQuantityError`, `InvalidCostError`, `InvalidCostRefError`, `InvalidCostRefTypeError`, `InvalidDocDateError`, `DerivedLayerCostError`, `DerivedLayerDateError`, `DerivedLayerOrderError`, `DependentDocumentsError`, `ProductRecomputingError`, `EngineBusyError` | |
| Lỗi lập trình (500) | `EngineInvariantError`, `ProductNotLockedError` | Để `instanceof` / log |
| Hằng + kiểu | `IN_DOC_TYPES`, `OUT_DOC_TYPES`, `InDocType`, `OutDocType`, `Tx`, `Dec`, `DecInput` | |

**Cố ý KHÔNG xuất** (khác bản barrel trong plan): `beginEngine`, `flush`, `markDirty` — gọi thẳng sẽ bỏ qua thử lại
deadlock, chặn lồng giao dịch, `finalize`/`afterCommit` của `withInventoryTx`; `resetStuckJobs` — `bootRecomputeWorker`
đã gọi; cùng mọi phần nội bộ: `replayProduct`, lan truyền (`propagate`, `lineSnapshot(s)`), khoá advisory, bảng job
(`recompute-jobs.ts`), bước worker cấp thấp (`runRecomputePass`, quét…), `isTransientError`, `engineTimeouts`,
`ReplayTooLargeError`, `clearCostOwners` (chỉ cho test).

**Tóm tắt điều bắt buộc với module nghiệp vụ:**
1. Mọi ghi kho qua `withInventoryTx({ userId, products, … }, async (ctx) => …)` — transaction + khoá mã (tăng dần) +
   tính lại chuỗi + đồng bộ giá vốn về chủ dòng trong CÙNG transaction. `work` KHÔNG có tác dụng phụ ngoài `ctx.tx`
   (có thể bị chạy lại khi deadlock — mục 5).
2. `products` liệt kê ĐỦ mã sẽ chạm (dùng `productsOfDocument` cho sửa/hủy; thêm mã của dòng gốc khi ghi lớp có `costRef`).
3. Mỗi dòng chứng từ lưu `at` + `seq` (mục 3). Sửa = `removeDocument` + ghi lại trong CÙNG giao dịch, truyền lại `at` đã
   lưu; khôi phục = ghi lại với `at` + `seq` đã lưu.
4. Đăng ký `registerCostOwner("SALE", …)` (và các loại xuất khác cần) để nhận `unit_cost_fifo` / cờ treo của dòng.
5. Bắt lỗi nghiệp vụ như mọi `DomainError` (vd `ProductRecomputingError` → "mã hàng đang tính lại giá vốn",
   `EngineBusyError` → "kho đang bận, thử lại").

## 1. Thứ tự sự kiện

Mỗi mã hàng được mô phỏng theo khoá **(at, hạng, seq)**:

| Hạng | Sự kiện |
|---|---|
| 0 | Lớp nhập **thường** (mua, đầu kỳ, điều chỉnh/kiểm kho tăng… — `costRefType` rỗng) |
| 1 | **Lệnh xuất** (bán, dùng NVL, hao hụt, trả NCC…) **và lớp phụ thuộc** (trả hàng `RETURN_IN`, thành phẩm `PRODUCTION_OUT` — có `costRef`) |

Trong cùng hạng: **`stock_ledger.seq`** — số thứ tự ghi sổ **ổn định** (lớp dùng seq của dòng sổ nhập 1–1 của nó).
`seq` do DB cấp tăng dần khi ghi mới, và **được giữ nguyên qua sửa / hủy-khôi phục** (xem mục 3). KHÔNG dùng `id` dòng
sổ để sắp: sửa = xoá + ghi lại sinh id mới.

Hệ quả tại **cùng `at`** (vd chứng từ lùi ngày: `docTimestamp` cho mọi chứng từ của cùng một ngày quá khứ cùng
23:59:59.999 ICT):
- lớp nhập thường luôn dùng được cho mọi lệnh xuất cùng `at`;
- lệnh xuất ghi **sau** lệnh SX / trả hàng cùng `at` ăn được thành phẩm / hàng trả;
- lệnh xuất ghi **trước** thì không (và nếu thiếu hàng sẽ treo — xem 2.2);
- "ghi trước/sau" nghĩa là theo `seq` — sửa chứng từ KHÔNG đổi vị trí.

## 2. Quy tắc tính giá (chi tiết kỹ thuật — các mục ⚠ được gom lại cho khách ở mục 8)

1. **Lớp phụ thuộc** có giá = `round4(Σ qtyOut × unit_cost_out của dòng gốc / costRefQty)`, do engine quản (không sửa
   tay — `updateLayerCost` từ chối; giá người gọi truyền chỉ dùng khi dòng gốc chưa có dòng sổ). `costRef` phải trỏ
   chứng từ **xuất**.
2. ⚠ **Lớp phụ thuộc KHÔNG BAO GIỜ nhập bù đơn treo** (bán âm kho). Đơn treo chỉ được lớp nhập **thường** nuốt.
   Hệ quả: **hàng khách trả và thành phẩm sản xuất không lấp đơn bán âm kho trước đó** — chúng là tồn cho đơn xuất xếp
   sau. Quy trình "bán phụ kiện trước, sản xuất sau" để lại đơn treo tới khi có nhập thường / điều chỉnh kho (kết sổ
   bị chặn khi còn đơn treo — spec 4.2).
3. Lớp phụ thuộc phải **đứng sau dòng gốc**: `at` không trước dòng gốc (`DerivedLayerDateError`) và `seq` lớn hơn mọi
   dòng sổ của dòng gốc (`DerivedLayerOrderError`). Nhờ (1)–(3), mục 1 và `seq` ổn định qua sửa, đồ thị phụ thuộc giá
   là DAG → tính lại hội tụ, và **kết quả chỉ phụ thuộc dữ liệu cuối (at, seq, SL, giá…), không phụ thuộc lịch sử
   sửa/hủy/khôi phục** — miễn là người gọi giữ `at` và `seq` như mục 3.
4. ⚠ Tại cùng `at`, **thứ tự ghi (seq)** quyết định lệnh xuất nào dùng được thành phẩm/hàng trả (kể cả hai lệnh SX dùng
   thành phẩm của nhau cùng ngày: lệnh ghi trước không dùng được thành phẩm của lệnh ghi sau).
5. Giá tạm phần treo = giá lớp **thường** gần nhất có `at ≤` thời điểm xuất → lớp thường đầu tiên → 0. "Gần nhất" /
   "đầu tiên" xét theo **thứ tự sự kiện `(at, seq)`** của dòng sổ nhập — KHÔNG theo id lớp (sửa/khôi phục phiếu nhập cấp
   id lớp mới nhưng giữ `at` + `seq`), nên giá tạm của đơn treo cũng không phụ thuộc lịch sử sửa. Ví dụ: A 1@100 rồi
   B 1@200 cùng `at`, bán 5 → 3 treo @200 → giá 180; sửa A vẫn 180. Giá tạm chỉ tồn tại tới khi có nhập thường bù
   (khi đó giá vốn được tính lại theo lớp thật). Chỉ xét lớp của **kỳ đang tính** (giả định 5 ở mục 8). Replay dùng
   `estimateFromPlainLayers` (nạp lớp thường 1 lần) — cùng quy tắc với `estimateCost`, ghim bởi `queries.test.ts`.
6. Mọi giá vốn đơn vị làm tròn HALF_UP 4 chữ số **một lần**, từ số học 80 chữ số (không float).
7. Lưới an toàn flush: mỗi mã tối đa `min(50 + 2 × số lớp phụ thuộc của mã, 500)` lần tính lại/giao dịch, và ngân
   sách thời gian `flushBudgetMs` theo chế độ (`engineTimeouts`): đồng bộ 25 giây < timeout transaction 30 giây; worker
   nền 570 giây < timeout transaction worker 600 giây. Bất biến `flushBudgetMs + 5 s ≤ txTimeoutMs` (vi phạm ⇒
   `EngineInvariantError` trước khi mở transaction).

## 3. Hợp đồng cho module nghiệp vụ (plan 03+): mỗi dòng chứng từ lưu `at` + `seq`

- `postReceipt` / `postIssue` trả `seq` đã gán. Module **PHẢI lưu `seq` cùng dòng chứng từ, như `at`**.
- **Sửa** chứng từ = `removeDocument` + ghi lại **trong CÙNG `withInventoryTx`**: engine tự dùng lại `seq` của dòng vừa
  xoá cùng khoá **(docType, docId, docLineId, productId)** — không phải truyền gì (vẫn phải truyền lại `at` đã lưu).
  Hệ quả của khoá này: dòng **mới thêm** khi sửa, dòng **đổi mã hàng**, hoặc dòng **đổi loại chứng từ** (vd dòng xuất
  → nhập, `docType` khác) KHÔNG có seq cũ để dùng lại → nhận seq mới, **xếp cuối trong `at` của nó** (sau mọi dòng cùng
  `at` đã có). Vị trí chỉ được giữ theo từng khoá dòng.
- **Khôi phục** chứng từ đã hủy (giao dịch khác): truyền lại `at` **và** `seq` đã lưu (`seq` input). Không truyền →
  nhận seq mới (xếp sau mọi dòng đã có) → có thể đổi kết quả FIFO của các chứng từ cùng `at`.
- `seq` truyền vào đang có dòng dùng, hoặc **chưa từng được cấp** (lớn hơn giá trị lớn nhất sequence
  `stock_ledger_seq_seq` đã cấp, hay < 1) ⇒ `EngineInvariantError` (không ghi gì). Seq tự dùng lại (sửa trong cùng giao
  dịch) mà đã bị lời gọi khác trong giao dịch chiếm ⇒ cũng `EngineInvariantError` (không phải lỗi UNIQUE thô). Seq dùng
  lại chỉ bị "tiêu" khi lời gọi qua hết kiểm tra: lời gọi bị từ chối (vd `DerivedLayerDateError` bắt lại trong `work`)
  không làm mất vị trí của lần ghi đúng sau đó.
- Engine KHÔNG kiểm SL trả hàng ≤ SL dòng bán gốc (vd khôi phục phiếu trả sau khi đơn bán gốc đã bị sửa giảm): **người
  gọi phải bảo đảm SL trả ≤ SL bán gốc** (kiểm ở tầng nghiệp vụ, plan 03+).
- **Không bao giờ nạp lại hàng loạt dòng sổ (import / chuyển kỳ / sửa tay DB) mà không giữ `seq`.** Chuyển dữ liệu
  cũ vào: gán seq theo đúng thứ tự nghiệp vụ gốc.

## 4. Quy ước gọi engine cho giá vốn phụ thuộc chéo (Task 7 — `tests/inventory/derived.test.ts`)

- **Trả hàng theo đơn / hàng không giao được** (spec 3.4): `postReceipt({ docType: "RETURN_IN", …, unitCost: <vốn dòng bán
  gốc>, costRef: { docType: "SALE", docLineId: <dòng bán gốc>, qty: <SL dòng bán gốc> } })`. Giá lớp = giá dòng bán gốc
  (engine tự lấy từ dòng sổ gốc, `unitCost` truyền vào chỉ dùng khi dòng gốc chưa có dòng sổ) và **tự cập nhật** khi
  giá dòng gốc đổi (vd cước nhập sau vào lô cũ), lan tới đơn bán đã ăn lớp trả hàng.
- **Trả theo SP không có đơn** (spec 3.4, plan 04-C6): module tự tính giá (`resolveReturnCostByProduct`) rồi
  `postReceipt({ docType: "RETURN_IN", unitCost })` **không `costRef`** ⇒ đó là lớp **thường** (hạng 0, giá cố định, được
  nhập bù đơn treo như phiếu nhập).
- **Bán hàng gia công có BOM** (tôn xốp, spec 3.6): mỗi NVL 1 `postIssue({ docType: "SALE", docId: <đơn>, docLineId:
  <dòng bán>, productId: <NVL>, qty: <định mức × SL> })` — nhiều dòng sổ cùng `docLineId`. Chủ dòng (`registerCostOwner
  ("SALE")`) nhận `snap.totalCost` = tổng vốn mọi NVL, giá/md = `unitCostOf(snap.totalCost, SL thành phẩm)` (KHÔNG
  `.div`); `snap.qtyProvisional > 0` ⇔ thiếu ít nhất một NVL (đơn treo). Mỗi mã NVL lưu `seq` riêng (khoá seq theo
  `productId`).
- **Lệnh SX phụ kiện** (spec 3.6): NVL `postIssue({ docType: "PRODUCTION_USE", docId: <lệnh>, docLineId: <lệnh> })`
  ghi **TRƯỚC**, rồi thành phẩm `postReceipt({ docType: "PRODUCTION_OUT", docId: <lệnh>, docLineId: <lệnh>, costRef:
  { docType: "PRODUCTION_USE", docLineId: <lệnh>, qty: <SL thành phẩm> } })` (ngược thứ tự ⇒ `DerivedLayerOrderError`).
  Giá thành phẩm = Σ vốn NVL / SL, tự lan truyền sang mã thành phẩm và đơn bán thành phẩm khi giá NVL đổi.
- **Hủy / sửa** chứng từ gốc còn lớp phụ thuộc ⇒ `DependentDocumentsError`. Hủy lệnh SX: `removeDocument
  ("PRODUCTION_OUT")` rồi `removeDocument("PRODUCTION_USE")`. **Sửa** lệnh SX / đơn bán có trả hàng: trong CÙNG
  `withInventoryTx` gỡ lớp phụ thuộc → gỡ dòng gốc → ghi lại dòng gốc → ghi lại lớp phụ thuộc (engine tự giữ `seq` của
  từng dòng nên thành phẩm vẫn xếp sau NVL). `costRefId` là `docLineId` của dòng gốc — module phải dùng `docLineId`
  DUY NHẤT trong mỗi `docType` xuất (id dòng chứng từ, không phải số thứ tự dòng trong phiếu).
- **Chủ dòng** (`CostOwner`) được gọi **một lần cho mỗi dòng xuất** mà lần tính lại chạm tới (kể cả dòng không đổi
  giá), trong cùng transaction — giữ nó rẻ (1 câu `UPDATE`); đây là phần duy nhất của lan truyền tốn câu lệnh theo số
  dòng (mục 9).
- Nhắc lại §2.2: hàng trả / thành phẩm **không lấp** đơn bán âm kho ghi trước đó.

## 5. Khoá khi lan truyền giá khác mã (Task 7 fix round 1)

- `withInventoryTx({ products })` khoá các mã khai báo theo thứ tự **tăng dần** (không deadlock giữa các giao dịch chỉ
  dùng mã khai báo).
- Lan truyền (`propagate`, unit-of-work.ts): với các dòng xuất vừa tính lại, **trước khi** đọc tổng vốn dòng
  (`lineSnapshots`), gọi chủ dòng, hay ghi giá lớp phụ thuộc, engine khoá **mọi** mã có dòng sổ xuất của các dòng đó (vd
  mọi NVL của lệnh SX / dòng bán tôn xốp) **và** mọi mã có lớp phụ thuộc trỏ tới các dòng đó (thành phẩm, hàng trả) —
  một lượt cho cả lô dòng (Task 9). Không có khoá này, hai giao dịch đổi giá hai NVL khác nhau của cùng một lệnh SX thấy
  nửa cũ của nhau và giao dịch commit sau ghi đè giá thành phẩm / tổng vốn dòng bằng số cũ (mất cập nhật) — test
  `derived-concurrency.test.ts`.
- Các khoá bổ sung này (và khoá mã phát sinh trong `flush`) có thể lấy **ngoài thứ tự tăng dần** ⇒ Postgres có thể phát
  hiện deadlock (≈1 giây `deadlock_timeout`) và hủy một giao dịch; `withInventoryTx` tự chạy lại **toàn bộ** giao dịch
  (tối đa 3 lần, `retryOnDeadlock`) trên dữ liệu đã commit ⇒ kết quả đúng, chỉ chậm hơn. Vì vậy `work` KHÔNG được có tác
  dụng phụ ngoài `ctx.tx`. Module có thể giảm xác suất này bằng cách khai báo sẵn trong `products` các mã NVL/thành phẩm
  liên quan (vd sửa giá phiếu nhập NVL: thêm mã thành phẩm của các lệnh SX dùng lô đó nếu biết).
- **Module phải tuần tự hoá việc sửa đồng thời CÙNG một dòng chứng từ** (vd khoá dòng `SELECT … FOR UPDATE` trên chứng
  từ / dòng chứng từ trước khi gọi engine): hai giao dịch cùng thêm dòng xuất ở các mã KHÁC nhau vào cùng `docLineId`
  (vd hai người cùng sửa định mức một dòng bán tôn xốp) có thể mỗi bên chỉ thấy tổng vốn dòng một phần. Khoá của engine
  chỉ tính các dòng sổ đã commit / của chính giao dịch.
- **Hết lượt chạy lại:** `retryOnDeadlock` chỉ thử 3 lần; khi nhiều giao dịch cùng tranh NVL dùng chung trong BOM, lần
  thứ 3 vẫn deadlock thì `withInventoryTx` ném **`EngineBusyError`** (DomainError 409, code `INVENTORY_BUSY`, thông điệp
  "kho đang bận… thử lại"; lỗi Postgres/Prisma gốc `40P01` / `P2034` ở `cause`) — tầng API trả như mọi DomainError,
  không phải 500. Worker nền để job về `PENDING` và thử lại sau (xem §6). Module vẫn nên khai báo sẵn các mã BOM liên
  quan trong `products` để khoá theo thứ tự tăng dần ngay từ đầu.

## 6. Tính lại chạy nền (Task 8 — `src/server/inventory/recompute.ts`, `recompute-jobs.ts`)

- Giao dịch đồng bộ (`mode: "inline"`) gặp mã cần tính lại > `inlineLimit` sự kiện (mặc định 2.000, spec 3.5): KHÔNG
  tính, KHÔNG lỗi — bật `products.recomputing`, tạo/gộp **job** (`recompute_jobs`, tối đa 1 job/mã, giữ mốc sớm nhất)
  rồi **commit** bình thường; sau commit đánh thức worker. Dữ liệu sổ của mã đó (giá vốn các dòng sau mốc) là **cũ**
  tới khi worker xong.
- Trong lúc mã đang cờ: **xuất** mã đó ⇒ `ProductRecomputingError` (409, thử lại sau); **nhập / hủy / sửa / đổi giá lô**
  vẫn ghi được — giao dịch đồng bộ chỉ gộp mốc vào job (không tính đồng bộ, kể cả khi dưới ngưỡng). Lan truyền giá từ mã
  khác chạm mã đang cờ cũng chỉ gộp mốc.
- Worker (`runRecomputeJobs`): nhận job `PENDING` bằng `FOR UPDATE SKIP LOCKED` (an toàn nhiều tiến trình), mỗi job 1
  `withInventoryTx` chế độ `worker` (không ngưỡng, timeout 10 phút, ngân sách flush 570 giây). Khi flush (worker) gặp
  mã đang cờ — job của chính nó HOẶC mã khác bị lan truyền chạm tới — nó đọc lại mốc job **dưới khoá mã**, tính từ
  `min(mốc, mốc job)`, xoá job + tắt cờ **trong cùng giao dịch**. (Mốc lúc nhận job có thể đã cũ: giao dịch đồng bộ
  gộp mốc sớm hơn trong lúc worker chờ khoá.)
- **Lỗi của worker** (Task 8 fix round 1, Task 9):
  - Lỗi **tạm thời** (`isTransientError`: `EngineBusyError`/deadlock, Prisma `P2028` hết giờ transaction, `P2024` hết
    kết nối pool, `P2037` quá nhiều kết nối, `P1001`/`P1002`/`P1008`/`P1017` mất/không tới được DB, Postgres `57P01`
    admin_shutdown / `57P03` DB đang khởi động / `53300` quá nhiều kết nối — cả khi nằm trong `P2010` (truy vấn thô) ở
    `meta.code` —, "connection reset/terminated"…) ⇒ job về `PENDING` (ghi `error` lần gần nhất), hẹn chạy lại sau
    `2 s × 2^(attempts−1)` (trần 60 s). `attempts` tăng mỗi lần nhận; tới `MAX_JOB_ATTEMPTS` (= 5) lần vẫn lỗi tạm thời
    ⇒ `FAILED`.
  - Lỗi **thật** (dữ liệu / lập trình, vd `PeriodClosedError`) ⇒ `FAILED` ngay.
  - `FAILED` **giữ cờ** (chặn xuất mã đó) tới khi người vận hành gọi **`retryFailedJob(productId)`** (FAILED → PENDING,
    attempts = 0, xoá lỗi, đánh thức worker) — công cụ khôi phục cho màn vận hành (plan 03). Thay đổi mới trên mã có
    job FAILED chỉ gộp mốc, vẫn `FAILED`.
  - Lỗi ở chính bước **nhận** job (DB chập chờn/sập) ⇒ hẹn chạy lại với giãn cách **tăng dần theo số lần lỗi liên tiếp**
    (2 s, 4 s, … trần 60 s; nhận được job thì đếm lại); log chỉ khi giãn cách vừa tăng một bậc, ở trần thì 10 lần lỗi
    mới log 1 lần. Lỗi khi **ghi trạng thái** job ⇒ log + hẹn chạy lại. Lượt worker không bao giờ reject. Job kẹt
    `RUNNING` được quét định kỳ trả về `PENDING`.
- **FAILED lan sang mã khác (qua gộp job):** khi worker tính mã A và lan truyền giá chạm mã B đang có job (kể cả job
  `FAILED`), flush **gộp** job của B vào giao dịch của A (`absorbRecomputeJob`). Nếu lỗi của B là lỗi thật (dữ liệu của B
  hỏng), giao dịch của A cũng lỗi ⇒ job A cũng `FAILED` (A bị chặn xuất theo). Người vận hành xử lý B trước rồi
  `retryFailedJob` cả hai. (Ngược lại, B gộp thành công thì job FAILED của B được xoá + mở cờ — lỗi tạm thời cũ tự khỏi.)
- **Cột `recompute_jobs.error` lưu thông điệp lỗi THÔ** (có thể chứa chi tiết Prisma/SQL/tên bảng): chỉ cho log / người
  vận hành; **không hiển thị nguyên văn** cho người dùng cuối.
- **Vòng đời trong tiến trình** (`src/instrumentation.ts` → `bootRecomputeWorker`): dọn job `RUNNING` kẹt (`resetStuckJobs`),
  rồi đánh thức worker và bật quét định kỳ `SWEEP_INTERVAL_MS` = 60 s (`startRecomputeSweep`: job `RUNNING` quá
  `STALE_RUNNING_MS` ≈ 31,5 phút = 3 × (timeout worker 600 s + maxWait 10 s) + 60 s → `PENDING`, rồi đánh thức nhặt job
  `PENDING` bị lỡ). Mọi timer `unref`. DB chưa sẵn sàng lúc khởi động ⇒ log + thử lại sau 30 s, **không làm hỏng khởi
  động Next**. Trạng thái worker (lượt đang chạy, timer, bộ đếm lỗi) là **singleton trên `globalThis`** (như
  `src/lib/prisma.ts`): Next dev/HMR nạp lại module không nhân đôi worker hay timer quét.
- ⚠ **Giả định MỘT tiến trình app** (một container). Nhiều instance: một instance khởi động lại trả job instance khác
  đang chạy về `PENDING` (`resetStuckJobs`) — vô hại về kết quả (tính lại dưới khoá mã, idempotent; xoá job/tắt cờ
  idempotent) nhưng tốn công; khi scale ngang phải đổi sang chỉ dọn job quá hạn (như quét định kỳ) hoặc có owner/lease.
- **Hợp đồng kết sổ (K5 checklist, spec 3.5 / 4.2): kết sổ kỳ PHẢI BỊ CHẶN khi còn bất kỳ mã nào `products.recomputing
  = true` hoặc còn job `PENDING` / `RUNNING` / `FAILED` trong `recompute_jobs`** (job thuộc kỳ đã kết sổ sẽ `FAILED` vĩnh
  viễn với `PeriodClosedError`). Engine chưa tự chặn — module kết sổ (plan 07-F1) phải kiểm.
- Test: `.env.test` đặt `RECOMPUTE_WORKER=off` (worker không tự chạy); test gọi `runRecomputeJobs` để kiểm soát thời
  điểm.

## 7. Đối chiếu bộ test bắt buộc spec 3.7

Tệp test ở `tests/inventory/`. "✔ (engine)" = phần kho/giá vốn đã có test; phần nghiệp vụ còn lại thuộc plan module ghi
ở cột cuối.

| # | Case bắt buộc (spec 3.7) | Mã nguồn | Test | Trạng thái |
|---|---|---|---|---|
| 1 | Nhập–bán 1 lớp | `ports.ts` (`postReceipt`/`postIssue`), `replay.ts` | `basic.test.ts` › "nhập 100@20.000 rồi bán 30 …" | ✔ |
| 2 | Bán xuyên nhiều lớp (case 3.2 = 20.444,44) | `replay.ts` (pha 1 FIFO + pha 2 giá, làm tròn 1 lần) | `basic.test.ts` › "TEST CHUẨN CỦA KHÁCH …"; `rounding.test.ts` | ✔ |
| 3 | Bán âm rồi nhập bù | `replay.ts` (hàng đợi đơn treo, `drain`), `queries.ts` (giá tạm) | `provisional.test.ts`; `replay.test.ts` › "bán âm kho / đơn treo / nhập bù"; `performance.test.ts` (1.500 đơn treo) | ✔ |
| 4 | 2 người bán cùng mã đồng thời | `lock.ts` (advisory lock, tăng dần), `unit-of-work.ts` (`retryOnDeadlock`, `EngineBusyError`) | `concurrency.test.ts` › "2 người bán cùng lúc 60 + 60 …"; `derived-concurrency.test.ts`; `lock.test.ts` | ✔ |
| 5 | Trả theo đơn đúng giá vốn cũ | `ports.ts` (`costRef`), `replay.ts`, `unit-of-work.ts` (`propagate`) | `derived.test.ts` › "trả 10 của dòng bán #2 …", "giá vốn dòng bán ĐỔI …"; `ties.test.ts`; `cycle.test.ts` | ✔ (engine) — chứng từ trả: plan 04-C6 |
| 6 | Trả theo SP không có đơn | engine: `postReceipt` RETURN_IN **không** `costRef` (lớp thường) | — | ⏳ plan 04-C6 (`resolveReturnCostByProduct` cần bảng đơn bán) |
| 7 | Trả NCC | `postIssue({ docType: "RETURN_SUPPLIER" })` | `supplier-return.test.ts` | ✔ (engine) — công nợ: plan 04-C6 |
| 8 | Sửa đơn giữa chuỗi | `removeDocument` + ghi lại (seq tự dùng lại), `replay.ts` (tính lại từng phần) | `edit.test.ts` › "sửa đơn GIỮA chuỗi …"; `seq.test.ts`; `property.test.ts` | ✔ |
| 9 | Hủy đơn giữa chuỗi | `removeDocument` | `edit.test.ts` › "hủy đơn giữa chuỗi …", "hủy PHIẾU NHẬP giữa chuỗi" | ✔ |
| 10 | Khôi phục đơn đã hủy | ghi lại với `at` + `seq` đã lưu | `edit.test.ts` › "khôi phục đơn đã hủy …"; `seq.test.ts` › "hủy rồi khôi phục QUA HAI giao dịch …" | ✔ |
| 11 | Cước nhập sau phiếu hàng | `updateLayerCost` | `replay.test.ts` › "đổi giá lớp (cước nhập sau) …"; `derived.test.ts` (lan tới lớp trả / thành phẩm); `property.test.ts` | ✔ (engine) — phân bổ cước theo giá trị: plan 03-B4 |
| 12 | Tôn xốp cộng vốn NVL | nhiều `postIssue` cùng `docLineId`, `owners.ts` (`LineCostSnapshot.totalCost`) | `derived.test.ts` › "tôn xốp: giá vốn dòng bán = TỔNG vốn NVL …" | ✔ (engine) — BOM/định mức: plan 03-B6 |
| 13 | Gia công thuê tôn xốp không trừ tôn cuộn | engine chỉ xuất đúng các dòng được yêu cầu | — | ⏳ plan 06-E3 (quyết định nghiệp vụ) |
| 14 | Lệnh SX phụ kiện | `PRODUCTION_USE` + `PRODUCTION_OUT` có `costRef`, `propagate` khác mã | `derived.test.ts` › "lệnh sản xuất phụ kiện …"; `ties.test.ts` › "sản xuất + bán lùi ngày CÙNG NGÀY" | ✔ (engine) — màn lệnh SX: plan 06-E1 |
| 15 | Hủy đơn có chiết khấu tích lũy | — (không thuộc kho) | — | ⏳ plan 05-D3 |
| 16 | Kết sổ mang lô sang kỳ mới | engine: `postReceipt({ docType: "OPENING" })` ở kỳ mới; kỳ khoá cứng: `PeriodClosedError` | `ports.test.ts` / `ports-guards.test.ts` (kỳ đã kết sổ) | ⏳ plan 07-F1 (kết sổ) |
| + | Engine == mô hình tham chiếu (chèn lùi, sửa, hủy, khôi phục, đổi giá, trả hàng) | `replay.ts` vs `tests/inventory/reference.ts` | `property.test.ts`, `assertChainExact` ở mọi test chuỗi | ✔ |
| + | Tính lại chạy nền > 2.000 dòng, chặn xuất mã đang tính lại (spec 3.5) | `recompute.ts`, `recompute-jobs.ts` | `recompute.test.ts` | ✔ |
| + | Hiệu năng (cam kết ≤ 3 s) | `replay.ts`, `unit-of-work.ts` (ghi/lan truyền theo lô) | `performance.test.ts` | ✔ (mục 9) |
| + | API công khai ghim | `index.ts` | `barrel.test.ts` | ✔ |

## 8. Giả định cần khách / module xác nhận

Mỗi mục đều đúng với mã hiện tại (đã đối chiếu); các mục 1–3 là **quy tắc giá vốn** khách cần duyệt, 4–8 là **hợp đồng
bắt buộc** với module nghiệp vụ.

1. ⚠ **Hàng khách trả và thành phẩm sản xuất (lớp có `costRef`) KHÔNG lấp lùi đơn bán âm kho trước đó.** Đơn đó giữ
   trạng thái treo (`qtyProvisional > 0`, giá tạm) tới khi có một **nhập thường** — mua (`PURCHASE`), đầu kỳ (`OPENING`),
   điều chỉnh tăng (`ADJ_IN`), kiểm kho tăng (`STOCKTAKE_IN`), hoặc trả hàng theo SP không `costRef`. Spec 4.2 **chặn kết
   sổ** khi còn đơn treo ⇒ trường hợp này cần **kiểm kho / điều chỉnh kho** (spec 3.3 chỉ nói "nhập bù" mà không định
   nghĩa). Mã: `replay.ts` (`if (!ev.layer.derived) drain()`); test: `cycle.test.ts`, `derived.test.ts` › "bán phụ kiện
   TRƯỚC khi sản xuất …".
2. ⚠ **Lớp phụ thuộc không được đứng trước chứng từ gốc:** phiếu trả / thành phẩm có thời điểm trước dòng bán / lệnh SX
   gốc ⇒ `DerivedLayerDateError`; dòng gốc phải được ghi trước ⇒ `DerivedLayerOrderError` (`layers.ts`
   `assertDerivedAfterSource`, kiểm ở `postReceipt`, replay và lan truyền).
3. ⚠ **Cùng thời điểm `at`:** nhập thường xếp trước; rồi lệnh xuất và lớp phụ thuộc xếp theo **thứ tự ghi (`seq`)**. Chứng
   từ lùi về cùng một ngày có chung `at` (23:59:59.999 ICT) nên bán ghi sau lệnh SX/trả hàng cùng ngày ăn được thành
   phẩm/hàng trả, bán ghi trước thì không (mục 1).
4. **Sửa chứng từ mà ngày không đổi: dùng lại `at` đã lưu**, KHÔNG gọi lại `docTimestamp` (kết quả của nó không ổn định
   qua các ngày: sửa hôm sau sẽ đổi `at` sang 23:59:59.999 và xê dịch FIFO). **Mỗi dòng chứng từ lưu `at` + `seq`**;
   engine tự dùng lại seq theo khoá (docType, docId, docLineId, productId) khi xoá + ghi lại trong cùng giao dịch — dòng
   mới / đổi mã / đổi loại chứng từ nhận seq mới, xếp cuối trong `at` của nó (mục 3).
5. **`estimateCost` (giá tạm) chỉ xét lớp của MỘT kỳ** (`periodId`): mã chưa có lớp thường nào trong kỳ mới (không có lô
   `OPENING`) bán âm ở kỳ mới được giá tạm 0, dù kỳ trước có "giá nhập gần nhất" (spec 3.3). Kết sổ (07-F1) mang lô sang
   kỳ mới bằng `OPENING` là đủ cho mã còn tồn; mã hết tồn cuối kỳ → cần khách xác nhận.
6. **Người gọi bảo đảm SL trả ≤ SL dòng bán gốc** (engine không kiểm — vd khôi phục phiếu trả sau khi đơn gốc bị sửa
   giảm).
7. **Module tuần tự hoá việc sửa đồng thời cùng một dòng chứng từ** (`SELECT … FOR UPDATE` trên chứng từ/dòng trước khi
   gọi engine) — mục 5.
8. **Kết sổ kỳ phải bị chặn khi còn cờ `products.recomputing` hoặc job `PENDING`/`RUNNING`/`FAILED`** trong
   `recompute_jobs` (engine chưa tự chặn — plan 07-F1) — mục 6.

## 9. Hiệu năng (Task 9 — `tests/inventory/performance.test.ts`)

Đo (Windows + Postgres Docker, trước → sau khi gộp theo lô):

| Kịch bản | Trước | Sau |
|---|---|---|
| Tính lại đầy đủ 2.000 dòng bán | 16,3 s, 8.014 câu lệnh | ≈1,0 s, 18 câu lệnh |
| Hủy lô đầu chuỗi 500 dòng (mọi dòng đổi giá) | 3,5 s, 1.723 câu lệnh | ≈0,3 s, 26 câu lệnh |
| Đổi giá phiếu nhập 50 mã × 40 dòng bán | 17,2 s, 8.655 câu lệnh | ≈2,3 s, ≈17 câu lệnh/mã |
| Đổi giá lô đầu, 300 dòng bán có lớp trả hàng | 4,3 s, 2.119 câu lệnh | ≈0,4 s, 23 câu lệnh |
| Bán ở đuôi chuỗi 2.000 dòng | — | ≈50 ms, 19 câu lệnh |
| 1.500 đơn treo rồi nhập bù | — | ≈0,4 s / ≈0,6 s, ≈20 câu lệnh |

Nguyên nhân cũ: 1 `UPDATE` cho mỗi dòng xuất/lớp đổi trong replay, và ~4 câu lệnh cho MỖI dòng trong lan truyền (dò mã
liên quan, `lineSnapshot`, tìm lớp phụ thuộc, dòng gốc), 2 câu lệnh giá tạm cho mỗi đơn treo. Nay: ghi gộp `UPDATE … FROM
unnest(…)`, lan truyền theo lô (`lineSnapshots`, một truy vấn lớp phụ thuộc + dòng gốc cho cả lô), giá tạm nạp lớp thường
một lần. Ngoại lệ còn lại theo số dòng: lời gọi **chủ dòng** (mục 4). Test ghim **số câu lệnh** (không phụ thuộc máy)
và thời gian với ngưỡng rộng (≤ 3 s cho 2.000 dòng — hợp đồng spec; ≤ 500 ms bán ở đuôi).
