# Engine kho FIFO — thứ tự sự kiện & giả định (bản nháp từ plan 02 Task 4; Task 9 bổ sung phần còn lại)

> Ghi chú cho người đọc plan `docs/superpowers/plans/2026-09-24-02-gd1a-fifo-engine.md`: các dòng ~1250 / ~1482 / ~2162
> của plan viết "cùng thời điểm: nhập trước xuất" và "(at, id)". Thứ tự **thực tế** của engine khác — xem mục 1 (quyết
> định ở các vòng review Task 4). Mã nguồn: `src/server/inventory/replay.ts` (`order`, `eventClass`, `cmpSeq`).

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

## 2. Giả định nghiệp vụ (cần khách xác nhận các mục đánh dấu ⚠)

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
   (khi đó giá vốn được tính lại theo lớp thật).
6. Mọi giá vốn đơn vị làm tròn HALF_UP 4 chữ số **một lần**, từ số học 80 chữ số (không float).
7. Lưới an toàn flush: mỗi mã tối đa `min(50 + 2 × số lớp phụ thuộc của mã, 500)` lần tính lại/giao dịch, và ngân
   sách thời gian `flushBudgetMs` (mặc định 25 giây < timeout transaction 30 giây).

## 3. Hợp đồng cho module nghiệp vụ (plan 03+): mỗi dòng chứng từ lưu `at` + `seq`

- `postReceipt` / `postIssue` trả `seq` đã gán. Module **PHẢI lưu `seq` cùng dòng chứng từ, như `at`**.
- **Sửa** chứng từ = `removeDocument` + ghi lại **trong CÙNG `withInventoryTx`**: engine tự dùng lại `seq` của dòng vừa
  xoá cùng khoá (docType, docId, docLineId, productId) — không phải truyền gì (vẫn phải truyền lại `at` đã lưu).
- **Khôi phục** chứng từ đã hủy (giao dịch khác): truyền lại `at` **và** `seq` đã lưu (`seq` input). Không truyền →
  nhận seq mới (xếp sau mọi dòng đã có) → có thể đổi kết quả FIFO của các chứng từ cùng `at`.
- `seq` đang có dòng dùng ⇒ `EngineInvariantError` (duy nhất toàn bảng — UNIQUE).
- Engine KHÔNG kiểm SL trả hàng ≤ SL dòng bán gốc (vd khôi phục phiếu trả sau khi đơn bán gốc đã bị sửa giảm): **người
  gọi phải bảo đảm SL trả ≤ SL bán gốc** (kiểm ở tầng nghiệp vụ, plan 03+).
- **Không bao giờ nạp lại hàng loạt dòng sổ (import / chuyển kỳ / sửa tay DB) mà không giữ `seq`.** Chuyển dữ liệu
  cũ vào: gán seq theo đúng thứ tự nghiệp vụ gốc.

## 4. Quy ước gọi engine cho giá vốn phụ thuộc chéo (Task 7 — `tests/inventory/derived.test.ts`)

- **Trả hàng theo đơn / hàng không giao được** (spec 3.4): `postReceipt({ docType: "RETURN_IN", …, unitCost: <vốn dòng bán
  gốc>, costRef: { docType: "SALE", docLineId: <dòng bán gốc>, qty: <SL dòng bán gốc> } })`. Giá lớp = giá dòng bán gốc
  (engine tự lấy từ dòng sổ gốc, `unitCost` truyền vào chỉ dùng khi dòng gốc chưa có dòng sổ) và **tự cập nhật** khi
  giá dòng gốc đổi (vd cước nhập sau vào lô cũ), lan tới đơn bán đã ăn lớp trả hàng.
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
- Nhắc lại §2.2: hàng trả / thành phẩm **không lấp** đơn bán âm kho ghi trước đó.

## 5. Khoá khi lan truyền giá khác mã (Task 7 fix round 1)

- `withInventoryTx({ products })` khoá các mã khai báo theo thứ tự **tăng dần** (không deadlock giữa các giao dịch chỉ
  dùng mã khai báo).
- Lan truyền (`propagate`, unit-of-work.ts): với mỗi dòng xuất vừa tính lại, **trước khi** đọc tổng vốn dòng
  (`lineSnapshot`), gọi chủ dòng, hay ghi giá lớp phụ thuộc, engine khoá **mọi** mã có dòng sổ xuất của dòng đó (vd mọi
  NVL của lệnh SX / dòng bán tôn xốp) **và** mọi mã có lớp phụ thuộc trỏ tới dòng đó (thành phẩm, hàng trả). Không có
  khoá này, hai giao dịch đổi giá hai NVL khác nhau của cùng một lệnh SX thấy nửa cũ của nhau và giao dịch commit sau ghi
  đè giá thành phẩm / tổng vốn dòng bằng số cũ (mất cập nhật) — test `derived-concurrency.test.ts`.
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
  thứ 3 vẫn deadlock thì lỗi deadlock thô của Postgres/Prisma (`40P01` / `P2034` / "deadlock detected") tới người gọi.
  Tầng API và worker nền (Task 8) phải đổi lỗi này thành phản hồi "đang bận, thử lại" (không phải 500), hoặc khai báo
  sẵn các mã BOM liên quan trong `products` để khoá theo thứ tự tăng dần ngay từ đầu.
