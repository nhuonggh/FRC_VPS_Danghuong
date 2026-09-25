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
- **Không bao giờ nạp lại hàng loạt dòng sổ (import / chuyển kỳ / sửa tay DB) mà không giữ `seq`.** Chuyển dữ liệu
  cũ vào: gán seq theo đúng thứ tự nghiệp vụ gốc.
