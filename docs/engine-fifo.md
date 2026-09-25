# Engine kho FIFO — thứ tự sự kiện & giả định (bản nháp từ plan 02 Task 4; Task 9 bổ sung phần còn lại)

> Ghi chú cho người đọc plan `docs/superpowers/plans/2026-09-24-02-gd1a-fifo-engine.md`: các dòng ~1250 / ~1482 / ~2162
> của plan viết "cùng thời điểm: nhập trước xuất". Thứ tự **thực tế** của engine khác — xem mục 1 (quyết định ở các
> vòng review Task 4). Mã nguồn: `src/server/inventory/replay.ts` (`order`, `seqKey`, `eventClass`).

## 1. Thứ tự sự kiện

Mỗi mã hàng được mô phỏng theo khoá **(at, hạng, khoá)**:

| Hạng | Sự kiện | Khoá trong cùng hạng |
|---|---|---|
| 0 | Lớp nhập **thường** (mua, đầu kỳ, điều chỉnh/kiểm kho tăng… — `costRefType` rỗng) | id lớp |
| 1 | **Lệnh xuất** (bán, dùng NVL, hao hụt, trả NCC…) **và lớp phụ thuộc** (trả hàng `RETURN_IN`, thành phẩm `PRODUCTION_OUT` — có `costRef`) | id dòng sổ = **thứ tự ghi** |

Hệ quả tại **cùng `at`** (vd chứng từ lùi ngày: `docTimestamp` cho mọi chứng từ của cùng một ngày quá khứ cùng
23:59:59.999 ICT):
- lớp nhập thường luôn dùng được cho mọi lệnh xuất cùng `at`;
- lệnh xuất ghi **sau** lệnh SX / trả hàng cùng `at` ăn được thành phẩm / hàng trả;
- lệnh xuất ghi **trước** thì không (và nếu thiếu hàng sẽ treo — xem 2.2).

## 2. Giả định nghiệp vụ (cần khách xác nhận các mục đánh dấu ⚠)

1. **Lớp phụ thuộc** có giá = `round4(Σ qtyOut × unit_cost_out của dòng gốc / costRefQty)`, do engine quản (không sửa
   tay — `updateLayerCost` từ chối; giá người gọi truyền chỉ dùng khi dòng gốc chưa có dòng sổ). `costRef` phải trỏ
   chứng từ **xuất**.
2. ⚠ **Lớp phụ thuộc KHÔNG BAO GIỜ nhập bù đơn treo** (bán âm kho). Đơn treo chỉ được lớp nhập **thường** nuốt.
   Hệ quả: **hàng khách trả và thành phẩm sản xuất không lấp đơn bán âm kho trước đó** — chúng là tồn cho đơn xuất xếp
   sau. Quy trình "bán phụ kiện trước, sản xuất sau" để lại đơn treo tới khi có nhập thường / điều chỉnh kho (kết sổ
   bị chặn khi còn đơn treo — spec 4.2).
3. Lớp phụ thuộc phải **đứng sau dòng gốc**: `at` không trước dòng gốc (`DerivedLayerDateError`) và được ghi sau mọi
   dòng sổ của dòng gốc (`DerivedLayerOrderError`). Nhờ (1)–(3) và mục 1, đồ thị phụ thuộc giá là DAG → tính lại hội
   tụ, không phụ thuộc lịch sử thao tác.
4. ⚠ Tại cùng `at`, **thứ tự ghi** quyết định lệnh xuất nào dùng được thành phẩm/hàng trả (kể cả hai lệnh SX dùng
   thành phẩm của nhau cùng ngày: lệnh ghi trước không dùng được thành phẩm của lệnh ghi sau).
5. Giá tạm phần treo = giá lớp **thường** gần nhất có `at ≤` thời điểm xuất → lớp thường đầu tiên → 0.
6. Mọi giá vốn đơn vị làm tròn HALF_UP 4 chữ số **một lần**, từ số học 80 chữ số (không float).
7. Lưới an toàn flush: mỗi mã tối đa `min(50 + 2 × số lớp phụ thuộc của mã, 500)` lần tính lại/giao dịch, và ngân
   sách thời gian `flushBudgetMs` (mặc định 25 giây < timeout transaction 30 giây).
